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
import { resolveImageFraming } from '../utils/imageFraming';

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

export function isGeminiNativeImageModel(baseUrl: string, model: string): boolean {
  const cleanModel = model.trim().replace(/^models\//i, '');
  if (!/^gemini-[^/]*image/i.test(cleanModel)) return false;
  return (
    extractEndpointHost(baseUrl).includes('generativelanguage.googleapis.com') ||
    /\/v1beta(?:\/openai)?\/?$/i.test(baseUrl.trim())
  );
}

export function buildGeminiGenerateContentUrl(baseUrl: string, model: string): string {
  let apiBase = baseUrl.trim().replace(/\/+$/, '').replace(/\/openai$/i, '');
  if (!/\/v1(?:beta)?$/i.test(apiBase)) {
    apiBase = `${apiBase}/v1beta`;
  }
  const cleanModel = model.trim().replace(/^models\//i, '');
  return `${apiBase}/models/${encodeURIComponent(cleanModel)}:generateContent`;
}

const GPT_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'];
const DALLE3_SIZES = ['1024x1024', '1792x1024', '1024x1792'];

function sizeAspect(size: string): 'square' | 'landscape' | 'portrait' | null {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(size.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  const ratio = w / h;
  if (ratio > 1.05) return 'landscape';
  if (ratio < 0.95) return 'portrait';
  return 'square';
}

/**
 * gpt-image 系列和 dall-e-3 只接受固定几档尺寸，传其它值服务端直接 400。
 * 所以按模型白名单过滤：不合法就按宽高比换成最接近的一档，
 * 连比例都解析不出来就干脆不传，交给服务端默认值 —— 绝不硬塞非法参数。
 */
export function resolveImageSize(model: string, size: string): string | undefined {
  const wanted = (size || '').trim();
  const m = (model || '').trim().toLowerCase();
  const allowed = m.startsWith('gpt-image')
    ? GPT_IMAGE_SIZES
    : m.startsWith('dall-e-3')
      ? DALLE3_SIZES
      : null;

  if (!allowed) return wanted || undefined;
  if (!wanted) return undefined;
  if (allowed.includes(wanted)) return wanted;

  const aspect = sizeAspect(wanted);
  if (!aspect) return undefined;
  return allowed.find((candidate) => sizeAspect(candidate) === aspect);
}

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

/** 只保留与「画面」有关的词：年龄/性别/外貌/服饰/气质 */
const VISUAL_CUE_RE =
  /岁|年龄|性别|男|女|少年|少女|青年|中年|老年|发|发色|发型|长发|短发|马尾|辫|眸|瞳|眼|眼神|目光|肤|皮肤|肤色|身材|身高|修长|纤|魁梧|肩|腰|腿|穿|衣|裙|袍|披风|西装|制服|盔甲|帽|靴|鞋|配饰|饰品|耳环|项链|项圈|纹身|疤|唇|眉|鼻|脸|面容|五官|容貌|相貌|俊|美|稚|沧桑|温柔|冷峻|清冷|冷傲|孤傲|慵懒|高傲|俏皮|阴郁|阳光|沉稳|活泼|冷静|温和|凌厉|妩媚|英气|稚气|成熟|肃穆|洒脱|气质|神态|表情/;

/** 引号里的内容一律是台词，不是画面描述 */
function stripQuotedSegments(text: string): string {
  return text
    .replace(/「[^」]*」/g, '，')
    .replace(/『[^』]*』/g, '，')
    .replace(/“[^”]*”/g, '，')
    .replace(/"[^"]*"/g, '，');
}

/**
 * 从自由文本里抽出可以画出来的描述。
 *
 * 角色卡的「性格」「补充备注」常被写成半段对话或剧情，
 * 原样塞进生图提示词会变成莫名其妙的画面指令，所以按句筛选：
 * 先剥掉引号内容，再只留含视觉线索的句子，并丢弃带冒号的对话引导。
 */
export function extractVisualTraits(text: string, maxLen: number): string {
  if (!text) return '';

  const cleaned = stripQuotedSegments(text);
  const sentences = cleaned
    .split(/[。！？；\n，,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const kept: string[] = [];
  let total = 0;

  for (const raw of sentences) {
    // 「外貌：银白长发」这种带前缀的写法，取冒号后面的内容
    const labelled = /^([^：:]{1,8})[：:](.+)$/.exec(raw);
    const sentence = (labelled ? labelled[2] : raw).trim();
    if (sentence.length < 2) continue;
    if (!VISUAL_CUE_RE.test(sentence)) continue;
    // 剥完前缀仍带冒号的多半是「他说道：」这类对话
    if (/[：:]/.test(sentence)) continue;
    if (/(说|道|问|答|喊|叫|吼|嘟囔|低语|开口|回应|吐槽)$/.test(sentence)) continue;
    if (total + sentence.length > maxLen) continue;
    kept.push(sentence.replace(/[，,、]+$/, ''));
    total += sentence.length;
  }

  return kept.join('，');
}

export function buildCharacterImagePrompt(
  character: Character,
  world?: WorldProject | null,
  styleHint?: string,
  size?: string
): string {
  const framing = resolveImageFraming(size);
  const parts: string[] = [];
  if (styleHint?.trim()) parts.push(styleHint.trim());
  if (world?.genre) parts.push(`${world.genre}题材小说${framing.subject}`);
  else parts.push(`小说${framing.subject}`);

  parts.push(`角色姓名：${character.name}`);

  // 「神秘三人组（外号『长腿妞』）」剥掉引号后会剩下「（外号，）」这种残渣，清掉
  const identity = stripQuotedSegments(character.identity || '')
    .replace(/[（(][^）)]{0,8}[，,、]\s*[)）]/g, '')
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/[，,、\s]+$/, '')
    .trim();
  if (identity) parts.push(`身份定位：${identity.slice(0, 40)}`);

  const look = extractVisualTraits(character.notes, 160);
  if (look) parts.push(`外貌与服饰特征：${look}`);

  const temperament = extractVisualTraits(character.personality, 60);
  if (temperament) parts.push(`气质神态：${temperament}`);

  parts.push(framing.composition);
  parts.push(framing.avoid);

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

function extractImageErrorMessage(status: number, text: string): string {
  let msg = `生图请求失败 (HTTP ${status})`;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.error?.message) msg = parsed.error.message;
    else if (parsed?.message) msg = parsed.message;
  } catch {
    if (text) msg = `${msg}: ${text.slice(0, 160)}`;
  }
  return msg;
}

async function decodeBase64ImageToDataUrl(
  base64Data: string,
  mimeType = 'image/png'
): Promise<string> {
  const bytes = base64ToUint8Array(base64Data);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
  return compressImageDataToDataUrl(blob, 512, 0.86);
}

interface GeminiGenerateImageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
        inline_data?: { mime_type?: string; data?: string };
      }>;
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
}

