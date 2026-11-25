import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { db, DEFAULT_SETTINGS } from '../db/database';
import { streamChat } from '../services/llm';
import { useAppStore } from '../store/useAppStore';
import { closeTopBackLayer, hasBackLayer, pushBackLayer } from '../utils/backStack';
import type { ProviderConfig } from '../types';

const mockProvider: ProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  description: '',
  protocol: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test-key',
  models: ['deepseek-chat'],
  selectedModel: 'deepseek-chat',
  consoleUrl: '',
  docsUrl: '',
  websiteUrl: '',
  requiresKey: true,
  enabled: true,
  isCustom: false,
};

describe('backStack, Android native SSE bridge & chatSlice store integration', () => {
  beforeEach(async () => {
    while (hasBackLayer()) {
      closeTopBackLayer();
    }
    await Promise.all([
      db.providers.clear(),
      db.sessions.clear(),
      db.messages.clear(),
      db.worlds.clear(),
      db.characters.clear(),
      db.relations.clear(),
      db.timelineEvents.clear(),
      db.personaPresets.clear(),
      db.userPersonas.clear(),
      db.voiceProfiles.clear(),
      db.mediaBlobs.clear(),
      db.settings.clear(),
    ]);
    await useAppStore.getState().init();
    await useAppStore.getState().saveProvider(mockProvider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('closes backStack layers in LIFO order and handles out-of-order unmount cleanup', () => {
    const closed: string[] = [];
    const remove1 = pushBackLayer(() => closed.push('drawer'));
    const remove2 = pushBackLayer(() => closed.push('modal-picker'));
    pushBackLayer(() => closed.push('lightbox'));

    expect(hasBackLayer()).toBe(true);
    expect(closeTopBackLayer()).toBe(true);
    expect(closed).toEqual(['lightbox']);

    // 中间层组件提前卸载时不应影响底层抽屉
    remove2();
    expect(closeTopBackLayer()).toBe(true);
    expect(closed).toEqual(['lightbox', 'drawer']);

    remove1();
    expect(closeTopBackLayer()).toBe(false);
  });

  it('streams tokens and supports abort via Android native SSE bridge', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

    const abortedIds: string[] = [];
    const target = new EventTarget();
    const mockWin = Object.assign(target, {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
      TheWorldAndroid: {
        setTheme: () => {},
        streamStart: (reqId: string, jsonSpec: string) => {
          const parsed = JSON.parse(jsonSpec);
          expect(parsed.url).toBe('https://api.deepseek.com/v1/chat/completions');
          setTimeout(() => {
            mockWin.dispatchEvent(
              new CustomEvent('theworld-stream', {
                detail: {
                  reqId,
                  type: 'chunk',
                  data: 'data: {"choices":[{"delta":{"reasoning_content":"思考A"}}]}\n\n',
                },
              })
            );
            mockWin.dispatchEvent(
              new CustomEvent('theworld-stream', {
                detail: {
                  reqId,
                  type: 'chunk',
                  data: 'data: {"choices":[{"delta":{"content":"原生流式回复"}}]}\n\n',
                },
              })
            );
            mockWin.dispatchEvent(
              new CustomEvent('theworld-stream', {
                detail: { reqId, type: 'done' },
              })
            );
          }, 5);
        },
        streamAbort: (reqId: string) => {
          abortedIds.push(reqId);
        },
      },
    });
    vi.stubGlobal('window', mockWin);

    const final = await new Promise<{ content: string; reasoning: string }>((resolve, reject) => {
      streamChat(
        {
          provider: mockProvider,
          model: 'deepseek-chat',
          systemPrompt: 'sys',
          history: [{ id: 'm1', sessionId: 's1', role: 'user', content: 'hi', createdAt: 1 }],
          settings: DEFAULT_SETTINGS,
        },
        {
          onDelta: () => {},
          onComplete: resolve,
          onError: reject,
        }
      );
    });

    expect(final).toEqual({ content: '原生流式回复', reasoning: '思考A' });

    // 验证主动中断调用原生 streamAbort
    mockWin.TheWorldAndroid.streamStart = () => {};
    const cancel = streamChat(
      {
        provider: mockProvider,
        model: 'deepseek-chat',
        systemPrompt: 'sys',
        history: [{ id: 'm1', sessionId: 's1', role: 'user', content: 'hi', createdAt: 1 }],
        settings: DEFAULT_SETTINGS,
      },
      {
        onDelta: () => {},
        onComplete: () => {},
        onError: () => {},
      }
    );
    cancel();
    expect(abortedIds.length).toBe(1);
  });

  it('maintains summarizedCount invariants across sendMessage, deleteMessage, and editAndResend', async () => {
    let replySeq = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      replySeq += 1;
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(
            encoder.encode(`data: {"choices":[{"delta":{"content":"回答${replySeq}"}}]}\n\n`)
          );
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
          ctrl.close();
        },
      });
      return new Response(body, { status: 200 });
    }));

    await useAppStore.getState().startNewDraft();
    await useAppStore.getState().sendMessage('第一问');
    await vi.waitFor(() => expect(useAppStore.getState().isStreaming).toBe(false));

    await useAppStore.getState().sendMessage('第二问');
    await vi.waitFor(() => expect(useAppStore.getState().isStreaming).toBe(false));

    const sessId = useAppStore.getState().activeSessionId!;
    expect(useAppStore.getState().messages.length).toBe(4);

    // 模拟前 3 条消息已被压缩为滚动摘要
    await useAppStore.getState().updateSession(sessId, {
      rollingSummary: '前情提要内容',
      summarizedCount: 3,
    });

    // 删除第 1 条消息（位于 summarizedCount 之内）应自动递减 summarizedCount
    const firstMsgId = useAppStore.getState().messages[0].id;
    await useAppStore.getState().deleteMessage(firstMsgId);
    const afterDelSess = useAppStore.getState().sessions.find((s) => s.id === sessId)!;
    expect(afterDelSess.summarizedCount).toBe(2);
    expect(afterDelSess.rollingSummary).toBe('前情提要内容');

    // 编辑重发第 0 条消息（截断到索引 0）应自动清空失效的 rollingSummary
    const remainingFirstId = useAppStore.getState().messages[0].id;
    await useAppStore.getState().editAndResend(remainingFirstId, '重发第一问');
    await vi.waitFor(() => expect(useAppStore.getState().isStreaming).toBe(false));

    const afterEditSess = useAppStore.getState().sessions.find((s) => s.id === sessId)!;
    expect(afterEditSess.summarizedCount).toBe(0);
    expect(afterEditSess.rollingSummary).toBeUndefined();
    expect(useAppStore.getState().messages.map((m) => m.content)).toEqual(['重发第一问', '回答3']);
  });

  it('steps back from providers modal to settings modal when opened from settings', () => {
    const store = useAppStore.getState();
    store.setActiveModal('settings');
    expect(useAppStore.getState().activeModal).toBe('settings');
    expect(useAppStore.getState().modalReturnTo).toBe('none');

    // 从设置进入配置 API 时，记住返回目标为 settings
    useAppStore.getState().openProvidersModal('llm');
    expect(useAppStore.getState().activeModal).toBe('providers');
    expect(useAppStore.getState().modalReturnTo).toBe('settings');

    // 点返回或按 ESC 逐级退回设置，再退一次才彻底关闭
    useAppStore.getState().closeOrStepBackModal();
    expect(useAppStore.getState().activeModal).toBe('settings');
    expect(useAppStore.getState().modalReturnTo).toBe('none');

    useAppStore.getState().closeOrStepBackModal();
    expect(useAppStore.getState().activeModal).toBe('none');
  });
});
