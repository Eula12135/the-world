import type {
  Character,
  ImageGenConfig,
  MediaProviderCredential,
  ProviderConfig,
  WorldProject,
} from '../types';
import {
  base64ToUint8Array,
  crossPlatformFetchBinary,
  crossPlatformFetchJson,
  safeJsonParse,
  uint8ArrayToBase64,
} from './llm';
import { detectUnreachableLocalhost } from '../utils/platform';

export interface ImageGenPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  consoleUrl: string;
  requiresKey: boolean;
}

export const IMAGE_GEN_PRESETS: ImageGenPreset[] = [
  {
    id: 'zhipu',
    name: '智谱 BigModel（含免费 CogView-3-Flash）',
    description: '官方提供免费的 cogview-3-flash 生图模型，注册获取 API Key 即可使用',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['cogview-3-flash', 'cogview-4'],
    defaultModel: 'cogview-3-flash',
    consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    requiresKey: true,
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow（Kolors / FLUX）',
    description: '支持 Kwai-Kolors、FLUX.1-schnell 等开源生图模型，新号有体验额度',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      'Kwai-Kolors/Kolors',
      'black-forest-labs/FLUX.1-schnell',
      'black-forest-labs/FLUX.1-dev',
    ],
    defaultModel: 'Kwai-Kolors/Kolors',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    requiresKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI（GPT-Image / DALL·E）',
    description: 'OpenAI 官方生图端点',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-image-1', 'dall-e-3'],
    defaultModel: 'dall-e-3',
    consoleUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
  },
  {
    id: 'custom',
    name: '自定义 / 本地 SD / ComfyUI 网关',
    description: '任意兼容 OpenAI /v1/images/generations 协议的云端或本地生图服务',
    baseUrl: 'http://127.0.0.1:7860/v1',
    models: ['flux-schnell', 'sdxl'],
    defaultModel: 'flux-schnell',
    consoleUrl: '',
    requiresKey: false,
  },
];

