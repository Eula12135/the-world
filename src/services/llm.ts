import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { AppSettings, ChatMessage, ProviderConfig } from '../types';
import { createId } from '../utils/platform';

export interface StreamCallbacks {
  onDelta: (partial: { content: string; reasoning: string }) => void;
  onComplete: (final: { content: string; reasoning: string }) => void;
  onError: (err: Error) => void;
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
      messages: recent.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
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
    messages.push({ role: m.role, content: m.content });
  }

  const payload = {
    model,
    messages,
    temperature: settings.temperature,
    top_p: settings.topP,
    max_tokens: settings.maxTokens,
    stream,
  };

  return { url: `${cleanBase}/chat/completions`, headers, payload };
}

export function createSseLineProcessor(
  protocol: ProviderConfig['protocol'],
  callbacks: Pick<StreamCallbacks, 'onDelta' | 'onComplete'>
) {
  let rawContent = '';
  let rawReasoning = '';
  let buffer = '';

  const emit = () => {
    callbacks.onDelta(splitInlineThinkTags(rawContent, rawReasoning));
  };

  const feed = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(dataStr);
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
    if (buffer.trim()) {
      feed('\n');
    }
    callbacks.onComplete(splitInlineThinkTags(rawContent, rawReasoning));
  };

  return { feed, finish };
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

  const streamSpec = buildRequestPayload(provider, model, systemPrompt, history, settings, true);
  const bodyJson = JSON.stringify(streamSpec.payload);
  const processor = createSseLineProcessor(provider.protocol, callbacks);

  // 1. Desktop Electron path: bypasses CORS via main process fetch
  if (typeof window !== 'undefined' && window.theWorldDesktop?.streamStart) {
    const reqId = createId('req');
    let aborted = false;
    const unsub = window.theWorldDesktop.onStreamEvent(reqId, (ev) => {
      if (aborted) return;
      if (ev.type === 'chunk' && ev.data) {
        processor.feed(ev.data);
      } else if (ev.type === 'done') {
        unsub();
        processor.finish();
      } else if (ev.type === 'error') {
        unsub();
        callbacks.onError(new Error(ev.message || `请求失败 (HTTP ${ev.status || 0})`));
      }
    });

    window.theWorldDesktop
      .streamStart({ reqId, url: streamSpec.url, headers: streamSpec.headers, body: bodyJson })
      .catch((err: unknown) => {
        if (!aborted) {
          unsub();
          callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      aborted = true;
      unsub();
      window.theWorldDesktop?.streamAbort(reqId).catch(() => {});
    };
  }

  // 2. Web & Android Capacitor path
  const controller = new AbortController();
  let aborted = false;

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
      }
      processor.finish();
    } catch (err) {
      if (aborted || (err instanceof DOMException && err.name === 'AbortError')) {
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
          if (aborted) return;
          if (nativeResp.status < 200 || nativeResp.status >= 300) {
            const rawText =
              typeof nativeResp.data === 'string'
                ? nativeResp.data
                : JSON.stringify(nativeResp.data ?? '');
            throw new Error(parseHttpErrorText(nativeResp.status, rawText));
          }
          const result = parseNonStreamCompletion(provider.protocol, nativeResp.data);
          callbacks.onDelta(result);
          callbacks.onComplete(result);
          return;
        } catch (nativeErr) {
          if (aborted) return;
          callbacks.onError(
            nativeErr instanceof Error ? nativeErr : new Error('原生网络请求失败')
          );
          return;
        }
      }

      callbacks.onError(
        err instanceof Error ? err : new Error('网络请求失败，请检查 Base URL、Key 或网络环境')
      );
    }
  })();

  return () => {
    aborted = true;
    controller.abort();
  };
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
  const parsed = JSON.parse(resp.text);
  const list: string[] = Array.isArray(parsed?.data)
    ? parsed.data
        .map((m: { id?: string }) => (typeof m?.id === 'string' ? m.id : ''))
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
    const resp = await crossPlatformFetchJson({
      url: `${cleanBase}/chat/completions`,
      method: 'POST',
      headers,
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
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : '网络异常',
    };
  }
}
