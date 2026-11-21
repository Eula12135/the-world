import type { ProviderConfig, VoiceConfig, VoiceProfile } from '../types';
import {
  base64ToUint8Array,
  crossPlatformFetchBinary,
  crossPlatformFetchJson,
  crossPlatformUploadMultipart,
  uint8ArrayToBase64,
} from './llm';
import { isLocalEndpointUrl, resolveReusableApiKey } from './imageGenService';

export interface TtsPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  model: string;
  models?: string[];
  defaultVoice: string;
  consoleUrl: string;
  supportsVoiceDesign?: boolean;
}

export interface SttPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  model: string;
  consoleUrl: string;
}

export interface RemoteClonedVoice {
  model: string;
  customName: string;
  text: string;
  uri: string;
}

export const TTS_PRESETS: TtsPreset[] = [
  {
    id: 'breeze',
    name: 'Breeze TTS 2（一句话捏音色）',
    description: '支持中文自然语言描述音色表演指令，以及使用账号内已克隆音色',
    baseUrl: 'https://api.breeze.blue',
    model: 'breeze-tts-2',
    defaultVoice: '',
    consoleUrl: 'https://docs.breezeblue.ai/',
    supportsVoiceDesign: true,
  },
  {
    id: 'siliconflow_tts',
    name: '硅基流动（CosyVoice2 / IndexTTS）',
    description: '高性价比中文语音、情绪控制与音色克隆，可自动复用文本 Key',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    models: [
      'FunAudioLLM/CosyVoice2-0.5B',
      'IndexTeam/IndexTTS-2',
      'fishaudio/fish-speech-1.5',
    ],
    defaultVoice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    supportsVoiceDesign: true,
  },
  {
    id: 'fish_audio',
    name: 'Fish Audio',
    description: '海量社区与二次元音色库，支持中英日多语种高质量合成',
    baseUrl: 'https://api.fish.audio/v1',
    model: 'speech-1.6',
    defaultVoice: 'default',
    consoleUrl: 'https://fish.audio/app/api-keys/',
  },
  {
    id: 'minimax_tts',
    name: 'MiniMax 海螺语音',
    description: '中文长文本演绎与有声小说角色感极强',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'speech-02-hd',
    defaultVoice: 'male-qn-qingse',
    consoleUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    id: 'elevenlabs_tts',
    name: 'ElevenLabs',
    description: '影视级多语种人声演绎（兼容 OpenAI 协议）',
    baseUrl: 'https://api.elevenlabs.io/v1',
    model: 'eleven_multilingual_v2',
    defaultVoice: 'Rachel',
    consoleUrl: 'https://elevenlabs.io/app/settings/api-keys',
  },
  {
    id: 'dashscope_tts',
    name: '阿里云百炼 CosyVoice',
    description: '阿里云托管版通义 CosyVoice 语音合成，可复用百炼 Key',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'cosyvoice-v2',
    defaultVoice: 'longxiaochun_v2',
    consoleUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
  },
  {
    id: 'openai_tts',
    name: 'OpenAI TTS',
    description: '官方 gpt-4o-mini-tts，支持自然语言语气指导',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-tts',
    defaultVoice: 'alloy',
    consoleUrl: 'https://platform.openai.com/api-keys',
    supportsVoiceDesign: true,
  },
];

