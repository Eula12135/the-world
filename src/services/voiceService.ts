import type {
  MediaProviderCredential,
  ProviderConfig,
  VoiceConfig,
  VoiceProfile,
} from '../types';
import {
  base64ToUint8Array,
  crossPlatformFetchBinary,
  crossPlatformFetchJson,
  crossPlatformUploadMultipart,
  safeJsonParse,
  uint8ArrayToBase64,
} from './llm';
import {
  extractEndpointHost,
  isLocalEndpointUrl,
  resolveMediaApiKey,
} from './imageGenService';
import { createId, detectUnreachableLocalhost } from '../utils/platform';

export type TtsCapability =
  | 'voice_design'
  | 'preset_and_clone'
  | 'preset_and_style'
  | 'custom';

export interface TtsPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  model: string;
  models?: string[];
  defaultVoice: string;
  consoleUrl: string;
  capability: TtsCapability;
  supportsVoiceDesign?: boolean;
  supportsClone?: boolean;
  supportsModelRefresh?: boolean;
}

export interface SttPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  model: string;
  models?: string[];
  consoleUrl: string;
}

export interface BuiltinVoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male' | 'neutral';
  styleHint?: string;
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
    description: '支持中文自然语言描述凭空捏音色，以及使用账号内已克隆音色',
    baseUrl: 'https://api.breeze.blue',
    model: 'breeze-tts-2',
    models: ['breeze-tts-2', 'breeze-tts-2-multilingual'],
    defaultVoice: '',
    consoleUrl: 'https://docs.breezeblue.ai/',
    capability: 'voice_design',
    supportsVoiceDesign: true,
    supportsModelRefresh: true,
  },
  {
    id: 'siliconflow_tts',
    name: '硅基流动（CosyVoice2 / IndexTTS）',
    description: '内置 8 款男女底色（支持语气控制）与音频克隆，可复用硅基流动文本 Key',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    models: [
      'FunAudioLLM/CosyVoice2-0.5B',
      'IndexTeam/IndexTTS-2',
      'fishaudio/fish-speech-1.5',
    ],
    defaultVoice: 'FunAudioLLM/CosyVoice2-0.5B:anna',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    capability: 'preset_and_clone',
    supportsClone: true,
    supportsModelRefresh: true,
  },
  {
    id: 'fish_audio',
    name: 'Fish Audio',
    description: '海量社区与二次元音色库，支持中英日多语种高质量合成',
    baseUrl: 'https://api.fish.audio/v1',
    model: 'speech-1.6',
    models: ['speech-1.6', 'speech-1.5'],
    defaultVoice: 'default',
    consoleUrl: 'https://fish.audio/app/api-keys/',
    capability: 'preset_and_style',
    supportsModelRefresh: true,
  },
  {
    id: 'minimax_tts',
    name: 'MiniMax 海螺语音',
    description: '中文长文本演绎与有声小说角色感极强',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'speech-02-hd',
    models: ['speech-02-hd', 'speech-02-turbo', 'speech-01-hd'],
    defaultVoice: 'female-yujie',
    consoleUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    capability: 'preset_and_style',
    supportsModelRefresh: false,
  },
  {
    id: 'elevenlabs_tts',
    name: 'ElevenLabs',
    description: '影视级多语种人声演绎（兼容 OpenAI 协议）',
    baseUrl: 'https://api.elevenlabs.io/v1',
    model: 'eleven_multilingual_v2',
    models: ['eleven_multilingual_v2', 'eleven_flash_v2_5'],
    defaultVoice: 'Rachel',
    consoleUrl: 'https://elevenlabs.io/app/settings/api-keys',
    capability: 'preset_and_style',
    supportsModelRefresh: true,
  },
  {
    id: 'dashscope_tts',
    name: '阿里云百炼 CosyVoice',
    description: '阿里云托管版通义 CosyVoice 语音合成，可复用百炼文本 Key',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'cosyvoice-v2',
    models: ['cosyvoice-v2', 'cosyvoice-v1'],
    defaultVoice: 'longxiaochun_v2',
    consoleUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    capability: 'preset_and_style',
    supportsModelRefresh: true,
  },
  {
    id: 'openai_tts',
    name: 'OpenAI TTS',
    description: '官方 gpt-4o-mini-tts，支持自然语言语气指导',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-tts',
    models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    defaultVoice: 'nova',
    consoleUrl: 'https://platform.openai.com/api-keys',
    capability: 'preset_and_style',
    supportsVoiceDesign: true,
    supportsModelRefresh: true,
  },
  {
    id: 'custom_tts',
    name: '自定义 / 本地 TTS 网关',
    description: 'GPT-SoVITS、Kokoro、IndexTTS 或任意 OpenAI /audio/speech 兼容接口',
    baseUrl: 'http://127.0.0.1:7860/v1',
    model: 'custom-tts',
    models: ['custom-tts'],
    defaultVoice: '',
    consoleUrl: '',
    capability: 'custom',
    supportsModelRefresh: true,
  },
];

