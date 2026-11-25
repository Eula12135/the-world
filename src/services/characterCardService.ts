import { strFromU8, strToU8, zlibSync } from 'fflate';
import type {
  Character,
  CharacterUserRelationHook,
  ImageFramingId,
  RelationType,
  TtsEngine,
  VoiceProfile,
} from '../types';
import { base64ToUint8Array, uint8ArrayToBase64 } from './llm';
import { resolveMediaToDataUrl } from './mediaStore';
import { RELATION_TYPE_META } from './temporalGraph';
import { createId } from '../utils/platform';

export const TWCARD_MAGIC = 'the-world-character-card';
export const TWCARD_VERSION = 1;
export const PNG_TWCARD_KEYWORD = 'theworld_card';
export const PNG_CHARA_V2_KEYWORD = 'chara';

/** 导入文件体积安全上限（15 MB，含立绘与一段压缩参考语音足够充裕） */
export const MAX_CARD_FILE_BYTES = 15 * 1024 * 1024;
/** 内嵌头像上限（6 MB Base64） */
const MAX_AVATAR_DATA_URL_LEN = 6 * 1024 * 1024;
/** 内嵌语音样本上限（8 MB Base64） */
const MAX_SAMPLE_AUDIO_DATA_URL_LEN = 8 * 1024 * 1024;

export type SharedVoiceKind = 'native' | 'public_preset' | 'cloned' | 'designed';

export interface SharedCharacterVoice {
  kind: SharedVoiceKind;
  name: string;
  providerId?: string;
  engine: TtsEngine;
  /** 仅当属于已知公共厂商端点时保留标准域名，剥离带私密路径/token 的自定义网关参数 */
  baseUrl?: string;
  model?: string;
  /** 公共预设存标准音色 ID；私有克隆音色同样保留原 ID 供同账号复用，跨账号则靠 sampleAudio 复刻 */
  voiceId: string;
  rate: number;
  pitch: number;
  volume: number;
  gain: number;
  styleInstruction: string;
  /** 克隆或捏声线的参考文本 */
  sourceText?: string;
  /** 5~15 秒压缩参考音频（data:audio/...;base64,...），支持离线试听与一键复刻到新账号 */
  sampleAudio?: string;
  /** 提示词捏声线的原始描述词配方 */
  designPrompt?: string;
}

export interface ShareableCharacterCard {
  spec: typeof TWCARD_MAGIC;
  version: typeof TWCARD_VERSION;
  exportedAt: string;
  character: {
    name: string;
    identity: string;
    personality: string;
    status: string;
    relationsNote: string;
    notes: string;
    systemPrompt?: string;
    imageFramingId?: ImageFramingId;
    imageStyleId?: string;
    avatarColor: string;
    avatarImage?: string;
    voiceName?: string;
    userRelation?: CharacterUserRelationHook;
  };
  /** 作品题材背景提示（仅名称与题材，不含整部世界观文档隐私） */
  worldHint?: {
    name: string;
    genre: string;
  };
  voice?: SharedCharacterVoice;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint32BE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function sanitizeSharedBaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl || !rawUrl.trim()) return undefined;
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    // 剥离 URL 中可能夹带的用户名密码与查询参数（防止泄露带 token 的网关 URL）
    const hostLower = u.hostname.toLowerCase();
    if (
      hostLower === 'localhost' ||
      hostLower === '127.0.0.1' ||
      hostLower.startsWith('192.168.') ||
      hostLower.startsWith('10.')
    ) {
      return undefined;
    }
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
}

function classifyVoiceKind(profile: VoiceProfile): SharedVoiceKind {
  if (profile.engine === 'native') return 'native';
  if (profile.designPrompt?.trim()) return 'designed';
  if (profile.isCloned || profile.voiceId.trim().startsWith('speech:')) return 'cloned';
  return 'public_preset';
}

/**
 * 构建脱敏的可分享角色卡对象（严格剥离所有 API Key、会话 ID 与私有内网地址）。
 */
