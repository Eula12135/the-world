import type { MediaProviderCredential, ProviderConfig } from '../../types';
import { crossPlatformFetchJson, safeJsonParse, uint8ArrayToBase64 } from '../llm';
import { isLocalEndpointUrl } from '../imageGenService';
import { detectUnreachableLocalhost } from '../../utils/platform';
import { listBreezeVoices } from './breeze';
import {
  findTtsPresetByBaseUrl,
  type RemoteClonedVoice,
  resolveVoiceServiceApiKey,
} from './presets';
import { isBreezeCloudBase, sanitizeCloneCustomName } from './textUtils';

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