export const STT_PRESETS: SttPreset[] = [
  {
    id: 'siliconflow_stt',
    name: '硅基流动 SenseVoiceSmall（推荐 · 含免费额度）',
    description: '阿里通义开源中文/中英混合高速语音识别，有免费体验额度',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    models: ['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR'],
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'groq_stt',
    name: 'Groq Whisper Large v3 Turbo（免费额度高）',
    description: 'Groq 极速 Whisper 接口，提供慷慨免费层',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    consoleUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openai_stt',
    name: 'OpenAI Whisper',
    description: 'OpenAI 官方 /v1/audio/transcriptions 接口',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    models: ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'],
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'custom_stt',
    name: '自定义 / 本地 Whisper 网关',
    description: 'whisper.cpp、Faster-Whisper 或任意 OpenAI /audio/transcriptions 兼容接口',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'whisper-1',
    models: ['whisper-1'],
    consoleUrl: '',
  },
];

export const TTS_BUILTIN_VOICES: Record<string, BuiltinVoiceOption[]> = {
  siliconflow_tts: [
    { id: 'anna', name: 'Anna · 沉稳女声', gender: 'female', styleHint: '沉稳大方 / 御姐底色' },
    { id: 'claire', name: 'Claire · 温柔女声', gender: 'female', styleHint: '温柔细腻' },
    { id: 'bella', name: 'Bella · 激情女声', gender: 'female', styleHint: '热情张力' },
    { id: 'diana', name: 'Diana · 欢快女声', gender: 'female', styleHint: '元气少女' },
    { id: 'alex', name: 'Alex · 沉稳男声', gender: 'male', styleHint: '沉稳旁白' },
    { id: 'benjamin', name: 'Benjamin · 低沉男声', gender: 'male', styleHint: '低沉质感' },
    { id: 'charles', name: 'Charles · 磁性男声', gender: 'male', styleHint: '磁性青年' },
    { id: 'david', name: 'David · 欢快男声', gender: 'male', styleHint: '明快少年' },
  ],
  openai_tts: [
    { id: 'nova', name: 'Nova · 温柔女声', gender: 'female' },
    { id: 'shimmer', name: 'Shimmer · 清亮女声', gender: 'female' },
    { id: 'coral', name: 'Coral · 自然女声', gender: 'female' },
    { id: 'sage', name: 'Sage · 沉稳女声', gender: 'female' },
    { id: 'alloy', name: 'Alloy · 中性平衡', gender: 'neutral' },
    { id: 'onyx', name: 'Onyx · 低沉男声', gender: 'male' },
    { id: 'echo', name: 'Echo · 温润男声', gender: 'male' },
    { id: 'ash', name: 'Ash · 磁性男声', gender: 'male' },
    { id: 'fable', name: 'Fable · 叙事英伦', gender: 'neutral' },
  ],
  dashscope_tts: [
    { id: 'longxiaochun_v2', name: '龙小淳 · 知性女声', gender: 'female' },
    { id: 'longxiaoxia_v2', name: '龙小夏 · 温柔女声', gender: 'female' },
    { id: 'longhua_v2', name: '龙华 · 活泼女声', gender: 'female' },
    { id: 'longcheng_v2', name: '龙橙 · 清朗男声', gender: 'male' },
    { id: 'longshu_v2', name: '龙书 · 沉稳旁白', gender: 'male' },
  ],
  minimax_tts: [
    { id: 'female-yujie', name: '御姐女声', gender: 'female' },
    { id: 'female-shaonv', name: '清甜少女', gender: 'female' },
    { id: 'female-tianmei', name: '温柔甜美', gender: 'female' },
    { id: 'male-qn-qingse', name: '青涩男声', gender: 'male' },
    { id: 'male-qn-jingying', name: '精英男声', gender: 'male' },
    { id: 'presenter_male', name: '沉稳男播音', gender: 'male' },
  ],
  elevenlabs_tts: [
    { id: 'Rachel', name: 'Rachel · 温柔女声', gender: 'female' },
    { id: 'Bella', name: 'Bella · 柔和女声', gender: 'female' },
    { id: 'Elli', name: 'Elli · 年轻女声', gender: 'female' },
    { id: 'Antoni', name: 'Antoni · 温润男声', gender: 'male' },
    { id: 'Josh', name: 'Josh · 沉稳男声', gender: 'male' },
    { id: 'Adam', name: 'Adam · 低沉旁白', gender: 'male' },
  ],
};