export async function buildShareableCharacterCard(params: {
  character: Character;
  voiceProfile?: VoiceProfile;
  worldHint?: { name: string; genre: string };
  includeVoiceSample?: boolean;
}): Promise<ShareableCharacterCard> {
  const { character, voiceProfile, worldHint, includeVoiceSample = true } = params;
  const avatarDataUrl = await resolveMediaToDataUrl(character.avatarImage);

  let sharedVoice: SharedCharacterVoice | undefined;
  if (voiceProfile) {
    const kind = classifyVoiceKind(voiceProfile);
    const sampleDataUrl =
      includeVoiceSample && voiceProfile.sampleAudio
        ? await resolveMediaToDataUrl(voiceProfile.sampleAudio)
        : undefined;
    sharedVoice = {
      kind,
      name: voiceProfile.name.trim() || `${character.name} 声线`,
      providerId: voiceProfile.providerId,
      engine: voiceProfile.engine,
      baseUrl: sanitizeSharedBaseUrl(voiceProfile.baseUrl),
      model: voiceProfile.model,
      voiceId: voiceProfile.voiceId,
      rate: voiceProfile.rate,
      pitch: voiceProfile.pitch,
      volume: voiceProfile.volume,
      gain: voiceProfile.gain,
      styleInstruction: voiceProfile.styleInstruction || '',
      sourceText: includeVoiceSample ? voiceProfile.sourceText : undefined,
      sampleAudio: sampleDataUrl,
      designPrompt: voiceProfile.designPrompt,
    };
  }

  return {
    spec: TWCARD_MAGIC,
    version: TWCARD_VERSION,
    exportedAt: new Date().toISOString(),
    character: {
      name: character.name.trim() || '未命名角色',
      identity: character.identity || '',
      personality: character.personality || '',
      status: character.status || '',
      relationsNote: character.relationsNote || '',
      notes: character.notes || '',
      systemPrompt: character.systemPrompt?.trim() || undefined,
      imageFramingId: character.imageFramingId,
      imageStyleId: character.imageStyleId,
      avatarColor: character.avatarColor || '#4d6bfe',
      avatarImage: avatarDataUrl,
      voiceName: voiceProfile ? undefined : character.voiceName?.trim() || undefined,
      userRelation: character.userRelation,
    },
    worldHint:
      worldHint && worldHint.name.trim()
        ? { name: worldHint.name.trim(), genre: worldHint.genre || '' }
        : undefined,
    voice: sharedVoice,
  };
}

/**
 * 在纯 JS/Node 环境下生成一张极简纯色 PNG（64×64 RGB），
 * 用于当角色没有上传立绘或运行在无 Canvas 环境时依然能导出合法的 PNG 角色卡。
 */
export function createSolidColorPngBytes(hexColor = '#3b57e8', width = 64, height = 64): Uint8Array {
  const cleanHex = hexColor.replace(/^#/, '');
  const r = parseInt(cleanHex.slice(0, 2), 16) || 0x3b;
  const g = parseInt(cleanHex.slice(2, 4), 16) || 0x57;
  const b = parseInt(cleanHex.slice(4, 6), 16) || 0xe8;

  // IHDR: width(4), height(4), bitDepth=8, colorType=2(RGB), compression=0, filter=0, interlace=0
  const ihdrData = new Uint8Array(13);
  writeUint32BE(ihdrData, 0, width);
  writeUint32BE(ihdrData, 4, height);
  ihdrData[8] = 8;
  ihdrData[9] = 2;

  const rowStride = 1 + width * 3;
  const rawScanlines = new Uint8Array(height * rowStride);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowStride;
    rawScanlines[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 3;
      rawScanlines[px] = r;
      rawScanlines[px + 1] = g;
      rawScanlines[px + 2] = b;
    }
  }
  const compressed = zlibSync(rawScanlines);

  return assemblePng([
    makePngChunk('IHDR', ihdrData),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', new Uint8Array(0)),
  ]);
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i) & 0xff;
  }
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  writeUint32BE(chunk, 8 + data.length, crc);
  return chunk;
}

