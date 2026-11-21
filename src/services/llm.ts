import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { AppSettings, ChatMessage, ProviderConfig } from '../types';
import { createId, detectUnreachableLocalhost } from '../utils/platform';

export interface StreamCallbacks {
  onDelta: (partial: { content: string; reasoning: string }) => void;
  onComplete: (final: { content: string; reasoning: string }) => void;
  onError: (err: Error) => void;
}

export function safeJsonParse<T = unknown>(raw: string, fallbackContext = '接口返回了非 JSON 内容'): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const preview = raw.trim().slice(0, 120);
    throw new Error(`${fallbackContext}${preview ? `：${preview}` : ''}`);
  }
}

export function isOpenAIReasoningModel(model: string): boolean {
  const base = (model || '').trim().split('/').pop() || '';
  return /^(?:o[134])(?:-|$)/i.test(base);
}

export function splitInlineThinkTags(
  rawText: string,
  existingReasoning: string
): { content: string; reasoning: string } {
  if (existingReasoning) {
    return { content: rawText, reasoning: existingReasoning };
  }
  const openTag = '<think>';
  const closeTag = '</think>';
  if (!rawText.includes(openTag)) {
    return { content: rawText, reasoning: '' };
  }
  const start = rawText.indexOf(openTag);
  const end = rawText.indexOf(closeTag, start + openTag.length);
  if (end === -1) {
    return {
      content: rawText.slice(0, start),
      reasoning: rawText.slice(start + openTag.length).trim(),
    };
  }
  const thinkBody = rawText.slice(start + openTag.length, end).trim();
  const contentBody = (rawText.slice(0, start) + rawText.slice(end + closeTag.length)).trimStart();
  return { content: contentBody, reasoning: thinkBody };
}

/**
 * Anthropic Messages API 要求角色严格交替、且第一条必须是 user。
 * 开启「前情摘要」后历史是按 summarizedCount 切片的，可能以 assistant 开头，
 * 原样发送会被上游以 400 拒绝，所以这里做一次规范化。
 */
export function normalizeAnthropicMessages(
  messages: Array<{ role: string; content: string }>
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const mapped = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  while (mapped.length > 0 && mapped[0].role === 'assistant') {
    mapped.shift();
  }

  const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of mapped) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      merged.push({ ...m });
    }
  }
  return merged;
}

function buildRequestPayload(
  provider: ProviderConfig,
  model: string,
  systemPrompt: string,
  history: ChatMessage[],
  settings: AppSettings,
  stream: boolean
): { url: string; headers: Record<string, string>; payload: Record<string, unknown> } {
  const cleanBase = provider.baseUrl.replace(/\/+$/, '');
  const recent = history.slice(-settings.contextMessagesLimit).filter((m) => m.role !== 'system');

  if (provider.protocol === 'anthropic') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const payload: Record<string, unknown> = {
      model,
      max_tokens: settings.maxTokens,
      temperature: settings.temperature,
      stream,
      messages: normalizeAnthropicMessages(
        recent.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }))
      ),
    };
    if (systemPrompt.trim()) payload.system = systemPrompt.trim();
    return { url: `${cleanBase}/messages`, headers, payload };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (provider.apiKey.trim()) {
    headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }
  for (const m of recent) {
    if (m.role === 'assistant' && !m.content.trim()) continue;
    messages.push({ role: m.role, content: m.content });
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    stream,
  };
  if (isOpenAIReasoningModel(model)) {
    payload.max_completion_tokens = settings.maxTokens;
  } else {
    payload.temperature = settings.temperature;
    payload.top_p = settings.topP;
    payload.max_tokens = settings.maxTokens;
  }

  return { url: `${cleanBase}/chat/completions`, headers, payload };
}

