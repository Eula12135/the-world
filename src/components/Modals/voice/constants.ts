import type { VoiceProfile } from '../../../types';
import { findTtsPresetByBaseUrl, TTS_PRESETS } from '../../../services/voiceService';

export interface InspirationChip {
  label: string;
  gender: 'female' | 'male' | 'neutral';
  sfVoice: string;
  prompt: string;
}

export const VOICE_INSPIRATION_CHIPS: InspirationChip[] = [
  {
    label: '慵懒御姐',
    gender: 'female',
    sfVoice: 'anna',
    prompt: '成熟优雅御姐女声，语调慵懒从容，略带磁性与低微气声',
  },
  {
    label: '温柔清冷女声',
    gender: 'female',
    sfVoice: 'claire',
    prompt: '年轻女性，温柔清冷、声线清澈柔和，带有一丝克制感',
  },
  {
    label: '元气活力少女',
    gender: 'female',
    sfVoice: 'diana',
    prompt: '年轻活泼少女，声音清亮甜美，带有轻快笑意',
  },
  {
    label: '御姐烈焰女声',
    gender: 'female',
    sfVoice: 'bella',
    prompt: '富有张力与戏剧表现力的女声，情绪饱满清晰',
  },
  {
    label: '低沉磁性男声',
    gender: 'male',
    sfVoice: 'benjamin',
    prompt: '成熟男性，声音低沉富有磁性，语速沉稳从容',
  },
  {
    label: '温润少年男声',
    gender: 'male',
    sfVoice: 'charles',
    prompt: '清朗温润的青年男声，语调真诚自然',
  },
  {
    label: '沉稳叙事旁白',
    gender: 'male',
    sfVoice: 'alex',
    prompt: '专业有声书旁白腔，沉稳有力、吐字清晰、富有画面感',
  },
];

export const MAX_CLONE_AUDIO_BYTES = 10 * 1024 * 1024;

export function getProviderDisplayName(vp: VoiceProfile): string {
  if (vp.engine === 'native') return '系统原生';
  const byId = vp.providerId ? TTS_PRESETS.find((p) => p.id === vp.providerId) : undefined;
  const preset = byId || (vp.baseUrl ? findTtsPresetByBaseUrl(vp.baseUrl) : undefined);
  if (preset) {
    return preset.name.split('（')[0].trim();
  }
  return '外部 API';
}