const SILICONFLOW_VOICE_IDS = new Set(
  TTS_BUILTIN_VOICES.siliconflow_tts.map((v) => v.id)
);

export function formatSiliconFlowSystemVoice(model: string, shortVoice: string): string {
  const m = model.trim() || 'FunAudioLLM/CosyVoice2-0.5B';
  return `${m}:${shortVoice.trim()}`;
}

export function extractSiliconFlowShortVoice(voice: string): string | null {
  const trimmed = (voice || '').trim();
  if (!trimmed || trimmed.startsWith('speech:')) return null;
  const candidate = trimmed.includes(':') ? trimmed.split(':').pop()?.trim() || '' : trimmed;
  return SILICONFLOW_VOICE_IDS.has(candidate) ? candidate : null;
}

export function rewriteSiliconFlowVoiceForModel(currentVoice: string, nextModel: string): string {
  const shortVoice = extractSiliconFlowShortVoice(currentVoice);
  if (!shortVoice) return currentVoice;
  return formatSiliconFlowSystemVoice(nextModel, shortVoice);
}

export function pickMatchingBuiltinVoiceForGender(
  providerId: string,
  model: string,
  gender: 'female' | 'male' | 'neutral'
): string | null {
  const options = TTS_BUILTIN_VOICES[providerId];
  if (!options || options.length === 0) return null;
  const matched =
    options.find((o) => o.gender === gender) ||
    (gender === 'neutral' ? options[0] : undefined);
  if (!matched) return null;
  if (providerId === 'siliconflow_tts') {
    return formatSiliconFlowSystemVoice(model, matched.id);
  }
  return matched.id;
}

export function findTtsPresetByBaseUrl(baseUrl: string): TtsPreset | undefined {
  const clean = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return undefined;
  if (isBreezeCloudBase(clean)) {
    return TTS_PRESETS.find((p) => p.id === 'breeze');
  }
  const host = extractEndpointHost(clean);
  return (
    TTS_PRESETS.find((p) => p.id !== 'custom_tts' && p.baseUrl === clean) ||
    TTS_PRESETS.find(
      (p) => p.id !== 'custom_tts' && host && extractEndpointHost(p.baseUrl) === host
    )
  );
}