export function createSseLineProcessor(
  protocol: ProviderConfig['protocol'],
  callbacks: Pick<StreamCallbacks, 'onDelta' | 'onComplete'> &
    Partial<Pick<StreamCallbacks, 'onError'>>
) {
  let rawContent = '';
  let rawReasoning = '';
  let buffer = '';
  let failed = false;

  const emit = () => {
    callbacks.onDelta(splitInlineThinkTags(rawContent, rawReasoning));
  };

  const fail = (message: string) => {
    if (failed) return;
    failed = true;
    callbacks.onError?.(new Error(message));
  };

  const feed = (chunk: string) => {
    if (failed) return;
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      if (failed) break;
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(dataStr);
        if (parsed?.type === 'error' || parsed?.error) {
          const msg =
            parsed?.error?.message ||
            parsed?.message ||
            (typeof parsed?.error === 'string' ? parsed.error : '') ||
            '流式接口返回错误';
          fail(String(msg));
          return;
        }
        if (protocol === 'anthropic') {
          if (parsed?.type === 'content_block_delta') {
            if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
              rawReasoning += parsed.delta.thinking;
              emit();
            } else if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
              rawContent += parsed.delta.text;
              emit();
            }
          }
        } else {
          const delta = parsed?.choices?.[0]?.delta;
          if (!delta) continue;
          const rPart = delta.reasoning_content || delta.reasoning || '';
          const cPart = delta.content || '';
          if (rPart || cPart) {
            rawReasoning += rPart;
            rawContent += cPart;
            emit();
          }
        }
      } catch {
        // Ignore partial JSON fragment
      }
    }
  };

  const finish = () => {
    if (failed) return;
    if (buffer.trim()) {
      feed('\n');
    }
    if (failed) return;
    callbacks.onComplete(splitInlineThinkTags(rawContent, rawReasoning));
  };

  return { feed, finish, hasFailed: () => failed };
}

function parseNonStreamCompletion(
  protocol: ProviderConfig['protocol'],
  rawData: unknown
): { content: string; reasoning: string } {
  const data = typeof rawData === 'string' ? JSON.parse(rawData) : (rawData as Record<string, unknown>);
  if (protocol === 'anthropic') {
    const blocks = Array.isArray(data?.content)
      ? (data.content as Array<{ type?: string; text?: string; thinking?: string }>)
      : [];
    const thinking = blocks
      .filter((b) => b.type === 'thinking' && b.thinking)
      .map((b) => b.thinking!)
      .join('\n\n');
    const text = blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('');
    return splitInlineThinkTags(text, thinking);
  }
  const choices = Array.isArray(data?.choices)
    ? (data.choices as Array<{ message?: { content?: string; reasoning_content?: string; reasoning?: string } }>)
    : [];
  const msg = choices[0]?.message;
  const content = String(msg?.content || '');
  const reasoning = String(msg?.reasoning_content || msg?.reasoning || '');
  return splitInlineThinkTags(content, reasoning);
}

function parseHttpErrorText(status: number, text: string): string {
  let message = `请求失败 (HTTP ${status})`;
  try {
    const j = JSON.parse(text);
    if (j?.error?.message) message = j.error.message;
    else if (j?.message) message = j.message;
  } catch {
    if (text) message = `${message}: ${text.slice(0, 180)}`;
  }
  return message;
}

