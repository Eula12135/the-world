import { db } from '../db/database';
import type { Character, PersonaPreset, UserPersona, VoiceProfile } from '../types';
import { base64ToUint8Array, uint8ArrayToBase64 } from './llm';

export const MEDIA_REF_PREFIX = 'idb://media/';

/**
 * 运行时 ObjectURL 注册表：
 * - `mediaId -> objectUrl`：避免同一张立绘在每次 reload 时重复生成新的 blob: URL 引发图片闪烁
 * - `objectUrl -> mediaId`：组件保存编辑中的实体时，能把内存里的 `blob:...` 还原回持久化的 `idb://media/<id>`
 */
const urlByMediaId = new Map<string, string>();
const mediaIdByUrl = new Map<string, string>();

export function isMediaRef(val?: string | null): val is `${typeof MEDIA_REF_PREFIX}${string}` {
  return typeof val === 'string' && val.startsWith(MEDIA_REF_PREFIX);
}

export function extractMediaId(ref: string): string {
  return ref.slice(MEDIA_REF_PREFIX.length).trim();
}

export function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array } | null {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const meta = dataUrl.slice(5, comma);
  const mimeType = meta.split(';')[0]?.trim() || 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1).trim();
  if (!payload) return null;
  try {
    return {
      mimeType,
      bytes: base64ToUint8Array(payload),
    };
  } catch {
    return null;
  }
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType || 'application/octet-stream'};base64,${uint8ArrayToBase64(bytes)}`;
}

function getOrCreateObjectUrl(mediaId: string, bytes: Uint8Array, mimeType: string): string {
  const existing = urlByMediaId.get(mediaId);
  if (existing) return existing;

  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return bytesToDataUrl(bytes, mimeType);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  urlByMediaId.set(mediaId, url);
  mediaIdByUrl.set(url, mediaId);
  return url;
}

export function releaseMediaRefCache(mediaId: string): void {
  const url = urlByMediaId.get(mediaId);
  if (url) {
    urlByMediaId.delete(mediaId);
    mediaIdByUrl.delete(url);
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * 将内存中的媒体字段持久化到 `mediaBlobs` 表，返回轻量引用 `idb://media/<mediaId>`：
 * - 传入 `data:...`：解码写入 `mediaBlobs`，并刷新该 `mediaId` 的缓存
 * - 传入已映射的 `blob:...`：还原为对应的 `idb://media/<id>`（若目标 id 不同则复制一份）
 * - 传入 `idb://media/...`：原样保留（或复制到指定 `mediaId`）
 * - 传入空值：删除旧的 `mediaId` 记录并返回 `undefined`
 */
export async function externalizeMediaField(
  value: string | undefined,
  targetMediaId: string
): Promise<string | undefined> {
  if (!value || !value.trim()) {
    await deleteMediaBlob(targetMediaId);
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.startsWith('data:')) {
    const parsed = parseDataUrl(trimmed);
    if (!parsed || parsed.bytes.length === 0) return trimmed;
    releaseMediaRefCache(targetMediaId);
    await db.mediaBlobs.put({
      id: targetMediaId,
      mimeType: parsed.mimeType,
      bytes: parsed.bytes,
      size: parsed.bytes.length,
      createdAt: Date.now(),
    });
    return `${MEDIA_REF_PREFIX}${targetMediaId}`;
  }

  if (trimmed.startsWith('blob:')) {
    const srcId = mediaIdByUrl.get(trimmed);
    if (srcId) {
      if (srcId === targetMediaId) {
        return `${MEDIA_REF_PREFIX}${targetMediaId}`;
      }
      const srcBlob = await db.mediaBlobs.get(srcId);
      if (srcBlob) {
        releaseMediaRefCache(targetMediaId);
        await db.mediaBlobs.put({
          ...srcBlob,
          id: targetMediaId,
          createdAt: Date.now(),
        });
        return `${MEDIA_REF_PREFIX}${targetMediaId}`;
      }
    }
    return trimmed;
  }

  if (isMediaRef(trimmed)) {
    const srcId = extractMediaId(trimmed);
    if (srcId === targetMediaId) return trimmed;
    const srcBlob = await db.mediaBlobs.get(srcId);
    if (srcBlob) {
      releaseMediaRefCache(targetMediaId);
      await db.mediaBlobs.put({
        ...srcBlob,
        id: targetMediaId,
        createdAt: Date.now(),
      });
      return `${MEDIA_REF_PREFIX}${targetMediaId}`;
    }
    return trimmed;
  }

  return trimmed;
}

export async function deleteMediaBlob(mediaId: string): Promise<void> {
  releaseMediaRefCache(mediaId);
  await db.mediaBlobs.delete(mediaId).catch(() => {});
}

/**
 * 将存储层的 `idb://media/<id>` 解析为可直接给 `<img src>` / `<audio src>` 消费的 URL（浏览器用 `blob:`，Node 测试环境回退 `data:`）。
 */
