import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSseLineProcessor,
  fetchProviderModels,
  splitInlineThinkTags,
  streamChat,
  testProviderConnection,
} from '../services/llm';
import { DEFAULT_SETTINGS } from '../db/database';
import type { ProviderConfig } from '../types';

const sampleOpenAIProvider: ProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  description: '',
  protocol: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test-123',
  models: ['deepseek-chat'],
  selectedModel: 'deepseek-chat',
  consoleUrl: '',
  docsUrl: '',
  websiteUrl: '',
  requiresKey: true,
  enabled: true,
  isCustom: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('llm service helpers & streaming', () => {
  it('splits inline <think> tags cleanly', () => {
    const partial = splitInlineThinkTags('<think>正在推理', '');
    expect(partial).toEqual({ content: '', reasoning: '正在推理' });

    const done = splitInlineThinkTags('<think>推理步骤</think>\n\n最终回答', '');
    expect(done).toEqual({ content: '最终回答', reasoning: '推理步骤' });
  });

  it('processes OpenAI SSE chunks with reasoning_content and content', () => {
    const deltas: Array<{ content: string; reasoning: string }> = [];
    let final: { content: string; reasoning: string } | null = null;
    const proc = createSseLineProcessor('openai', {
      onDelta: (d) => deltas.push(d),
      onComplete: (f) => {
        final = f;
      },
    });

    proc.feed('data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}\n\n');
    proc.feed('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
    proc.feed('data: [DONE]\n\n');
    proc.finish();

    expect(deltas.length).toBe(2);
    expect(final).toEqual({ content: '你好', reasoning: '先想' });
  });

  it('processes Anthropic SSE thinking_delta and text_delta', () => {
    let final: { content: string; reasoning: string } | null = null;
    const proc = createSseLineProcessor('anthropic', {
      onDelta: () => {},
      onComplete: (f) => {
        final = f;
      },
    });

    proc.feed('data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"分析中"}}\n\n');
    proc.feed('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"回复内容"}}\n\n');
    proc.finish();

    expect(final).toEqual({ content: '回复内容', reasoning: '分析中' });
  });

  it('streams via fetch and handles HTTP error responses', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" World"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    );

    const result = await new Promise<{ content: string; reasoning: string }>((resolve, reject) => {
      streamChat(
        {
          provider: sampleOpenAIProvider,
          model: 'deepseek-chat',
          systemPrompt: 'sys',
          history: [
            { id: '1', sessionId: 's1', role: 'user', content: 'hi', createdAt: 1 },
          ],
          settings: DEFAULT_SETTINGS,
        },
        {
          onDelta: () => {},
          onComplete: resolve,
          onError: reject,
        }
      );
    });

    expect(result.content).toBe('Hello World');
  });

  it('rejects immediately when required API key is missing', () => {
    const onError = vi.fn();
    streamChat(
      {
        provider: { ...sampleOpenAIProvider, apiKey: '' },
        model: 'deepseek-chat',
        systemPrompt: '',
        history: [],
        settings: DEFAULT_SETTINGS,
      },
      { onDelta: () => {}, onComplete: () => {}, onError }
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('API Key');
  });

  it('fetches sorted models and tests connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }] }), {
            status: 200,
          })
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ok' }), { status: 200 }))
    );

    const models = await fetchProviderModels(sampleOpenAIProvider);
    expect(models).toEqual(['model-a', 'model-b']);

    const testRes = await testProviderConnection(sampleOpenAIProvider);
    expect(testRes.ok).toBe(true);
    expect(testRes.message).toContain('连接成功');
  });
});