export function streamChat(
  params: {
    provider: ProviderConfig;
    model: string;
    systemPrompt: string;
    history: ChatMessage[];
    settings: AppSettings;
  },
  callbacks: StreamCallbacks
): () => void {
  const { provider, model, systemPrompt, history, settings } = params;

  if (provider.requiresKey && !provider.apiKey.trim()) {
    callbacks.onError(new Error(`尚未填写 ${provider.name} 的 API Key，请先在「模型厂商」中配置`));
    return () => {};
  }
  if (!provider.baseUrl.trim()) {
    callbacks.onError(new Error('API Base URL 不能为空'));
    return () => {};
  }
  const localhostWarning = detectUnreachableLocalhost(provider.baseUrl);
  if (localhostWarning) {
    callbacks.onError(new Error(localhostWarning));
    return () => {};
  }

  const streamSpec = buildRequestPayload(provider, model, systemPrompt, history, settings, true);
  const bodyJson = JSON.stringify(streamSpec.payload);
  let settled = false;
  let cancelDesktopOrFetch: () => void = () => {};
  const processor = createSseLineProcessor(provider.protocol, {
    onDelta: callbacks.onDelta,
    onComplete: (res) => {
      if (settled) return;
      settled = true;
      callbacks.onComplete(res);
    },
    onError: (err) => {
      if (settled) return;
      settled = true;
      cancelDesktopOrFetch();
      callbacks.onError(err);
    },
  });

  // 1. Desktop Electron path: bypasses CORS via main process fetch
  if (typeof window !== 'undefined' && window.theWorldDesktop?.streamStart) {
    const reqId = createId('req');
    let aborted = false;
    const unsub = window.theWorldDesktop.onStreamEvent(reqId, (ev) => {
      if (aborted || settled) return;
      if (ev.type === 'chunk' && ev.data) {
        processor.feed(ev.data);
      } else if (ev.type === 'done') {
        unsub();
        processor.finish();
      } else if (ev.type === 'error') {
        unsub();
        settled = true;
        callbacks.onError(new Error(ev.message || `请求失败 (HTTP ${ev.status || 0})`));
      }
    });

    cancelDesktopOrFetch = () => {
      aborted = true;
      unsub();
      window.theWorldDesktop?.streamAbort(reqId).catch(() => {});
    };

    window.theWorldDesktop
      .streamStart({ reqId, url: streamSpec.url, headers: streamSpec.headers, body: bodyJson })
      .catch((err: unknown) => {
        if (!aborted && !settled) {
          unsub();
          settled = true;
          callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return cancelDesktopOrFetch;
  }

  // 2. Web & Android Capacitor path
  const controller = new AbortController();
  let aborted = false;
  cancelDesktopOrFetch = () => {
    aborted = true;
    controller.abort();
  };

  (async () => {
    let gotResponseHeaders = false;
    try {
      const resp = await fetch(streamSpec.url, {
        method: 'POST',
        headers: streamSpec.headers,
        body: bodyJson,
        signal: controller.signal,
      });
      gotResponseHeaders = true;
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(parseHttpErrorText(resp.status, text));
      }
      if (!resp.body) {
        throw new Error('响应流为空');
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          processor.feed(decoder.decode(value, { stream: true }));
        }
        if (processor.hasFailed()) break;
      }
      if (!processor.hasFailed()) {
        const tail = decoder.decode();
        if (tail) processor.feed(tail);
        processor.finish();
      }
    } catch (err) {
      if (aborted || settled || (err instanceof DOMException && err.name === 'AbortError')) {
        return;
      }

      // On Android native WebView, CORS-blocked requests fail before headers arrive.
      // Automatically fall back to CapacitorHttp native request (non-streaming).
      if (!gotResponseHeaders && Capacitor.isNativePlatform()) {
        try {
          const nonStreamSpec = buildRequestPayload(
            provider,
            model,
            systemPrompt,
            history,
            settings,
            false
          );
          const nativeResp = await CapacitorHttp.post({
            url: nonStreamSpec.url,
            headers: nonStreamSpec.headers,
            data: nonStreamSpec.payload,
            responseType: 'text',
          });
          if (aborted || settled) return;
          if (nativeResp.status < 200 || nativeResp.status >= 300) {
            const rawText =
              typeof nativeResp.data === 'string'
                ? nativeResp.data
                : JSON.stringify(nativeResp.data ?? '');
            throw new Error(parseHttpErrorText(nativeResp.status, rawText));
          }
          const result = parseNonStreamCompletion(provider.protocol, nativeResp.data);
          settled = true;
          callbacks.onDelta(result);
          callbacks.onComplete(result);
          return;
        } catch (nativeErr) {
          if (aborted || settled) return;
          settled = true;
          callbacks.onError(
            nativeErr instanceof Error ? nativeErr : new Error('原生网络请求失败')
          );
          return;
        }
      }

      settled = true;
      callbacks.onError(
        err instanceof Error ? err : new Error('网络请求失败，请检查 Base URL、Key 或网络环境')
      );
    }
  })();

  return cancelDesktopOrFetch;
}

export async function crossPlatformFetchJson(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ ok: boolean; status: number; text: string }> {
  if (typeof window !== 'undefined' && window.theWorldDesktop?.fetchJson) {
    return window.theWorldDesktop.fetchJson(params);
  }
  if (Capacitor.isNativePlatform()) {
    const resp = await CapacitorHttp.request({
      url: params.url,
      method: params.method || 'GET',
      headers: params.headers,
      data: params.body ? JSON.parse(params.body) : undefined,
      responseType: 'text',
    });
    const text = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data ?? '');
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      text,
    };
  }
  const resp = await fetch(params.url, {
    method: params.method || 'GET',
    headers: params.headers,
    body: params.body,
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',').pop() || '' : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function crossPlatformFetchBinary(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ ok: boolean; status: number; contentType: string; base64: string; errorText: string }> {
  if (typeof window !== 'undefined' && window.theWorldDesktop?.fetchBinary) {
    return window.theWorldDesktop.fetchBinary(params);
  }
  if (Capacitor.isNativePlatform()) {
    const resp = await CapacitorHttp.request({
      url: params.url,
      method: params.method || 'GET',
      headers: params.headers,
      data: params.body ? JSON.parse(params.body) : undefined,
      responseType: 'blob',
    });
    const contentType =
      String(resp.headers?.['content-type'] || resp.headers?.['Content-Type'] || '');
    const ok = resp.status >= 200 && resp.status < 300;
    const rawData = typeof resp.data === 'string' ? resp.data : '';
    const base64 = ok ? (rawData.includes(',') ? rawData.split(',').pop() || '' : rawData) : '';
    const errorText = !ok
      ? typeof resp.data === 'string'
        ? resp.data.slice(0, 800)
        : JSON.stringify(resp.data ?? '')
      : '';
    return { ok, status: resp.status, contentType, base64, errorText };
  }

  const resp = await fetch(params.url, {
    method: params.method || 'GET',
    headers: params.headers,
    body: params.body,
  });
  const contentType = resp.headers.get('content-type') || '';
  if (!resp.ok) {
    const errorText = (await resp.text().catch(() => '')).slice(0, 800);
    return { ok: false, status: resp.status, contentType, base64: '', errorText };
  }
  const buf = new Uint8Array(await resp.arrayBuffer());
  return {
    ok: true,
    status: resp.status,
    contentType,
    base64: uint8ArrayToBase64(buf),
    errorText: '',
  };
}

export async function crossPlatformUploadMultipart(params: {
  url: string;
  headers?: Record<string, string>;
  fields: Record<string, string>;
  fileField: string;
  fileName: string;
  fileMime: string;
  fileBase64: string;
}): Promise<{ ok: boolean; status: number; text: string }> {
  if (typeof window !== 'undefined' && window.theWorldDesktop?.uploadMultipart) {
    return window.theWorldDesktop.uploadMultipart(params);
  }

  if (
    Capacitor.isNativePlatform() &&
    typeof window !== 'undefined' &&
    window.TheWorldAndroid?.uploadMultipart
  ) {
    const reqId = createId('mp');
    return new Promise((resolve) => {
      let settled = false;
      const finish = (res: { ok: boolean; status: number; text: string }) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('theworld-multipart', onDone);
        window.clearTimeout(timer);
        resolve(res);
      };
      const onDone = (ev: Event) => {
        const detail = (
          ev as CustomEvent<{ reqId?: string; ok?: boolean; status?: number; text?: string }>
        ).detail;
        if (!detail || detail.reqId !== reqId) return;
        finish({
          ok: Boolean(detail.ok),
          status: typeof detail.status === 'number' ? detail.status : 0,
          text: typeof detail.text === 'string' ? detail.text : '',
        });
      };
      const timer = window.setTimeout(
        () => finish({ ok: false, status: 0, text: '原生上传请求超时' }),
        120_000
      );
      window.addEventListener('theworld-multipart', onDone);
      try {
        window.TheWorldAndroid!.uploadMultipart!(reqId, JSON.stringify(params));
      } catch (err) {
        finish({
          ok: false,
          status: 0,
          text: err instanceof Error ? err.message : '原生上传调用失败',
        });
      }
    });
  }

  const form = new FormData();
  for (const [k, v] of Object.entries(params.fields || {})) {
    form.append(k, v);
  }
  const bytes = base64ToUint8Array(params.fileBase64);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: params.fileMime || 'audio/webm' });
  form.append(params.fileField || 'file', blob, params.fileName || 'audio.webm');

  const cleanHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.headers || {})) {
    if (k.toLowerCase() !== 'content-type') {
      cleanHeaders[k] = v;
    }
  }

  const resp = await fetch(params.url, {
    method: 'POST',
    headers: cleanHeaders,
    body: form,
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

export async function fetchProviderModels(provider: ProviderConfig): Promise<string[]> {
  if (provider.protocol === 'anthropic') {
    return provider.models;
  }
  const localhostWarning = detectUnreachableLocalhost(provider.baseUrl);
  if (localhostWarning) {
    throw new Error(localhostWarning);
  }
  const cleanBase = provider.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (provider.apiKey.trim()) {
    headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
  }
  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/models`,
    method: 'GET',
    headers,
  });
  if (!resp.ok) {
    throw new Error(`拉取模型失败 (HTTP ${resp.status})`);
  }
  const parsed = safeJsonParse<{ data?: Array<{ id?: string }> }>(
    resp.text,
    '模型列表接口返回格式异常'
  );
  const list: string[] = Array.isArray(parsed?.data)
    ? parsed.data
        .map((m) => (typeof m?.id === 'string' ? m.id : ''))
        .filter(Boolean)
    : [];
  if (list.length === 0) {
    throw new Error('接口未返回模型列表，请手动添加模型 ID');
  }
  return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
}

export async function testProviderConnection(
  provider: ProviderConfig
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  if (provider.requiresKey && !provider.apiKey.trim()) {
    return { ok: false, latencyMs: 0, message: '请先填写 API Key' };
  }
  const localhostWarning = detectUnreachableLocalhost(provider.baseUrl);
  if (localhostWarning) {
    return { ok: false, latencyMs: 0, message: localhostWarning };
  }
  const started = Date.now();
  const cleanBase = provider.baseUrl.replace(/\/+$/, '');
  const model = provider.selectedModel || provider.models[0];

  try {
    if (provider.protocol === 'anthropic') {
      const resp = await crossPlatformFetchJson({
        url: `${cleanBase}/messages`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      const latencyMs = Date.now() - started;
      if (!resp.ok) {
        return { ok: false, latencyMs, message: parseHttpErrorText(resp.status, resp.text) };
      }
      return { ok: true, latencyMs, message: `连接成功 (${latencyMs}ms)` };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
    const testBody: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: 'Hi' }],
    };
    if (isOpenAIReasoningModel(model)) {
      testBody.max_completion_tokens = 8;
    } else {
      testBody.max_tokens = 8;
    }
    const resp = await crossPlatformFetchJson({
      url: `${cleanBase}/chat/completions`,
      method: 'POST',
      headers,
      body: JSON.stringify(testBody),
    });
    const latencyMs = Date.now() - started;
    if (!resp.ok) {
      return { ok: false, latencyMs, message: parseHttpErrorText(resp.status, resp.text) };
    }
    return { ok: true, latencyMs, message: `连接成功 (${latencyMs}ms)` };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : '网络异常',
    };
  }
}
