import type {
  MediaProviderCredential,
  ProviderConfig,
  VoiceConfig,
  VoiceProfile,
} from '../../types';
import { extractEndpointHost, resolveMediaApiKey } from '../imageGenService';
import { isBreezeCloudBase, normalizeBreezeBaseUrl } from './textUtils';

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

export function resolveVoiceServiceApiKey(params: {
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