export function extractEndpointHost(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isLocalEndpointUrl(url: string): boolean {
  const host = extractEndpointHost(url);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function resolveReusableApiKey(
  baseUrl: string,
  explicitKey: string,
  providers: ProviderConfig[]
): string {
  const trimmed = explicitKey.trim();
  if (trimmed) return trimmed;
  const targetHost = extractEndpointHost(baseUrl);
  if (!targetHost) return '';
  const match = providers.find(
    (p) => p.apiKey.trim().length > 0 && extractEndpointHost(p.baseUrl) === targetHost
  );
  return match?.apiKey.trim() || '';
}

export function resolveMediaApiKey(params: {
  providerId?: string;
  baseUrl: string;
  explicitKey?: string;
  providerConfigs?: Record<string, MediaProviderCredential>;
  providers: ProviderConfig[];
}): string {
  const trimmed = (params.explicitKey || '').trim();
  if (trimmed) return trimmed;

  if (params.providerId && params.providerConfigs?.[params.providerId]?.apiKey?.trim()) {
    return params.providerConfigs[params.providerId].apiKey.trim();
  }

  const targetHost = extractEndpointHost(params.baseUrl);
  if (!targetHost) return '';

  if (params.providerConfigs) {
    for (const cred of Object.values(params.providerConfigs)) {
      if (cred?.apiKey?.trim() && extractEndpointHost(cred.baseUrl) === targetHost) {
        return cred.apiKey.trim();
      }
    }
  }

  return resolveReusableApiKey(params.baseUrl, '', params.providers);
}

const IMAGE_MODEL_PATTERN =
  /cogview|flux|kolors|dall-e|gpt-image|sdxl|stable-diffusion|image|wanx|jimeng|seedream|imagen|ideogram|recraft|qwen-image/i;

export async function fetchImageGenModels(params: {
  baseUrl: string;
  apiKey: string;
  providers: ProviderConfig[];
  providerConfigs?: Record<string, MediaProviderCredential>;
  providerId?: string;
}): Promise<string[]> {
  const cleanBase = params.baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBase) {
    throw new Error('请先填写生图 Base URL');
  }
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) {
    throw new Error(localhostWarning);
  }

  const apiKey = resolveMediaApiKey({
    providerId: params.providerId,
    baseUrl: cleanBase,
    explicitKey: params.apiKey,
    providerConfigs: params.providerConfigs,
    providers: params.providers,
  });
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    throw new Error('请先填写生图 API Key（同域名文本厂商 Key 可自动复用）');
  }

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (extractEndpointHost(cleanBase).includes('siliconflow')) {
    const sfResp = await crossPlatformFetchJson({
      url: `${cleanBase}/models?sub_type=text-to-image`,
      method: 'GET',
      headers,
    });
    if (sfResp.ok) {
      const parsed = safeJsonParse<{ data?: Array<{ id?: string }> }>(
        sfResp.text,
        '生图模型列表返回格式异常'
      );
      const list = Array.isArray(parsed?.data)
        ? parsed.data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
        : [];
      if (list.length > 0) {
        return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
      }
    }
  }

  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/models`,
    method: 'GET',
    headers,
  });
  if (!resp.ok) {
    throw new Error(`拉取生图模型失败 (HTTP ${resp.status})`);
  }
  const parsed = safeJsonParse<{ data?: Array<{ id?: string }> }>(
    resp.text,
    '生图模型列表返回格式异常'
  );
  const all = Array.isArray(parsed?.data)
    ? parsed.data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
    : [];
  if (all.length === 0) {
    throw new Error('接口未返回可用模型列表，请手动填写模型 ID');
  }
  const filtered = all.filter((id) => IMAGE_MODEL_PATTERN.test(id));
  const result = filtered.length > 0 ? filtered : all;
  return Array.from(new Set(result)).sort((a, b) => a.localeCompare(b));
}

export function buildCharacterImagePrompt(
  character: Character,
  world?: WorldProject | null,
  styleHint?: string
): string {
  const parts: string[] = [];
  if (styleHint?.trim()) parts.push(styleHint.trim());
  if (world?.genre) parts.push(`${world.genre}题材小说角色立绘`);
  else parts.push('小说角色半身立绘');

  parts.push(`角色姓名：${character.name}`);
  if (character.identity) parts.push(`身份定位：${character.identity}`);
  if (character.personality) parts.push(`气质神态：${character.personality.slice(0, 100)}`);
  if (character.notes) parts.push(`外貌与服饰特征：${character.notes.slice(0, 180)}`);
  parts.push('单人正面或半侧面特写，构图清晰，光影质感细腻');

  return parts.join('，');
}

function blobToDataUrlFallback(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片数据失败'));
      reader.readAsDataURL(blob);
      return;
    }
    blob
      .arrayBuffer()
      .then((buf) => {
        const b64 = uint8ArrayToBase64(new Uint8Array(buf));
        const mime = blob.type || 'image/png';
        resolve(`data:${mime};base64,${b64}`);
      })
      .catch(reject);
  });
}

export async function compressImageDataToDataUrl(
  blobOrFile: Blob,
  maxDim = 512,
  quality = 0.85
): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || !URL.createObjectURL) {
    return blobToDataUrlFallback(blobOrFile);
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blobOrFile);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || maxDim;
        const h = img.naturalHeight || maxDim;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const targetW = Math.max(1, Math.round(w * scale));
        const targetH = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          blobToDataUrlFallback(blobOrFile).then(resolve, reject);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        let out = canvas.toDataURL('image/webp', quality);
        if (!out.startsWith('data:image/webp')) {
          out = canvas.toDataURL('image/jpeg', quality);
        }
        URL.revokeObjectURL(objectUrl);
        resolve(out);
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        blobToDataUrlFallback(blobOrFile).then(resolve, () => reject(err));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      blobToDataUrlFallback(blobOrFile).then(resolve, () => reject(new Error('图片解码失败')));
    };
    img.src = objectUrl;
  });
}

export async function generateImage(params: {
  config: ImageGenConfig;
  providers: ProviderConfig[];
  prompt: string;
}): Promise<string> {
  const { config, providers, prompt } = params;
  const cleanBase = config.baseUrl.trim().replace(/\/+$/, '');
  const model = config.model.trim();
  if (!cleanBase || !model) {
    throw new Error('请先在「模型 → 生图模型」配置有效的 Base URL 与模型 ID');
  }
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) {
    throw new Error(localhostWarning);
  }

  const apiKey = resolveMediaApiKey({
    providerId: config.presetId,
    baseUrl: cleanBase,
    explicitKey: config.apiKey,
    providerConfigs: config.providerConfigs,
    providers,
  });
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    throw new Error('请先在「模型 → 生图模型」填写 API Key（同域名文本厂商的 Key 可留空自动复用）');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/images/generations`,
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      prompt: prompt.trim(),
      size: config.size || '1024x1024',
      n: 1,
    }),
  });

  if (!resp.ok) {
    let msg = `生图请求失败 (HTTP ${resp.status})`;
    try {
      const parsed = JSON.parse(resp.text);
      if (parsed?.error?.message) msg = parsed.error.message;
      else if (parsed?.message) msg = parsed.message;
    } catch {
      if (resp.text) msg = `${msg}: ${resp.text.slice(0, 160)}`;
    }
    throw new Error(msg);
  }

  const parsed = safeJsonParse<{ data?: Array<{ b64_json?: string; url?: string }> }>(
    resp.text,
    '生图接口返回了非 JSON 响应'
  );
  const first = Array.isArray(parsed?.data) ? parsed.data[0] : null;
  if (!first) {
    throw new Error('生图接口未返回图像数据');
  }

  if (typeof first.b64_json === 'string' && first.b64_json.trim()) {
    const bytes = base64ToUint8Array(first.b64_json);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' });
    return compressImageDataToDataUrl(blob, 512, 0.86);
  }

  if (typeof first.url === 'string' && first.url.trim()) {
    const bin = await crossPlatformFetchBinary({ url: first.url.trim(), method: 'GET' });
    if (!bin.ok || !bin.base64) {
      return first.url.trim();
    }
    const bytes = base64ToUint8Array(bin.base64);
    const blob = new Blob([bytes.buffer as ArrayBuffer], {
      type: bin.contentType || 'image/png',
    });
    return compressImageDataToDataUrl(blob, 512, 0.86);
  }

  throw new Error('生图返回结果中缺少 b64_json 或 url');
}