function assemblePng(chunks: Uint8Array[]): Uint8Array {
  const total = PNG_SIGNATURE.length + chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  let offset = PNG_SIGNATURE.length;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function avatarDataUrlToPngBytes(
  avatarDataUrl: string | undefined,
  fallbackColor: string
): Promise<Uint8Array> {
  if (avatarDataUrl && avatarDataUrl.startsWith('data:image/png;base64,')) {
    const bytes = base64ToUint8Array(avatarDataUrl);
    if (isPngBytes(bytes)) return bytes;
  }

  // 浏览器环境下把 WebP/JPEG 立绘或文字首字母渲染成真正的 PNG 字节流
  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    if (avatarDataUrl) {
      try {
        const pngDataUrl = await new Promise<string>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const w = img.naturalWidth || 512;
            const h = img.naturalHeight || 512;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('No 2D context'));
              return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/png'));
          };
          img.onerror = () => reject(new Error('Image load failed'));
          img.src = avatarDataUrl;
        });
        const bytes = base64ToUint8Array(pngDataUrl);
        if (isPngBytes(bytes)) return bytes;
      } catch {
        // Fallback to solid PNG below
      }
    }
  }

  return createSolidColorPngBytes(fallbackColor, 256, 256);
}

/**
 * 将角色卡 JSON 写入 PNG 的 `tEXt` 元数据块（键 `theworld_card`，值为 UTF-8 JSON 的 Base64，避免 Latin-1 编码损坏中文）。
 */
export function embedCardJsonIntoPng(pngBytes: Uint8Array, card: ShareableCharacterCard): Uint8Array {
  if (!isPngBytes(pngBytes)) {
    throw new Error('目标图片不是有效的 PNG 格式');
  }
  // PNG 载体自身就是角色立绘，块内不再重复塞一份相同的图片 Base64，把文件体积砍半
  const compactCard: ShareableCharacterCard = {
    ...card,
    character: {
      ...card.character,
      avatarImage: undefined,
    },
  };
  const jsonBytes = strToU8(JSON.stringify(compactCard));
  const payloadBase64 = uint8ArrayToBase64(jsonBytes);
  const keyBytes = strToU8(PNG_TWCARD_KEYWORD);
  const valBytes = strToU8(payloadBase64);
  const textChunkData = new Uint8Array(keyBytes.length + 1 + valBytes.length);
  textChunkData.set(keyBytes, 0);
  textChunkData[keyBytes.length] = 0; // null separator
  textChunkData.set(valBytes, keyBytes.length + 1);
  const newTextChunk = makePngChunk('tEXt', textChunkData);

  // 遍历既有 PNG 块，过滤旧的同名块并在 IEND 之前插入新块
  const keptChunks: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= pngBytes.length) {
    const len = readUint32BE(pngBytes, offset);
    const chunkTotal = 12 + len;
    if (offset + chunkTotal > pngBytes.length) break;
    const type = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7]
    );
    const rawChunk = pngBytes.subarray(offset, offset + chunkTotal);

    if (type === 'tEXt') {
      const dataSlice = pngBytes.subarray(offset + 8, offset + 8 + len);
      const nul = dataSlice.indexOf(0);
      if (nul > 0) {
        const key = strFromU8(dataSlice.subarray(0, nul));
        if (key === PNG_TWCARD_KEYWORD) {
          offset += chunkTotal;
          continue;
        }
      }
    }

    if (type === 'IEND') {
      keptChunks.push(newTextChunk);
      keptChunks.push(rawChunk);
      break;
    }

    keptChunks.push(rawChunk);
    offset += chunkTotal;
  }

  return assemblePng(keptChunks);
}

export async function exportCharacterCardPng(card: ShareableCharacterCard): Promise<Uint8Array> {
  const basePng = await avatarDataUrlToPngBytes(
    card.character.avatarImage,
    card.character.avatarColor
  );
  return embedCardJsonIntoPng(basePng, card);
}

