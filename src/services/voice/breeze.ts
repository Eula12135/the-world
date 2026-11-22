import type { MediaProviderCredential, ProviderConfig } from '../../types';
import { crossPlatformFetchJson, safeJsonParse } from '../llm';
import { detectUnreachableLocalhost } from '../../utils/platform';
import { resolveVoiceServiceApiKey } from './presets';
import { normalizeBreezeBaseUrl } from './textUtils';

export interface BreezeVoiceItem {
  voiceId: string;
  name: string;
  category?: string;
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