export function findSttPresetByBaseUrl(baseUrl: string): SttPreset | undefined {
  const clean = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return undefined;
  const host = extractEndpointHost(clean);
  return (
    STT_PRESETS.find((p) => p.id !== 'custom_stt' && p.baseUrl === clean) ||
    STT_PRESETS.find(
      (p) => p.id !== 'custom_stt' && host && extractEndpointHost(p.baseUrl) === host
    )
  );
}

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
  const resolvedBaseUrl = profile.baseUrl?.trim() || baseConfig.ttsBaseUrl;
  return {
    ...baseConfig,
    ttsProviderId:
      profile.providerId ||
      (profile.engine === 'native'
        ? 'native'
        : findTtsPresetByBaseUrl(resolvedBaseUrl)?.id || baseConfig.ttsProviderId),
    ttsEngine: profile.engine,
    ttsRate: profile.rate,
    ttsPitch: profile.pitch,
    ttsVolume: profile.volume,
    ttsGain: profile.gain,
    ttsStyleInstruction: profile.styleInstruction,
    ttsBaseUrl: resolvedBaseUrl,
    ttsModel: profile.model?.trim() || baseConfig.ttsModel,
    ttsNativeVoice:
      profile.engine === 'native' && profile.voiceId ? profile.voiceId : baseConfig.ttsNativeVoice,
    ttsVoice:
      profile.engine === 'openai_api'
        ? profile.voiceId || (isBreezeCloudBase(resolvedBaseUrl) ? '' : baseConfig.ttsVoice)
        : baseConfig.ttsVoice,
  };
}

function resolveVoiceServiceApiKey(params: {
  providerId?: string;
  baseUrl: string;
  explicitKey?: string;
  apiKey?: string;
  providerConfigs?: Record<string, MediaProviderCredential>;
  providers: ProviderConfig[];
}): string {
  const explicitKey = params.explicitKey ?? params.apiKey;
  const clean = params.baseUrl.trim().replace(/\/+$/, '');
  if (isBreezeCloudBase(clean)) {
    const breezeBase = normalizeBreezeBaseUrl(clean);
    return (
      resolveMediaApiKey({
        providerId: params.providerId || 'breeze',
        baseUrl: breezeBase,
        explicitKey,
        providerConfigs: params.providerConfigs,
        providers: params.providers,
      }) ||
      resolveMediaApiKey({
        providerId: params.providerId || 'breeze',
        baseUrl: clean,
        explicitKey,
        providerConfigs: params.providerConfigs,
        providers: params.providers,
      })
    );
  }
  return resolveMediaApiKey({
    providerId: params.providerId,
    baseUrl: clean,
    explicitKey,
    providerConfigs: params.providerConfigs,
    providers: params.providers,
  });
}

const TTS_MODEL_PATTERN = /tts|speech|cosyvoice|indextts|fish|voice|audio|breeze|eleven/i;
const STT_MODEL_PATTERN = /whisper|sensevoice|stt|asr|transcrib|telespeech|funasr|audio/i;