export const STT_PRESETS: SttPreset[] = [
  {
    id: 'siliconflow_stt',
    name: '硅基流动 SenseVoiceSmall（推荐 · 含免费额度）',
    description: '阿里通义开源中文/中英混合高速语音识别，有免费体验额度',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'groq_stt',
    name: 'Groq Whisper Large v3 Turbo（免费额度高）',
    description: 'Groq 极速 Whisper 接口，提供慷慨免费层',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    consoleUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openai_stt',
    name: 'OpenAI Whisper / 本地 whisper.cpp',
    description: '标准 /v1/audio/transcriptions 接口',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
];

export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' 代码片段已略过 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSpeechChunks(text: string, maxLen = 220): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const sentences = clean
    .split(/(?<=[。！？；.!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (s.length > maxLen) {
      if (buf) {
        chunks.push(buf);
        buf = '';
      }
      for (let i = 0; i < s.length; i += maxLen) {
        chunks.push(s.slice(i, i + maxLen));
      }
      continue;
    }
    if (buf.length + s.length > maxLen) {
      if (buf) chunks.push(buf);
      buf = s;
    } else {
      buf += (buf ? ' ' : '') + s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export function resolveEffectiveVoiceConfig(
  baseConfig: VoiceConfig,
  profile?: VoiceProfile | null
): VoiceConfig {
  if (!profile) return baseConfig;
  return {
    ...baseConfig,
    ttsEngine: profile.engine,
    ttsRate: profile.rate,
    ttsPitch: profile.pitch,
    ttsVolume: profile.volume,
    ttsGain: profile.gain,
    ttsStyleInstruction: profile.styleInstruction,
    ttsBaseUrl: profile.baseUrl?.trim() || baseConfig.ttsBaseUrl,
    ttsModel: profile.model?.trim() || baseConfig.ttsModel,
    ttsNativeVoice:
      profile.engine === 'native' && profile.voiceId ? profile.voiceId : baseConfig.ttsNativeVoice,
    ttsVoice:
      profile.engine === 'openai_api'
        ? profile.voiceId ||
          (isBreezeCloudBase(profile.baseUrl?.trim() || baseConfig.ttsBaseUrl) ? '' : baseConfig.ttsVoice)
        : baseConfig.ttsVoice,
  };
}

export interface BreezeVoiceItem {
  voiceId: string;
  name: string;
  category?: string;
}

export function isBreezeCloudBase(baseUrl: string): boolean {
  return /api\.breeze\.blue|breezeblue\.ai/i.test(baseUrl.trim());
}

export function normalizeBreezeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (!trimmed || /breezeblue\.ai/i.test(trimmed)) {
    return 'https://api.breeze.blue';
  }
  return trimmed;
}

export function buildBreezeTtsPayload(params: {
  text: string;
  model?: string;
  instructions?: string;
  guidanceScale?: number;
  languageCode?: string;
}): Record<string, unknown> {
  const rawModel = params.model?.trim() || '';
  const normalizedModel =
    !rawModel || /^breezeblue\/breeze-tts-2$/i.test(rawModel) ? 'breeze-tts-2' : rawModel;
  const trimmedInstructions = (params.instructions || '').trim();

  // Breeze 云端接口对请求体采用严格 5 字段白名单，多余字段会触发 HTTP 422。
  // guidance_scale 默认取 1.0：部分实现按 >= 1 校验（0.6 会直接 422），
  // 而按 (0,1] 校验的实现中 1.0 同样是合法上界，两边都安全。
  const payload: Record<string, unknown> = {
    text: params.text.slice(0, 4000),
    model_id: normalizedModel,
    language_code: params.languageCode || 'zh',
    voice_settings: {
      guidance_scale: params.guidanceScale ?? 1.0,
    },
  };

  if (trimmedInstructions) {
    payload.instructions = trimmedInstructions;
  }

  return payload;
}

export interface BreezeVoicePreview {
  generatedVoiceId: string;
  audioBase64: string;
  mediaType: string;
  durationSecs?: number;
}

interface BreezeErrorBody {
  code?: string;
  detail?: string;
  error?: string;
}

function breezeError(status: number, text: string): Error {
  let msg = '';
  try {
    const body = JSON.parse(text) as BreezeErrorBody;
    msg = [body?.detail, body?.error, body?.code].filter(Boolean).join(' · ');
  } catch {
    msg = text.slice(0, 160);
  }
  return new Error(`Breeze 请求失败 (HTTP ${status})${msg ? `：${msg}` : ''}`);
}

/**
 * Voice Design：用一段自然语言描述凭空生成音色（不会沿用账号里已有的音色）。
 * 对应 POST /v1/voice-previews/design，返回若干候选预览，每个带 generated_voice_id。
 * 预览是临时的，需再调用 saveBreezeVoiceDesign 才会变成正式音色。
 */
export async function designBreezeVoice(params: {
  baseUrl: string;
  apiKey: string;
  providers: ProviderConfig[];
  description: string;
  text?: string;
  model?: string;
  languageCode?: string;
  guidanceScale?: number;
  previewCount?: number;
}): Promise<BreezeVoicePreview[]> {
  const breezeBase = normalizeBreezeBaseUrl(params.baseUrl);
  const apiKey =
    resolveReusableApiKey(breezeBase, params.apiKey, params.providers) ||
    resolveReusableApiKey(params.baseUrl.trim().replace(/\/+$/, ''), params.apiKey, params.providers);
  if (!apiKey) throw new Error('请先填写 Breeze API Key');

  const description = params.description.trim();
  if (description.length < 3) throw new Error('音色描述至少需要 3 个字，例如「慵懒御姐，慢速，略带气声」');

  const body: Record<string, unknown> = {
    voice_description: description.slice(0, 500),
    preview_count: Math.min(3, Math.max(1, params.previewCount ?? 1)),
  };
  const previewScript = (params.text || '').trim();
  if (previewScript.length >= 3) body.text = previewScript.slice(0, 500);
  if (params.model?.trim()) body.model_id = params.model.trim();
  if (params.languageCode) body.language_code = params.languageCode;
  if (typeof params.guidanceScale === 'number') {
    body.guidance_scale = Math.min(10, Math.max(1, params.guidanceScale));
  }

  const resp = await crossPlatformFetchJson({
    url: `${breezeBase}/v1/voice-previews/design?output_format=mp3`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw breezeError(resp.status, resp.text);

  const parsed = JSON.parse(resp.text) as {
    previews?: Array<{
      generated_voice_id?: string;
      audio_base_64?: string;
      media_type?: string;
      duration_secs?: number | null;
    }>;
  };
  const rows = Array.isArray(parsed?.previews) ? parsed.previews : [];
  return rows
    .filter((p) => Boolean(p?.generated_voice_id && p?.audio_base_64))
    .map((p) => ({
      generatedVoiceId: String(p.generated_voice_id),
      audioBase64: String(p.audio_base_64),
      mediaType: p.media_type ? String(p.media_type) : 'audio/mpeg',
      durationSecs: typeof p.duration_secs === 'number' ? p.duration_secs : undefined,
    }));
}

/** 把 Voice Design 的临时预览保存成正式音色，返回可用于 TTS 的 voice_id。 */
export async function saveBreezeVoiceDesign(params: {
  baseUrl: string;
  apiKey: string;
  providers: ProviderConfig[];
  generatedVoiceId: string;
  name: string;
  languageCode?: string;
  description?: string;
}): Promise<{ voiceId: string; name: string }> {
  const breezeBase = normalizeBreezeBaseUrl(params.baseUrl);
  const apiKey =
    resolveReusableApiKey(breezeBase, params.apiKey, params.providers) ||
    resolveReusableApiKey(params.baseUrl.trim().replace(/\/+$/, ''), params.apiKey, params.providers);
  if (!apiKey) throw new Error('请先填写 Breeze API Key');
  if (!params.generatedVoiceId) throw new Error('缺少预览 ID，请先生成音色预览');

  const body: Record<string, unknown> = {
    voice_name: params.name.trim().slice(0, 80) || '我的自定义音色',
    language_code: params.languageCode || 'zh',
  };
  if (params.description?.trim()) {
    body.voice_description = params.description.trim().slice(0, 1000);
  }

  const resp = await crossPlatformFetchJson({
    url: `${breezeBase}/v1/voice-previews/${encodeURIComponent(params.generatedVoiceId)}/save`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw breezeError(resp.status, resp.text);

  const parsed = JSON.parse(resp.text) as { voice_id?: string; name?: string };
  const voiceId = String(parsed?.voice_id || '').trim();
  if (!voiceId) throw new Error('保存成功但接口未返回 voice_id');
  return { voiceId, name: String(parsed?.name || body.voice_name) };
}

export async function listBreezeVoices(params: {
  baseUrl: string;
  apiKey: string;
  providers: ProviderConfig[];
}): Promise<BreezeVoiceItem[]> {
  const breezeBase = normalizeBreezeBaseUrl(params.baseUrl);
  const apiKey =
    resolveReusableApiKey(breezeBase, params.apiKey, params.providers) ||
    resolveReusableApiKey(params.baseUrl.trim().replace(/\/+$/, ''), params.apiKey, params.providers);
  if (!apiKey) {
    throw new Error('请先填写 Breeze API Key');
  }

  const resp = await crossPlatformFetchJson({
    url: `${breezeBase}/v1/voices`,
    method: 'GET',
    headers: { 'xi-api-key': apiKey },
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const errObj = JSON.parse(resp.text);
      detail = String(errObj?.detail || errObj?.message || errObj?.error?.message || '');
    } catch {
      detail = resp.text.slice(0, 140);
    }
    throw new Error(
      `获取 Breeze 音色列表失败 (HTTP ${resp.status})${detail ? `: ${detail}` : ''}`
    );
  }

  const parsed = JSON.parse(resp.text);
  const rows: Array<Record<string, unknown>> = Array.isArray(parsed?.voices)
    ? parsed.voices
    : Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [];

  return rows
    .filter((v) => Boolean(v && (v.voice_id || v.id)))
    .map((v) => {
      const voiceId = String(v.voice_id || v.id).trim();
      return {
        voiceId,
        name: String(v.name || voiceId),
        category: v.category ? String(v.category) : undefined,
      };
    });
}

export function buildTtsSpeechPayload(params: {
  model: string;
  text: string;
  voice: string;
  rate: number;
  gain: number;
  styleInstruction?: string;
}): Record<string, unknown> {
  const { model, text, voice, rate, gain, styleInstruction } = params;
  const trimmedInstruction = (styleInstruction || '').trim();
  const isBreeze = /breeze/i.test(model);
  const isCosyVoice = !isBreeze && /cosyvoice/i.test(model);
  const isOpenAiMiniTts = /gpt-4o-mini-tts/i.test(model);

  const finalInput =
    isCosyVoice && trimmedInstruction
      ? `${trimmedInstruction} <|endofprompt|>${text.slice(0, 3800)}`
      : text.slice(0, 4000);

  const payload: Record<string, unknown> = {
    model,
    input: finalInput,
    response_format: isBreeze ? 'wav' : 'mp3',
    // 语速下限锁到 1.0：不少兼容网关对 speed 做 ge=1 校验，发 0.5 会直接 422。
    // 慢速改由播放端 playbackRate 实现（见 speakText），听感更自然且不改变音高。
    speed: Math.max(1, Math.min(4.0, Number(rate) || 1)),
  };

  if (voice.trim()) {
    payload.voice = voice.trim();
  } else if (!isBreeze) {
    payload.voice = 'alloy';
  }

  if (isBreeze && trimmedInstruction) {
    payload.instructions = trimmedInstruction;
    payload.extra_params = { guidance_scale: 4.0 };
  }

  if (isCosyVoice) {
    payload.gain = Math.max(-10, Math.min(10, Number(gain) || 0));
  }
  if (isOpenAiMiniTts && trimmedInstruction) {
    payload.instructions = trimmedInstruction;
  }

  return payload;
}

/**
 * 把上游返回的 JSON 错误体压成一句人话。
 * 422 通常是「参数取值越界」（例如 speed / guidance_scale 要求 >= 1），
 * 原文只是一串 JSON，直接丢给用户只会更困惑。
 */
export function formatTtsHttpError(status: number, errorText: string): string {
  const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  let detail = '';
  try {
    const parsed = JSON.parse(errorText);
    detail =
      pick(parsed?.detail) ||
      pick(parsed?.error?.message) ||
      pick(parsed?.error) ||
      pick(parsed?.message);
  } catch {
    detail = errorText.trim().slice(0, 160);
  }

  const head = `TTS 接口失败 (HTTP ${status})${detail ? `：${detail}` : ''}`;
  if (status === 422) {
    return `${head}\n\n服务端判定参数不合法。请先把语速调回 1.00x、清空音色描述再试一次；若仍然 422，说明该接口不支持当前「模型 + 参数」组合，建议换用硅基流动或 OpenAI 官方语音接口。`;
  }
  if (status === 401 || status === 403) {
    return `${head}\n\n鉴权失败：请检查「模型 → 语音」里的 TTS API Key 是否正确、是否已过期。`;
  }
  return head;
}

export function sanitizeCloneCustomName(rawName: string): string {
  const asciiOnly = rawName
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return asciiOnly || `voice_${Date.now().toString(36)}`;
}

export function listNativeVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch {
    return [];
  }
}

let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;
let speechGenerationId = 0;

export function stopSpeaking(): void {
  speechGenerationId++;
  if (typeof window !== 'undefined') {
    try {
      window.TheWorldAndroid?.stopSpeaking?.();
    } catch {
      // ignore
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.src = '';
    } catch {
      // ignore
    }
    activeAudio = null;
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }
}

export async function speakText(params: {
  text: string;
  config: VoiceConfig;
  providers: ProviderConfig[];
  profile?: VoiceProfile | null;
  voiceOverride?: string;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}): Promise<void> {
  const { text, config, providers, profile, voiceOverride, onEnd, onError } = params;
  const effective = resolveEffectiveVoiceConfig(config, profile);
  const cleanText = stripMarkdownForSpeech(text);
  if (!cleanText) {
    onEnd?.();
    return;
  }

  stopSpeaking();
  const token = ++speechGenerationId;
  const rate = Math.max(0.5, Math.min(2.0, effective.ttsRate || 1));
  const pitch = Math.max(0.5, Math.min(2.0, effective.ttsPitch || 1));
  const volume = Math.max(0.1, Math.min(1.0, effective.ttsVolume ?? 1));

  if (effective.ttsEngine === 'native') {
    if (typeof window !== 'undefined' && window.TheWorldAndroid?.speak) {
      window.TheWorldAndroid.speak(cleanText.slice(0, 3800), rate, pitch);
      onEnd?.();
      return;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const chunks = splitSpeechChunks(cleanText, 220);
      const voices = listNativeVoices();
      const targetVoiceName = voiceOverride || effective.ttsNativeVoice;
      const chosenVoice =
        (targetVoiceName && voices.find((v) => v.name === targetVoiceName)) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('zh')) ||
        undefined;

      let idx = 0;
      const speakNext = () => {
        if (token !== speechGenerationId) return;
        if (idx >= chunks.length) {
          onEnd?.();
          return;
        }
        const utter = new SpeechSynthesisUtterance(chunks[idx++]);
        utter.lang = chosenVoice?.lang || 'zh-CN';
        utter.rate = rate;
        utter.pitch = pitch;
        utter.volume = volume;
        if (chosenVoice) utter.voice = chosenVoice;
        utter.onend = () => speakNext();
        utter.onerror = () => {
          if (token === speechGenerationId) {
            onEnd?.();
          }
        };
        window.speechSynthesis.speak(utter);
      };
      speakNext();
      return;
    }

    onError?.('当前运行环境不支持系统原生语音朗读，请切换至自定义 TTS API');
    return;
  }

  const cleanBase = effective.ttsBaseUrl.trim().replace(/\/+$/, '');
  const isBreezeCloud = isBreezeCloudBase(cleanBase);
  const model = effective.ttsModel.trim() || (isBreezeCloud ? 'breeze-tts-2' : '');
  const isBreeze = /breeze/i.test(model) || isBreezeCloud;
  if (!cleanBase || !model) {
    onError?.('请先配置 TTS API 的 Base URL 与模型名称');
    return;
  }

  const breezeBase = isBreezeCloud ? normalizeBreezeBaseUrl(cleanBase) : cleanBase;
  const apiKey =
    resolveReusableApiKey(breezeBase, effective.ttsApiKey, providers) ||
    resolveReusableApiKey(cleanBase, effective.ttsApiKey, providers);
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    onError?.('请先在「模型 → 语音」配置 TTS API Key');
    return;
  }

  try {
    type SynthBin = {
      ok: boolean;
      status: number;
      contentType: string;
      base64: string;
      errorText: string;
    };

    // Breeze 的 voiceId 与文本无关，先解析一次（可能触发拉取音色列表）
    let breezeVoiceId = '';
    if (isBreezeCloud) {
      breezeVoiceId = (voiceOverride || effective.ttsVoice || '').trim();
      if (!breezeVoiceId) {
        const voices = await listBreezeVoices({ baseUrl: breezeBase, apiKey, providers });
        if (token !== speechGenerationId) return;
        if (voices.length === 0) {
          onError?.('Breeze 账号下暂无可用音色，请先在 Breeze 控制台创建音色或点击同步音色');
          return;
        }
        breezeVoiceId = voices[0].voiceId;
      }
    }

    const ttsVoice =
      (voiceOverride || effective.ttsVoice || '').trim() || (isBreeze ? '' : 'alloy');
    const openAiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) openAiHeaders.Authorization = `Bearer ${apiKey}`;

    const synthesize = async (chunkText: string): Promise<SynthBin> => {
      if (isBreezeCloud) {
        return crossPlatformFetchBinary({
          url: `${breezeBase}/v1/text-to-speech/${encodeURIComponent(breezeVoiceId)}?output_format=mp3_44100_128`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify(
            buildBreezeTtsPayload({
              text: chunkText,
              model,
              instructions: effective.ttsStyleInstruction,
            })
          ),
        });
      }
      return crossPlatformFetchBinary({
        url: `${cleanBase}/audio/speech`,
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify(
          buildTtsSpeechPayload({
            model,
            text: chunkText,
            voice: ttsVoice,
            rate,
            gain: effective.ttsGain ?? 0,
            styleInstruction: effective.ttsStyleInstruction,
          })
        ),
      });
    };

    // 语速补偿：只有「非 Breeze 云端 且 rate >= 1」时服务端才真的按用户语速合成。
    // 其余情况（rate < 1 会被 ge=1 校验挡下；Breeze 云端根本没有 speed 字段）
    // 改在播放端用 playbackRate 减速/加速——它只拉伸时间轴、保持音高，更适合人声。
    const speedHandledByServer = !isBreezeCloud && rate >= 1;
    const playbackRate = !speedHandledByServer && Math.abs(rate - 1) > 0.001 ? rate : 1;

    const playOne = (bin: SynthBin) =>
      new Promise<void>((resolve, reject) => {
        const bytes = base64ToUint8Array(bin.base64);
        const mime = bin.contentType?.startsWith('audio/')
          ? bin.contentType
          : !isBreezeCloud && isBreeze
            ? 'audio/wav'
            : 'audio/mpeg';
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          URL.revokeObjectURL(url);
          if (activeAudio === audio) {
            activeAudio = null;
            activeAudioUrl = null;
          }
        };
        audio.volume = volume;
        if (playbackRate !== 1) audio.playbackRate = playbackRate;
        activeAudio = audio;
        activeAudioUrl = url;
        audio.onended = () => {
          finish();
          resolve();
        };
        // 被 stopSpeaking() 打断时不会触发 onended，用 onpause 让 await 及时返回
        audio.onpause = () => {
          finish();
          resolve();
        };
        audio.onerror = () => {
          finish();
          reject(new Error('音频播放失败'));
        };
        audio.play().catch((err) => {
          finish();
          reject(err instanceof Error ? err : new Error('音频播放失败'));
        });
      });

    // 长文本按句切开：播第一句的同时合成下一句，首字延迟从「整段合成」降到「一句合成」
    const chunks = cleanText.length > 260 ? splitSpeechChunks(cleanText, 220) : [cleanText];
    let prefetched: Promise<SynthBin> | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const current = prefetched ?? synthesize(chunks[i]);
      prefetched = i + 1 < chunks.length ? synthesize(chunks[i + 1]) : null;
      // 中途被停止时预取请求仍会返回，提前挂 catch 避免 unhandled rejection
      prefetched?.catch(() => undefined);

      const bin = await current;
      if (token !== speechGenerationId) return;
      if (!bin.ok || !bin.base64) {
        onError?.(formatTtsHttpError(bin.status, bin.errorText));
        return;
      }
      await playOne(bin);
      if (token !== speechGenerationId) return;
    }

    stopSpeaking();
    onEnd?.();
  } catch (err) {
    if (token === speechGenerationId) {
      onError?.(err instanceof Error ? err.message : 'TTS 合成失败');
    }
  }
}

export async function audioBlobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type || 'audio/mpeg';
  return `data:${mime};base64,${uint8ArrayToBase64(bytes)}`;
}

export async function uploadClonedVoice(params: {
  baseUrl: string;
  apiKey: string;
  providers: ProviderConfig[];
  model: string;
  customName: string;
  text: string;
  audioDataUrl: string;
}): Promise<{ uri: string }> {
  const cleanBase = params.baseUrl.trim().replace(/\/+$/, '');
  const apiKey = resolveReusableApiKey(cleanBase, params.apiKey, params.providers);
  if (!cleanBase) throw new Error('请先填写 TTS Base URL');
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    throw new Error('请先填写 TTS API Key（或配置同域名文本厂商 Key 自动复用）');
  }
  if (!params.text.trim()) {
    throw new Error('请填写参考音频里说话的准确文字内容');
  }
  if (!params.audioDataUrl.startsWith('data:')) {
    throw new Error('参考音频格式无效');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/uploads/audio/voice`,
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model.trim() || 'FunAudioLLM/CosyVoice2-0.5B',
      customName: sanitizeCloneCustomName(params.customName),
      text: params.text.trim(),
      audio: params.audioDataUrl,
    }),
  });

  if (!resp.ok) {
    let msg = `音色克隆上传失败 (HTTP ${resp.status})`;
    try {
      const errObj = JSON.parse(resp.text);
      if (errObj?.message) msg = errObj.message;
      else if (errObj?.error?.message) msg = errObj.error.message;
    } catch {
      if (resp.text) msg = `${msg}: ${resp.text.slice(0, 140)}`;
    }
    throw new Error(msg);
  }

  const parsed = JSON.parse(resp.text);
  const uri = String(parsed?.uri || '').trim();
  if (!uri) {
    throw new Error('接口成功返回但未包含音色 uri');
  }
  return { uri };
}

export async function listRemoteClonedVoices(params: {
  baseUrl: string;
  apiKey: string;
  providers: ProviderConfig[];
}): Promise<RemoteClonedVoice[]> {
  const cleanBase = params.baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBase) throw new Error('请先填写 TTS Base URL');

  if (isBreezeCloudBase(cleanBase)) {
    const voices = await listBreezeVoices(params);
    return voices.map((v) => ({
      model: 'breeze-tts-2',
      customName: v.name,
      text: v.category || 'Breeze 音色',
      uri: v.voiceId,
    }));
  }

  const apiKey = resolveReusableApiKey(cleanBase, params.apiKey, params.providers);
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    throw new Error('请先填写 TTS API Key');
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/audio/voice/list`,
    method: 'GET',
    headers,
  });

  if (!resp.ok) {
    throw new Error(`同步账号克隆音色列表失败 (HTTP ${resp.status})`);
  }
  const parsed = JSON.parse(resp.text);
  const rows = Array.isArray(parsed?.results)
    ? parsed.results
    : Array.isArray(parsed?.result)
      ? parsed.result
      : [];
  return rows
    .filter((r: Record<string, unknown>) => Boolean(r && r.uri))
    .map((r: Record<string, unknown>) => ({
      model: String(r.model || ''),
      customName: String(r.customName || r.uri),
      text: String(r.text || ''),
      uri: String(r.uri),
    }));
}