function decodePngTextChunks(pngBytes: Uint8Array): Map<string, string> {
  const map = new Map<string, string>();
  let offset = 8;
  while (offset + 8 <= pngBytes.length) {
    const len = readUint32BE(pngBytes, offset);
    const chunkTotal = 12 + len;
    if (offset + chunkTotal > pngBytes.length) break;
    const type = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7]
    );
    const data = pngBytes.subarray(offset + 8, offset + 8 + len);

    if (type === 'tEXt') {
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = strFromU8(data.subarray(0, nul));
        const val = strFromU8(data.subarray(nul + 1));
        map.set(key, val);
      }
    } else if (type === 'iTXt') {
      const nul = data.indexOf(0);
      if (nul > 0 && nul + 3 <= data.length) {
        const key = strFromU8(data.subarray(0, nul));
        const compressionFlag = data[nul + 1];
        // Skip languageTag\0 and translatedKeyword\0
        let cursor = nul + 3;
        while (cursor < data.length && data[cursor] !== 0) cursor++;
        cursor++;
        while (cursor < data.length && data[cursor] !== 0) cursor++;
        cursor++;
        if (compressionFlag === 0 && cursor <= data.length) {
          map.set(key, strFromU8(data.subarray(cursor)));
        }
      }
    } else if (type === 'IEND') {
      break;
    }
    offset += chunkTotal;
  }
  return map;
}

function normalizeImportedHook(raw: unknown): CharacterUserRelationHook | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const str = (k: string) =>
    typeof r[k] === 'string' && (r[k] as string).trim()
      ? (r[k] as string).trim().slice(0, 200)
      : undefined;
  const t = r.defaultRelationType;
  const hook: CharacterUserRelationHook = {
    defaultAddress: str('defaultAddress'),
    defaultRelationType:
      typeof t === 'string' && t in RELATION_TYPE_META ? (t as RelationType) : undefined,
    defaultRelationLabel: str('defaultRelationLabel'),
    defaultRelationDesc: str('defaultRelationDesc'),
    slotHint: str('slotHint'),
  };
  return Object.values(hook).some((v) => v !== undefined) ? hook : undefined;
}

function clampNum(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeSharedVoice(raw: unknown): SharedCharacterVoice | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const kindRaw = String(v.kind || 'public_preset');
  const kind: SharedVoiceKind =
    kindRaw === 'native' ||
    kindRaw === 'public_preset' ||
    kindRaw === 'cloned' ||
    kindRaw === 'designed'
      ? kindRaw
      : 'public_preset';
  const engine: TtsEngine = v.engine === 'native' ? 'native' : 'openai_api';
  const sampleRaw = typeof v.sampleAudio === 'string' ? v.sampleAudio.trim() : '';
  const safeSample =
    sampleRaw.startsWith('data:audio/') && sampleRaw.length <= MAX_SAMPLE_AUDIO_DATA_URL_LEN
      ? sampleRaw
      : undefined;

  return {
    kind,
    name: String(v.name || '角色专属声线').trim().slice(0, 60),
    providerId: typeof v.providerId === 'string' ? v.providerId.trim().slice(0, 40) : undefined,
    engine,
    baseUrl: sanitizeSharedBaseUrl(typeof v.baseUrl === 'string' ? v.baseUrl : undefined),
    model: typeof v.model === 'string' ? v.model.trim().slice(0, 120) : undefined,
    voiceId: typeof v.voiceId === 'string' ? v.voiceId.trim().slice(0, 200) : '',
    rate: clampNum(v.rate, 1, 0.5, 2.0),
    pitch: clampNum(v.pitch, 1, 0.5, 2.0),
    volume: clampNum(v.volume, 1, 0.1, 1.0),
    gain: clampNum(v.gain, 0, -10, 10),
    styleInstruction:
      typeof v.styleInstruction === 'string' ? v.styleInstruction.trim().slice(0, 500) : '',
    sourceText: typeof v.sourceText === 'string' ? v.sourceText.trim().slice(0, 600) : undefined,
    sampleAudio: safeSample,
    designPrompt:
      typeof v.designPrompt === 'string' ? v.designPrompt.trim().slice(0, 500) : undefined,
  };
}

/**
 * 解析 `.twcard.json` 或内嵌元数据的 `.png` 角色卡（同时兼容社区通用的 SillyTavern `chara` TavernCard v2 PNG/JSON）。
 */
