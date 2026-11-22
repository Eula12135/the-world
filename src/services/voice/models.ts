import type { MediaProviderCredential, ProviderConfig } from '../../types';
import { crossPlatformFetchJson, safeJsonParse } from '../llm';
import { extractEndpointHost, isLocalEndpointUrl } from '../imageGenService';
import { detectUnreachableLocalhost } from '../../utils/platform';
import { resolveVoiceServiceApiKey } from './presets';
import { isBreezeCloudBase, normalizeBreezeBaseUrl } from './textUtils';

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