export async function fetchTtsModels(params: {
  providerId?: string;
  baseUrl: string;
  apiKey: string;
  providerConfigs?: Record<string, MediaProviderCredential>;
  providers: ProviderConfig[];
}): Promise<string[]> {
  const cleanBase = params.baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBase) throw new Error('请先填写 TTS Base URL');
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) throw new Error(localhostWarning);

  const apiKey = resolveVoiceServiceApiKey(params);
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    throw new Error('请先填写 TTS API Key（同域名文本厂商 Key 可自动复用）');
  }

  if (isBreezeCloudBase(cleanBase)) {
    const breezeBase = normalizeBreezeBaseUrl(cleanBase);
    const resp = await crossPlatformFetchJson({
      url: `${breezeBase}/v1/models`,
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });
    if (resp.ok) {
      try {
        const parsed = JSON.parse(resp.text) as
          | Array<{ model_id?: string; id?: string }>
          | { models?: Array<{ model_id?: string; id?: string }>; data?: Array<{ id?: string; model_id?: string }> };
        const rows = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.models)
            ? parsed.models
            : Array.isArray(parsed?.data)
              ? parsed.data
              : [];
        const list = rows
          .map((m) => String(m?.model_id || m?.id || '').trim())
          .filter(Boolean);
        if (list.length > 0) {
          return Array.from(new Set(list));
        }
      } catch {
        // Fallback below
      }
    }
    return ['breeze-tts-2', 'breeze-tts-2-multilingual'];
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (extractEndpointHost(cleanBase).includes('siliconflow')) {
    const sfResp = await crossPlatformFetchJson({
      url: `${cleanBase}/models?type=audio`,
      method: 'GET',
      headers,
    });
    if (sfResp.ok) {
      const parsed = safeJsonParse<{ data?: Array<{ id?: string }> }>(
        sfResp.text,
        'TTS 模型列表返回格式异常'
      );
      const audioModels = Array.isArray(parsed?.data)
        ? parsed.data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
        : [];
      const ttsOnly = audioModels.filter(
        (id) => !/sensevoice|whisper|telespeech|funasr|asr|transcrib/i.test(id)
      );
      const picked = ttsOnly.length > 0 ? ttsOnly : audioModels;
      if (picked.length > 0) {
        return Array.from(new Set(picked)).sort((a, b) => a.localeCompare(b));
      }
    }
  }

  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/models`,
    method: 'GET',
    headers,
  });
  if (!resp.ok) {
    throw new Error(`拉取 TTS 模型失败 (HTTP ${resp.status})`);
  }
  const parsed = safeJsonParse<{ data?: Array<{ id?: string }> }>(
    resp.text,
    'TTS 模型列表返回格式异常'
  );
  const all = Array.isArray(parsed?.data)
    ? parsed.data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
    : [];
  if (all.length === 0) {
    throw new Error('接口未返回模型列表，请手动填写模型 ID');
  }
  const filtered = all.filter((id) => TTS_MODEL_PATTERN.test(id));
  const result = filtered.length > 0 ? filtered : all;
  return Array.from(new Set(result)).sort((a, b) => a.localeCompare(b));
}

export async function fetchSttModels(params: {
  providerId?: string;
  baseUrl: string;
  apiKey: string;
  providerConfigs?: Record<string, MediaProviderCredential>;
  providers: ProviderConfig[];
}): Promise<string[]> {
  const cleanBase = params.baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBase) throw new Error('请先填写 STT Base URL');
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) throw new Error(localhostWarning);

  const apiKey = resolveVoiceServiceApiKey(params);
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    throw new Error('请先填写 STT API Key（同域名文本厂商 Key 可自动复用）');
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (extractEndpointHost(cleanBase).includes('siliconflow')) {
    for (const query of ['?sub_type=speech-to-text', '?type=audio']) {
      const sfResp = await crossPlatformFetchJson({
        url: `${cleanBase}/models${query}`,
        method: 'GET',
        headers,
      });
      if (sfResp.ok) {
        const parsed = safeJsonParse<{ data?: Array<{ id?: string }> }>(
          sfResp.text,
          'STT 模型列表返回格式异常'
        );
        const list = Array.isArray(parsed?.data)
          ? parsed.data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
          : [];
        const sttOnly =
          query === '?type=audio' ? list.filter((id) => STT_MODEL_PATTERN.test(id)) : list;
        const picked = sttOnly.length > 0 ? sttOnly : list;
        if (picked.length > 0) {
          return Array.from(new Set(picked)).sort((a, b) => a.localeCompare(b));
        }
      }
    }
  }

  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/models`,
    method: 'GET',
    headers,
  });
  if (!resp.ok) {
    throw new Error(`拉取 STT 模型失败 (HTTP ${resp.status})`);
  }
  const parsed = safeJsonParse<{ data?: Array<{ id?: string }> }>(
    resp.text,
    'STT 模型列表返回格式异常'
  );
  const all = Array.isArray(parsed?.data)
    ? parsed.data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
    : [];
  if (all.length === 0) {
    throw new Error('接口未返回模型列表，请手动填写模型 ID');
  }
  const filtered = all.filter((id) => STT_MODEL_PATTERN.test(id));
  const result = filtered.length > 0 ? filtered : all;
  return Array.from(new Set(result)).sort((a, b) => a.localeCompare(b));
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
  providerConfigs?: Record<string, MediaProviderCredential>;
  description: string;
  text?: string;
  model?: string;
  languageCode?: string;
  guidanceScale?: number;
  previewCount?: number;
}): Promise<BreezeVoicePreview[]> {
  const breezeBase = normalizeBreezeBaseUrl(params.baseUrl);
  const localhostWarning = detectUnreachableLocalhost(breezeBase);
  if (localhostWarning) throw new Error(localhostWarning);

  const apiKey = resolveVoiceServiceApiKey({
    providerId: 'breeze',
    baseUrl: breezeBase,
    explicitKey: params.apiKey,
    providerConfigs: params.providerConfigs,
    providers: params.providers,
  });
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

  const parsed = safeJsonParse<{
    previews?: Array<{
      generated_voice_id?: string;
      audio_base_64?: string;
      media_type?: string;
      duration_secs?: number | null;
    }>;
  }>(resp.text, 'Breeze 预览接口返回了非 JSON 响应');
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
  providerConfigs?: Record<string, MediaProviderCredential>;
  generatedVoiceId: string;
  name: string;
  languageCode?: string;
  description?: string;
}): Promise<{ voiceId: string; name: string }> {
  const breezeBase = normalizeBreezeBaseUrl(params.baseUrl);
  const localhostWarning = detectUnreachableLocalhost(breezeBase);
  if (localhostWarning) throw new Error(localhostWarning);

  const apiKey = resolveVoiceServiceApiKey({
    providerId: 'breeze',
    baseUrl: breezeBase,
    explicitKey: params.apiKey,
    providerConfigs: params.providerConfigs,
    providers: params.providers,
  });
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

  const parsed = safeJsonParse<{ voice_id?: string; name?: string }>(
    resp.text,
    'Breeze 保存接口返回了非 JSON 响应'
  );
  const voiceId = String(parsed?.voice_id || '').trim();
  if (!voiceId) throw new Error('保存成功但接口未返回 voice_id');
  return { voiceId, name: String(parsed?.name || body.voice_name) };
}