export function parseShareableCharacterCardBytes(bytes: Uint8Array): ShareableCharacterCard {
  if (bytes.length === 0) {
    throw new Error('角色卡文件为空');
  }
  if (bytes.length > MAX_CARD_FILE_BYTES) {
    throw new Error('角色卡文件超过 15MB 安全体积上限');
  }

  let pngCoverDataUrl: string | undefined;
  let rawJsonText = '';

  if (isPngBytes(bytes)) {
    pngCoverDataUrl = `data:image/png;base64,${uint8ArrayToBase64(bytes)}`;
    const chunks = decodePngTextChunks(bytes);
    const twPayload = chunks.get(PNG_TWCARD_KEYWORD);
    const charaPayload = chunks.get(PNG_CHARA_V2_KEYWORD);

    if (twPayload) {
      try {
        rawJsonText = strFromU8(base64ToUint8Array(twPayload.trim()));
      } catch {
        rawJsonText = twPayload;
      }
    } else if (charaPayload) {
      try {
        rawJsonText = strFromU8(base64ToUint8Array(charaPayload.trim()));
      } catch {
        throw new Error('PNG 内的社区角色卡（chara）元数据编码损坏');
      }
    } else {
      throw new Error(
        '这张 PNG 图片不包含角色卡数据（可能是经过微信/社交平台普通图片压缩导致元数据丢失，请让分享者发送「原图」或使用 .twcard.json 文件）'
      );
    }
  } else {
    rawJsonText = strFromU8(bytes).replace(/^\uFEFF/, '').trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJsonText) as Record<string, unknown>;
  } catch {
    throw new Error('角色卡不是有效的 JSON 格式');
  }

  // 1) 原生 The World 角色卡
  if (parsed.spec === TWCARD_MAGIC && parsed.character && typeof parsed.character === 'object') {
    const c = parsed.character as Record<string, unknown>;
    const rawAvatar = typeof c.avatarImage === 'string' ? c.avatarImage.trim() : '';
    const safeAvatar =
      rawAvatar.startsWith('data:image/') && rawAvatar.length <= MAX_AVATAR_DATA_URL_LEN
        ? rawAvatar
        : pngCoverDataUrl;
    const framingRaw = c.imageFramingId;
    const imageFramingId: ImageFramingId | undefined =
      framingRaw === 'avatar' || framingRaw === 'halfBody' || framingRaw === 'scene'
        ? framingRaw
        : undefined;
    const wh =
      parsed.worldHint && typeof parsed.worldHint === 'object'
        ? (parsed.worldHint as Record<string, unknown>)
        : undefined;

    return {
      spec: TWCARD_MAGIC,
      version: TWCARD_VERSION,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
      character: {
        name: String(c.name || '未命名角色').trim().slice(0, 80) || '未命名角色',
        identity: String(c.identity || '').slice(0, 200),
        personality: String(c.personality || '').slice(0, 4000),
        status: String(c.status || '').slice(0, 500),
        relationsNote: String(c.relationsNote || '').slice(0, 4000),
        notes: String(c.notes || '').slice(0, 8000),
        systemPrompt:
          typeof c.systemPrompt === 'string' && c.systemPrompt.trim()
            ? c.systemPrompt.trim().slice(0, 16000)
            : undefined,
        imageFramingId,
        imageStyleId:
          typeof c.imageStyleId === 'string' && c.imageStyleId.trim()
            ? c.imageStyleId.trim().slice(0, 40)
            : undefined,
        avatarColor:
          typeof c.avatarColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.avatarColor.trim())
            ? c.avatarColor.trim()
            : '#4d6bfe',
        avatarImage: safeAvatar,
        voiceName:
          typeof c.voiceName === 'string' && c.voiceName.trim()
            ? c.voiceName.trim().slice(0, 200)
            : undefined,
        userRelation: normalizeImportedHook(c.userRelation),
      },
      worldHint:
        wh && typeof wh.name === 'string' && wh.name.trim()
          ? {
              name: wh.name.trim().slice(0, 80),
              genre: typeof wh.genre === 'string' ? wh.genre.slice(0, 30) : '',
            }
          : undefined,
      voice: normalizeSharedVoice(parsed.voice),
    };
  }

  // 2) 兼容社区 TavernCard v1 / v2（chara_card_v2）格式
  const tavernData =
    parsed.data && typeof parsed.data === 'object'
      ? (parsed.data as Record<string, unknown>)
      : parsed;
  if (typeof tavernData.name === 'string' && tavernData.name.trim()) {
    const name = tavernData.name.trim().slice(0, 80);
    const description = typeof tavernData.description === 'string' ? tavernData.description.trim() : '';
    const personality = typeof tavernData.personality === 'string' ? tavernData.personality.trim() : '';
    const scenario = typeof tavernData.scenario === 'string' ? tavernData.scenario.trim() : '';
    const firstMes = typeof tavernData.first_mes === 'string' ? tavernData.first_mes.trim() : '';
    const sysPrompt =
      typeof tavernData.system_prompt === 'string' ? tavernData.system_prompt.trim() : '';

    const notesParts = [
      description,
      firstMes ? `【开场白参考】\n${firstMes}` : '',
    ].filter(Boolean);

    return {
      spec: TWCARD_MAGIC,
      version: TWCARD_VERSION,
      exportedAt: new Date().toISOString(),
      character: {
        name,
        identity: typeof tavernData.creator_notes === 'string' ? tavernData.creator_notes.slice(0, 120) : '',
        personality: personality.slice(0, 4000),
        status: scenario.slice(0, 500),
        relationsNote: '',
        notes: notesParts.join('\n\n').slice(0, 8000),
        systemPrompt: sysPrompt ? sysPrompt.slice(0, 16000) : undefined,
        avatarColor: '#4d6bfe',
        avatarImage: pngCoverDataUrl,
      },
    };
  }

  throw new Error('未识别的角色卡格式（支持 .twcard.json、The World PNG 角色卡及 TavernCard v2）');
}