export async function deleteRemoteClonedVoice(params: {
  baseUrl: string;
  apiKey: string;
  providers: ProviderConfig[];
  uri: string;
}): Promise<void> {
  const cleanBase = params.baseUrl.trim().replace(/\/+$/, '');
  const apiKey = resolveReusableApiKey(cleanBase, params.apiKey, params.providers);
  if (!cleanBase || (!apiKey && !isLocalEndpointUrl(cleanBase))) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  await crossPlatformFetchJson({
    url: `${cleanBase}/audio/voice/deletions`,
    method: 'POST',
    headers,
    body: JSON.stringify({ uri: params.uri }),
  });
}

export interface VoiceCaptureHandle {
  stop: () => void;
}

export function startVoiceCapture(params: {
  config: VoiceConfig;
  providers: ProviderConfig[];
  onResult: (text: string) => void;
  onStatus?: (status: 'listening' | 'transcribing') => void;
  onError: (msg: string) => void;
  onDone: () => void;
}): VoiceCaptureHandle {
  const { config, providers, onResult, onStatus, onError, onDone } = params;

  if (config.sttEngine === 'native') {
    if (typeof window !== 'undefined' && window.TheWorldAndroid?.startNativeStt) {
      let settled = false;
      const cleanup = () => {
        window.removeEventListener('theworld-stt', handler);
      };
      const handler = (ev: Event) => {
        if (settled) return;
        settled = true;
        cleanup();
        const detail = (ev as CustomEvent<{ text?: string; error?: string; canceled?: boolean }>)
          .detail;
        if (detail?.error) {
          onError(detail.error);
        } else if (detail?.text) {
          onResult(detail.text);
        }
        onDone();
      };
      window.addEventListener('theworld-stt', handler);
      onStatus?.('listening');
      window.TheWorldAndroid.startNativeStt(
        config.sttLanguage === 'en' ? 'en-US' : 'zh-CN'
      );
      return {
        stop: () => {
          if (!settled) {
            settled = true;
            cleanup();
            onDone();
          }
        },
      };
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: ((ev: { error?: string }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: ((ev: { error?: string }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
    };

    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      onError(
        '当前桌面环境暂不支持系统离线识别，可在「模型 → 语音」将输入切换为硅基流动 SenseVoiceSmall（含免费额度）'
      );
      onDone();
      return { stop: () => {} };
    }

    const recognition = new SpeechRec();
    recognition.lang = config.sttLanguage === 'en' ? 'en-US' : 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    let stopped = false;

    recognition.onresult = (ev) => {
      let full = '';
      for (let i = 0; i < ev.results.length; i++) {
        full += ev.results[i][0]?.transcript || '';
      }
      if (full.trim()) onResult(full.trim());
    };
    recognition.onerror = (ev) => {
      if (!stopped) {
        onError(`语音识别失败 (${ev.error || 'unknown'})`);
      }
    };
    recognition.onend = () => {
      onDone();
    };
    onStatus?.('listening');
    recognition.start();
    return {
      stop: () => {
        stopped = true;
        try {
          recognition.stop();
        } catch {
          onDone();
        }
      },
    };
  }

  const cleanBase = config.sttBaseUrl.trim().replace(/\/+$/, '');
  const model = config.sttModel.trim();
  const apiKey = resolveReusableApiKey(cleanBase, config.sttApiKey, providers);

  if (!cleanBase || !model) {
    onError('请先在「模型 → 语音」填写 STT 接口地址和模型');
    onDone();
    return { stop: () => {} };
  }
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    onError('请先在「模型 → 语音」填写 STT API Key（同域名厂商可自动复用）');
    onDone();
    return { stop: () => {} };
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    onError('当前环境不支持麦克风录音');
    onDone();
    return { stop: () => {} };
  }

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let canceled = false;

  const stopTracks = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((mediaStream) => {
      if (canceled) {
        mediaStream.getTracks().forEach((t) => t.stop());
        onDone();
        return;
      }
      stream = mediaStream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      recorder = mimeType
        ? new MediaRecorder(mediaStream, { mimeType })
        : new MediaRecorder(mediaStream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = async () => {
        stopTracks();
        if (chunks.length === 0) {
          onDone();
          return;
        }
        onStatus?.('transcribing');
        try {
          const finalMime = recorder?.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: finalMime });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const ext = finalMime.includes('mp4') ? 'm4a' : 'webm';
          const headers: Record<string, string> = {};
          if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

          const resp = await crossPlatformUploadMultipart({
            url: `${cleanBase}/audio/transcriptions`,
            headers,
            fields: {
              model,
              ...(config.sttLanguage ? { language: config.sttLanguage } : {}),
            },
            fileField: 'file',
            fileName: `voice.${ext}`,
            fileMime: finalMime,
            fileBase64: uint8ArrayToBase64(bytes),
          });
          if (!resp.ok) {
            onError(`语音转文字失败 (HTTP ${resp.status})`);
          } else {
            const parsed = JSON.parse(resp.text);
            const text = String(parsed?.text || '').trim();
            if (text) onResult(text);
            else onError('未识别出语音内容');
          }
        } catch (err) {
          onError(err instanceof Error ? err.message : '语音上传转写失败');
        } finally {
          onDone();
        }
      };

      onStatus?.('listening');
      recorder.start();
    })
    .catch((err) => {
      onError(err instanceof Error ? `无法访问麦克风: ${err.message}` : '无法访问麦克风');
      onDone();
    });

  return {
    stop: () => {
      canceled = true;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        stopTracks();
        onDone();
      }
    },
  };
}