export async function listBreezeVoices(params: {
  baseUrl: string;
  apiKey: string;
  providers: ProviderConfig[];
  providerConfigs?: Record<string, MediaProviderCredential>;
}): Promise<BreezeVoiceItem[]> {
  const breezeBase = normalizeBreezeBaseUrl(params.baseUrl);
  const localhostWarning = detectUnreachableLocalhost(breezeBase);
  if (localhostWarning) throw new Error(localhostWarning);

  const apiKey = resolveVoiceServiceApiKey({
    providerId: 'breeze',
    baseUrl: breezeBase,
    explicitKey: params.apiKey,
    providerConfigs: params.providerConfigs,
    providers: params.providers,
  });
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

  const parsed = safeJsonParse<
    Array<Record<string, unknown>> | { voices?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> }
  >(resp.text, 'Breeze 音色列表返回了非 JSON 响应');
  const rows: Array<Record<string, unknown>> = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.voices)
      ? parsed.voices
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
let activeAudioAbort: (() => void) | null = null;
let activeNativeTtsCleanup: (() => void) | null = null;
let speechGenerationId = 0;

export function stopSpeaking(): void {
  speechGenerationId++;
  if (activeNativeTtsCleanup) {
    activeNativeTtsCleanup();
    activeNativeTtsCleanup = null;
  }
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
  if (activeAudioAbort) {
    activeAudioAbort();
    activeAudioAbort = null;
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
    if (typeof window !== 'undefined' && window.TheWorldAndroid?.speakWithId) {
      const utteranceId = createId('tts');
      const cleanup = () => {
        window.removeEventListener('theworld-tts', onTtsEvent);
        if (activeNativeTtsCleanup === cleanup) {
          activeNativeTtsCleanup = null;
        }
      };
      const onTtsEvent = (ev: Event) => {
        const detail = (
          ev as CustomEvent<{ status?: string; utteranceId?: string; message?: string }>
        ).detail;
        if (!detail || detail.utteranceId !== utteranceId) return;
        cleanup();
        if (token !== speechGenerationId) return;
        if (detail.status === 'error') {
          onError?.(detail.message || '系统语音朗读失败');
        } else {
          onEnd?.();
        }
      };
      activeNativeTtsCleanup = cleanup;
      window.addEventListener('theworld-tts', onTtsEvent);
      window.TheWorldAndroid.speakWithId(
        cleanText.slice(0, 3800),
        rate,
        pitch,
        volume,
        utteranceId
      );
      return;
    }

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
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) {
    onError?.(localhostWarning);
    return;
  }

  const breezeBase = isBreezeCloud ? normalizeBreezeBaseUrl(cleanBase) : cleanBase;
  const targetProviderId =
    effective.ttsProviderId || findTtsPresetByBaseUrl(cleanBase)?.id;
  const sameProviderAsConfig =
    !profile ||
    (targetProviderId && targetProviderId === config.ttsProviderId) ||
    (extractEndpointHost(cleanBase) &&
      extractEndpointHost(cleanBase) === extractEndpointHost(config.ttsBaseUrl));

  const apiKey = resolveVoiceServiceApiKey({
    providerId: targetProviderId,
    baseUrl: breezeBase,
    explicitKey: sameProviderAsConfig ? effective.ttsApiKey : '',
    providerConfigs: config.ttsProviderConfigs,
    providers,
  });
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    onError?.('请先在「模型 → 语音」为对应语音平台配置 TTS API Key');
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
        const voices = await listBreezeVoices({
          baseUrl: breezeBase,
          apiKey,
          providers,
          providerConfigs: config.ttsProviderConfigs,
        });
        if (token !== speechGenerationId) return;
        if (voices.length === 0) {
          onError?.('Breeze 账号下暂无可用音色，请先在 Breeze 控制台创建音色或使用「一句话捏音色」');
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
            activeAudioAbort = null;
          }
        };
        audio.volume = volume;
        if (playbackRate !== 1) audio.playbackRate = playbackRate;
        activeAudio = audio;
        activeAudioUrl = url;
        activeAudioAbort = () => {
          finish();
          resolve();
        };
        audio.onended = () => {
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
  providerConfigs?: Record<string, MediaProviderCredential>;
  model: string;
  customName: string;
  text: string;
  audioDataUrl: string;
}): Promise<{ uri: string }> {
  const cleanBase = params.baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBase) throw new Error('请先填写 TTS Base URL');
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) throw new Error(localhostWarning);

  const apiKey = resolveVoiceServiceApiKey({
    providerId: findTtsPresetByBaseUrl(cleanBase)?.id,
    baseUrl: cleanBase,
    explicitKey: params.apiKey,
    providerConfigs: params.providerConfigs,
    providers: params.providers,
  });
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

  const parsed = safeJsonParse<{ uri?: string }>(resp.text, '音色克隆返回了非 JSON 响应');
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
  providerConfigs?: Record<string, MediaProviderCredential>;
}): Promise<RemoteClonedVoice[]> {
  const cleanBase = params.baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBase) throw new Error('请先填写 TTS Base URL');
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) throw new Error(localhostWarning);

  if (isBreezeCloudBase(cleanBase)) {
    const voices = await listBreezeVoices(params);
    return voices.map((v) => ({
      model: 'breeze-tts-2',
      customName: v.name,
      text: v.category || 'Breeze 音色',
      uri: v.voiceId,
    }));
  }

  const apiKey = resolveVoiceServiceApiKey({
    providerId: findTtsPresetByBaseUrl(cleanBase)?.id,
    baseUrl: cleanBase,
    explicitKey: params.apiKey,
    providerConfigs: params.providerConfigs,
    providers: params.providers,
  });
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
  const parsed = safeJsonParse<{
    results?: Array<Record<string, unknown>>;
    result?: Array<Record<string, unknown>>;
  }>(resp.text, '同步克隆音色接口返回了非 JSON 响应');
  const rows = Array.isArray(parsed?.results)
    ? parsed.results
    : Array.isArray(parsed?.result)
      ? parsed.result
      : [];
  return rows
    .filter((r) => Boolean(r && r.uri))
    .map((r) => ({
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
  providerConfigs?: Record<string, MediaProviderCredential>;
  uri: string;
}): Promise<void> {
  const cleanBase = params.baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBase || detectUnreachableLocalhost(cleanBase)) return;
  const apiKey = resolveVoiceServiceApiKey({
    providerId: findTtsPresetByBaseUrl(cleanBase)?.id,
    baseUrl: cleanBase,
    explicitKey: params.apiKey,
    providerConfigs: params.providerConfigs,
    providers: params.providers,
  });
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) return;

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
  cancel: () => void;
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
      const finishEarly = () => {
        if (!settled) {
          settled = true;
          cleanup();
          onDone();
        }
      };
      return { stop: finishEarly, cancel: finishEarly };
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
        abort?: () => void;
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
        abort?: () => void;
      };
    };

    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      onError(
        '当前桌面环境暂不支持系统离线识别，可在「模型 → 语音 → 语音输入」切换为硅基流动 SenseVoiceSmall（含免费额度）'
      );
      onDone();
      return { stop: () => {}, cancel: () => {} };
    }

    const recognition = new SpeechRec();
    recognition.lang = config.sttLanguage === 'en' ? 'en-US' : 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    let stopped = false;

    recognition.onresult = (ev) => {
      if (stopped) return;
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
    try {
      recognition.start();
    } catch (err) {
      onError(err instanceof Error ? `无法启动语音识别: ${err.message}` : '无法启动语音识别');
      onDone();
      return { stop: () => {}, cancel: () => {} };
    }
    return {
      stop: () => {
        stopped = true;
        try {
          recognition.stop();
        } catch {
          onDone();
        }
      },
      cancel: () => {
        stopped = true;
        try {
          if (recognition.abort) recognition.abort();
          else recognition.stop();
        } catch {
          onDone();
        }
      },
    };
  }

  const cleanBase = config.sttBaseUrl.trim().replace(/\/+$/, '');
  const model = config.sttModel.trim();
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) {
    onError(localhostWarning);
    onDone();
    return { stop: () => {}, cancel: () => {} };
  }

  const sttPid = config.sttProviderId || findSttPresetByBaseUrl(cleanBase)?.id;
  const apiKey = resolveMediaApiKey({
    providerId: sttPid,
    baseUrl: cleanBase,
    explicitKey: config.sttApiKey,
    providerConfigs: config.sttProviderConfigs,
    providers,
  });

  if (!cleanBase || !model) {
    onError('请先在「模型 → 语音 → 语音输入」填写 STT 接口地址和模型');
    onDone();
    return { stop: () => {}, cancel: () => {} };
  }
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    onError('请先在「模型 → 语音 → 语音输入」填写 STT API Key（同域名厂商可自动复用）');
    onDone();
    return { stop: () => {}, cancel: () => {} };
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    onError('当前环境不支持麦克风录音');
    onDone();
    return { stop: () => {}, cancel: () => {} };
  }

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let canceled = false;
  let discardOnStop = false;

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
        if (discardOnStop || chunks.length === 0) {
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
            const parsed = safeJsonParse<{ text?: string }>(
              resp.text,
              '语音转写接口返回格式异常'
            );
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
    cancel: () => {
      canceled = true;
      discardOnStop = true;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        stopTracks();
        onDone();
      }
    },
  };
}