export async function hydrateMediaField(stored?: string): Promise<string | undefined> {
  if (!stored) return undefined;
  if (!isMediaRef(stored)) return stored;
  const mediaId = extractMediaId(stored);
  const cached = urlByMediaId.get(mediaId);
  if (cached) return cached;
  const entry = await db.mediaBlobs.get(mediaId);
  if (!entry) return undefined;
  return getOrCreateObjectUrl(mediaId, entry.bytes, entry.mimeType);
}

/**
 * 批量水合一组实体上的媒体字段，单次 `bulkGet` 减少 IndexedDB 往返。
 */
async function hydrateEntitiesMedia<T>(
  items: T[],
  getRef: (item: T) => string | undefined,
  setUrl: (item: T, resolved: string | undefined) => T
): Promise<T[]> {
  const missingIds = new Set<string>();
  for (const item of items) {
    const ref = getRef(item);
    if (isMediaRef(ref)) {
      const id = extractMediaId(ref);
      if (!urlByMediaId.has(id)) missingIds.add(id);
    }
  }

  if (missingIds.size > 0) {
    const keys = Array.from(missingIds);
    const entries = await db.mediaBlobs.bulkGet(keys);
    for (const entry of entries) {
      if (entry) {
        getOrCreateObjectUrl(entry.id, entry.bytes, entry.mimeType);
      }
    }
  }

  return items.map((item) => {
    const ref = getRef(item);
    if (!isMediaRef(ref)) return item;
    const id = extractMediaId(ref);
    return setUrl(item, urlByMediaId.get(id));
  });
}

/**
 * 导出备份 / 分享角色卡 / 保存相册时调用：无论传入 `idb://media/...`、`blob:...` 还是 `data:...`，
 * 一律解析还原成自包含的 `data:<mime>;base64,...` 字符串。
 */
export async function resolveMediaToDataUrl(val?: string): Promise<string | undefined> {
  if (!val) return undefined;
  if (val.startsWith('data:')) return val;

  let mediaId: string | undefined;
  if (isMediaRef(val)) {
    mediaId = extractMediaId(val);
  } else if (val.startsWith('blob:')) {
    mediaId = mediaIdByUrl.get(val);
  }

  if (mediaId) {
    const entry = await db.mediaBlobs.get(mediaId);
    if (entry) {
      return bytesToDataUrl(entry.bytes, entry.mimeType);
    }
  }

  if (val.startsWith('blob:') && typeof fetch === 'function') {
    try {
      const resp = await fetch(val);
      const buf = new Uint8Array(await resp.arrayBuffer());
      return bytesToDataUrl(buf, resp.headers.get('content-type') || 'image/png');
    } catch {
      return undefined;
    }
  }

  return val;
}

export async function prepareCharacterForDb(char: Character): Promise<Character> {
  const avatarRef = await externalizeMediaField(char.avatarImage, `char_avatar_${char.id}`);
  return { ...char, avatarImage: avatarRef };
}

export async function hydrateCharactersFromDb(chars: Character[]): Promise<Character[]> {
  return hydrateEntitiesMedia(chars, (c) => c.avatarImage, (c, url) => ({
    ...c,
    avatarImage: url,
  }));
}

export async function prepareUserPersonaForDb(persona: UserPersona): Promise<UserPersona> {
  const avatarRef = await externalizeMediaField(persona.avatarImage, `up_avatar_${persona.id}`);
  return { ...persona, avatarImage: avatarRef };
}

export async function hydrateUserPersonasFromDb(personas: UserPersona[]): Promise<UserPersona[]> {
  return hydrateEntitiesMedia(personas, (p) => p.avatarImage, (p, url) => ({
    ...p,
    avatarImage: url,
  }));
}

export async function preparePersonaPresetForDb(preset: PersonaPreset): Promise<PersonaPreset> {
  const avatarRef = await externalizeMediaField(preset.avatarImage, `preset_avatar_${preset.id}`);
  return { ...preset, avatarImage: avatarRef };
}

export async function hydratePersonaPresetsFromDb(
  presets: PersonaPreset[]
): Promise<PersonaPreset[]> {
  return hydrateEntitiesMedia(presets, (p) => p.avatarImage, (p, url) => ({
    ...p,
    avatarImage: url,
  }));
}

export async function prepareVoiceProfileForDb(profile: VoiceProfile): Promise<VoiceProfile> {
  const sampleRef = await externalizeMediaField(
    profile.sampleAudio,
    `voice_sample_${profile.id}`
  );
  return { ...profile, sampleAudio: sampleRef };
}

export async function hydrateVoiceProfilesFromDb(
  profiles: VoiceProfile[]
): Promise<VoiceProfile[]> {
  return hydrateEntitiesMedia(profiles, (p) => p.sampleAudio, (p, url) => ({
    ...p,
    sampleAudio: url,
  }));
}