/**
 * 将解析后的可分享角色卡物化为本地 `Character` 与可选 `VoiceProfile` 实体。
 */
export function materializeImportedCharacterCard(params: {
  card: ShareableCharacterCard;
  targetWorldId?: string;
  overrideVoiceId?: string;
  overrideProviderId?: string;
  overrideBaseUrl?: string;
  overrideModel?: string;
}): {
  character: Character;
  voiceProfile?: VoiceProfile;
} {
  const { card, targetWorldId = '' } = params;
  const now = Date.now();
  let voiceProfile: VoiceProfile | undefined;

  if (card.voice) {
    const v = card.voice;
    const hasUsableVoiceId = Boolean(
      params.overrideVoiceId ||
        v.kind === 'native' ||
        v.kind === 'public_preset' ||
        v.voiceId.trim()
    );
    if (hasUsableVoiceId || v.sampleAudio) {
      voiceProfile = {
        id: createId('voice'),
        name: v.name || `${card.character.name} 声线`,
        providerId: params.overrideProviderId || v.providerId,
        engine: v.engine,
        baseUrl: params.overrideBaseUrl || v.baseUrl,
        model: params.overrideModel || v.model,
        voiceId: params.overrideVoiceId ?? v.voiceId,
        rate: v.rate,
        pitch: v.pitch,
        volume: v.volume,
        gain: v.gain,
        styleInstruction: v.styleInstruction,
        isCloned: Boolean(params.overrideVoiceId || v.kind === 'cloned'),
        sourceText: v.sourceText,
        sampleAudio: v.sampleAudio,
        designPrompt: v.designPrompt,
        createdAt: now,
        updatedAt: now,
      };
    }
  }

  const character: Character = {
    id: createId('char'),
    worldId: targetWorldId,
    name: card.character.name,
    identity: card.character.identity,
    personality: card.character.personality,
    status: card.character.status,
    relationsNote: card.character.relationsNote,
    notes: card.character.notes,
    systemPrompt: card.character.systemPrompt,
    imageFramingId: card.character.imageFramingId,
    imageStyleId: card.character.imageStyleId,
    avatarColor: card.character.avatarColor || '#4d6bfe',
    avatarImage: card.character.avatarImage,
    voiceName: voiceProfile ? undefined : card.character.voiceName,
    voiceProfileId: voiceProfile?.id,
    userRelation: card.character.userRelation,
    updatedAt: now,
  };

  return { character, voiceProfile };
}