async function generateGeminiNativeImage(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.apiKey) {
    headers['x-goog-api-key'] = params.apiKey;
  }

  const resp = await crossPlatformFetchJson({
    url: buildGeminiGenerateContentUrl(params.baseUrl, params.model),
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ parts: [{ text: params.prompt.trim() }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  if (!resp.ok) {
    throw new Error(extractImageErrorMessage(resp.status, resp.text));
  }

  const parsed = safeJsonParse<GeminiGenerateImageResponse>(
    resp.text,
    '生图接口返回了非 JSON 响应'
  );
  const parts = (parsed?.candidates || []).flatMap((c) => c?.content?.parts || []);
  for (const part of parts) {
    const inlineCamel = part?.inlineData;
    const inlineSnake = part?.inline_data;
    const data = (inlineCamel?.data || inlineSnake?.data || '').trim();
    if (data) {
      const mimeType = inlineCamel?.mimeType || inlineSnake?.mime_type || 'image/png';
      return decodeBase64ImageToDataUrl(data, mimeType);
    }
  }

  const textSnippet = parts
    .map((p) => (typeof p?.text === 'string' ? p.text.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .slice(0, 160);
  if (textSnippet) {
    throw new Error(`Gemini 生图接口未返回图像数据：${textSnippet}`);
  }
  const blockReason = parsed?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini 生图请求被拦截（${blockReason}）`);
  }
  throw new Error('Gemini 生图接口未返回图像数据');
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

  if (isGeminiNativeImageModel(cleanBase, model)) {
    return generateGeminiNativeImage({
      baseUrl: cleanBase,
      apiKey,
      model,
      prompt,
    });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const size = resolveImageSize(model, config.size);
  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/images/generations`,
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      prompt: prompt.trim(),
      ...(size ? { size } : {}),
      n: 1,
    }),
  });

  if (!resp.ok) {
    throw new Error(extractImageErrorMessage(resp.status, resp.text));
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
    return decodeBase64ImageToDataUrl(first.b64_json, 'image/png');
  }

  if (typeof first.url === 'string' && first.url.trim()) {
    const bin = await crossPlatformFetchBinary({ url: first.url.trim(), method: 'GET' });
    if (!bin.ok || !bin.base64) {
      return first.url.trim();
    }
    return decodeBase64ImageToDataUrl(bin.base64, bin.contentType || 'image/png');
  }

  throw new Error('生图返回结果中缺少 b64_json 或 url');
}
