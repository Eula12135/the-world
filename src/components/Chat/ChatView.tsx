import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AlertCircle,
  ArrowUp,
  KeyRound,
  Loader2,
  Mic,
  MicOff,
  Square,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useMobileKeyboardOpen } from '../../utils/keyboard';
import { isImeComposing, isProviderReady } from '../../utils/platform';
import { startVoiceCapture, stopSpeaking, type VoiceCaptureHandle } from '../../services/voiceService';
import { resolveUserAddress, resolveUserIdentity } from '../../services/userIdentity';
import { MessageItem } from './MessageItem';
import { ModelPicker } from '../Common/ModelPicker';

const QUICK_STARTERS = [
  {
    label: '构思故事主线',
    prompt: '请根据我的世界观设定，帮我梳理三条不同走向的主线剧情与核心冲突。',
  },
  {
    label: '推演章节细纲',
    prompt: '请帮我设计下一章的场景推进、人物对话交锋与结尾悬念。',
  },
  {
    label: '检查设定逻辑',
    prompt: '请仔细对照已关联的世界观文档、角色卡与时间线，排查可能存在的前后矛盾或时间漏洞。',
  },
];

const sessionScrollCache = new Map<string, { scrollTop: number; nearBottom: boolean }>();

export const ChatView: React.FC = () => {
  const {
    sessions,
    activeSessionId,
    draftConfig,
    messages,
    providers,
    worlds,
    characters,
    personaPresets,
    userPersonas,
    settings,
    isStreaming,
    streamingSessionId,
    streamingError,
    speakingMessageId,
    sendMessage,
    updateSession,
    updateDraftConfig,
    stopStreaming,
    setActiveModal,
    updateSettings,
    setSpeakingMessageId,
    showToast,
  } = useAppStore(
    useShallow((s) => ({
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      draftConfig: s.draftConfig,
      messages: s.messages,
      providers: s.providers,
      worlds: s.worlds,
      characters: s.characters,
      personaPresets: s.personaPresets,
      userPersonas: s.userPersonas,
      settings: s.settings,
      isStreaming: s.isStreaming,
      streamingSessionId: s.streamingSessionId,
      streamingError: s.streamingError,
      speakingMessageId: s.speakingMessageId,
      sendMessage: s.sendMessage,
      updateSession: s.updateSession,
      updateDraftConfig: s.updateDraftConfig,
      stopStreaming: s.stopStreaming,
      setActiveModal: s.setActiveModal,
      updateSettings: s.updateSettings,
      setSpeakingMessageId: s.setSpeakingMessageId,
      showToast: s.showToast,
    }))
  );

  const [input, setInput] = useState('');
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'transcribing'>('idle');
  const voiceHandleRef = useRef<VoiceCaptureHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const prevMsgLenRef = useRef(messages.length);
  const justMountedOrSwitchedRef = useRef(true);
  const keyboardOpen = useMobileKeyboardOpen();

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const currentProviderId = session ? session.providerId : draftConfig.providerId;
  const currentModel = session ? session.model : draftConfig.model;

  const handleModelSelect = async (pid: string, model: string) => {
    if (session) {
      await updateSession(session.id, { providerId: pid, model });
    } else {
      updateDraftConfig({ providerId: pid, model });
    }
  };
  const activeWorldId = session ? session.worldId : draftConfig.worldId;
  const boundWorld = activeWorldId ? worlds.find((w) => w.id === activeWorldId) : undefined;
  const activeChatMode = (session ? session.chatMode : draftConfig.chatMode) || 'assistant';
  const activeRoleCharId = session ? session.roleCharacterId : draftConfig.roleCharacterId;
  const activePresetId = session ? session.personaPresetId : draftConfig.personaPresetId;

  const roleCharacter = useMemo(
    () => (activeRoleCharId ? characters.find((c) => c.id === activeRoleCharId) : undefined),
    [characters, activeRoleCharId]
  );
  const personaPreset = useMemo(
    () => (activePresetId ? personaPresets.find((p) => p.id === activePresetId) : undefined),
    [personaPresets, activePresetId]
  );

  const activeUserIdentityRef = session ? session.userIdentity : draftConfig.userIdentity;
  const activeUserRelationOverride = session
    ? session.userRelationOverride
    : draftConfig.userRelationOverride;

  // 「我」只在角色对话里生效，与提示词注入范围保持一致
  const userIdentity = useMemo(() => {
    if (activeChatMode !== 'character_role') return null;
    return resolveUserIdentity(activeUserIdentityRef, userPersonas, characters);
  }, [activeChatMode, activeUserIdentityRef, userPersonas, characters]);

  const userAddress = useMemo(
    () =>
      userIdentity
        ? resolveUserAddress({
            identity: userIdentity,
            roleCharacter,
            override: activeUserRelationOverride,
          })
        : '',
    [userIdentity, roleCharacter, activeUserRelationOverride]
  );

  const isCurrentSessionStreaming =
    isStreaming && (activeSessionId === null || streamingSessionId === activeSessionId);
  const wasStreamingRef = useRef(isCurrentSessionStreaming);
  const cacheKey = activeSessionId ?? '__draft__';
  const hasMessages = messages.length > 0;

  const hasReadyProvider = useMemo(
    () => providers.some((p) => p.enabled && isProviderReady(p)),
    [providers]
  );

  const handleMessagesScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    nearBottomRef.current = nearBottom;
    sessionScrollCache.set(cacheKey, { scrollTop: el.scrollTop, nearBottom });
  };

  // 切回对话页或切换会话时在首帧绘制前恢复滚动位置，避免平滑滚过整段历史消息
  useLayoutEffect(() => {
    justMountedOrSwitchedRef.current = true;
    prevMsgLenRef.current = messages.length;
    wasStreamingRef.current = isCurrentSessionStreaming;

    const el = scrollContainerRef.current;
    if (!el) return;

    const cached = sessionScrollCache.get(cacheKey);
    if (cached && !cached.nearBottom) {
      el.scrollTop = cached.scrollTop;
      nearBottomRef.current = false;
    } else {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
    }
  }, [cacheKey, hasMessages]);

  useEffect(() => {
    if (justMountedOrSwitchedRef.current) {
      justMountedOrSwitchedRef.current = false;
      return;
    }

    const prevCount = prevMsgLenRef.current;
    const addedMessages = messages.length > prevCount;
    const streamJustFinished = wasStreamingRef.current && !isCurrentSessionStreaming;
    prevMsgLenRef.current = messages.length;
    wasStreamingRef.current = isCurrentSessionStreaming;

    if (addedMessages || (nearBottomRef.current && (isCurrentSessionStreaming || streamJustFinished))) {
      const behavior: 'auto' | 'smooth' =
        isCurrentSessionStreaming || streamJustFinished || prevCount === 0 ? 'auto' : 'smooth';
      bottomRef.current?.scrollIntoView({ behavior });
      if (addedMessages) {
        nearBottomRef.current = true;
        const el = scrollContainerRef.current;
        if (el) {
          sessionScrollCache.set(cacheKey, { scrollTop: el.scrollHeight, nearBottom: true });
        }
      }
    }
  }, [
    cacheKey,
    messages.length,
    messages[messages.length - 1]?.content,
    messages[messages.length - 1]?.reasoning,
    isCurrentSessionStreaming,
  ]);

  useEffect(() => {
    if (!keyboardOpen || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      if (nearBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [keyboardOpen, messages.length]);

  useEffect(() => {
    return () => {
      voiceHandleRef.current?.cancel();
      voiceHandleRef.current = null;
    };
  }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    nearBottomRef.current = true;
    await sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleToggleVoiceInput = () => {
    if (voiceState === 'listening') {
      voiceHandleRef.current?.stop();
      return;
    }
    if (voiceState === 'transcribing') return;

    const handle = startVoiceCapture({
      config: settings.voice,
      providers,
      onStatus: (st) => setVoiceState(st),
      onResult: (text) => {
        setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
      },
      onError: (msg) => {
        showToast(msg, 'error');
      },
      onDone: () => {
        voiceHandleRef.current = null;
        setVoiceState('idle');
      },
    });
    voiceHandleRef.current = handle;
  };

  const handleToggleAutoSpeak = () => {
    const next = !settings.voice.ttsAutoPlay;
    if (!next) {
      stopSpeaking();
      setSpeakingMessageId(null);
    }
    updateSettings({
      voice: {
        ...settings.voice,
        ttsAutoPlay: next,
      },
    });
  };

  const autoPlayTarget = settings.voice.ttsAutoPlayTarget || 'assistant';
  const autoPlayScopeLabel =
    autoPlayTarget === 'user' ? '只读我' : autoPlayTarget === 'both' ? '两边都读' : '只读角色';

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  const inputPlaceholder =
    activeChatMode === 'character_role' && roleCharacter
      ? `与「${roleCharacter.name}」开始对话...`
      : activeChatMode === 'custom_persona'
        ? `向「${personaPreset?.name || '自定义人设'}」发送消息...`
        : boundWorld
          ? `围绕《${boundWorld.name}》开始创作或提问...`
          : '向 AI 提问或开启创作，Enter 发送，Shift+Enter 换行...';

  const inputDock = (
    <div className="w-full max-w-3xl mx-auto">

      <div className="rounded-xl bg-card border border-line shadow-sm p-3 focus-within:border-accent/60 transition">
        <div className="pb-1">
          <ModelPicker
            providerId={currentProviderId}
            model={currentModel}
            onSelect={handleModelSelect}
          />
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            const el = e.currentTarget;
            window.setTimeout(() => {
              el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, 120);
          }}
          placeholder={inputPlaceholder}
          rows={messages.length === 0 ? 3 : 2}
          className="w-full max-h-44 bg-transparent text-[16px] md:text-read text-ink outline-none resize-none placeholder:text-dim leading-relaxed"
        />

        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={handleToggleVoiceInput}
              disabled={voiceState === 'transcribing'}
              className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-control text-body transition cursor-pointer ${
                voiceState === 'listening'
                  ? 'text-danger font-medium animate-pulse'
                  : 'text-secondary hover:text-ink'
              }`}
              title="语音输入"
            >
              {voiceState === 'transcribing' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : voiceState === 'listening' ? (
                <MicOff className="w-3.5 h-3.5" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
              <span>
                {voiceState === 'transcribing'
                  ? '转写中'
                  : voiceState === 'listening'
                    ? '结束录音'
                    : '语音'}
              </span>
            </button>

            {settings.voice.ttsEnabled && (
              <button
                type="button"
                onClick={handleToggleAutoSpeak}
                className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-control text-body transition cursor-pointer ${
                  settings.voice.ttsAutoPlay
                    ? 'text-accent font-medium'
                    : 'text-secondary hover:text-ink'
                }`}
                title={`自动朗读：${autoPlayScopeLabel}（可在 设置 → 声音 里改范围）`}
              >
                {settings.voice.ttsAutoPlay ? (
                  <Volume2 className="w-3.5 h-3.5" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5" />
                )}
                <span>
                  自动朗读
                  {autoPlayTarget !== 'assistant' ? `·${autoPlayTarget === 'both' ? '两边' : '我'}` : ''}
                </span>
              </button>
            )}

            {speakingMessageId && (
              <button
                type="button"
                onClick={() => {
                  stopSpeaking();
                  setSpeakingMessageId(null);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-body border border-red-500/40 bg-red-500/10 text-red-500 font-medium hover:bg-red-500/15 transition cursor-pointer"
                title="立即中断当前语音朗读"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>停止朗读</span>
              </button>
            )}

            <span className="hidden md:inline text-caption text-dim ml-1">
              纯本地客户端 · 密钥仅存本机
            </span>
          </div>

          {isCurrentSessionStreaming ? (
            <button
              onClick={stopStreaming}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-body font-medium bg-red-500 text-white hover:bg-red-600 cursor-pointer shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>停止生成</span>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center disabled:opacity-35 hover:opacity-95 transition cursor-pointer shrink-0"
              title="发送"
              aria-label="发送"
            >
              <ArrowUp className="w-4.5 h-4.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {messages.length === 0 ? (
        <div className="flex-1 overflow-y-auto px-4 flex flex-col items-center py-6">
          <div className="w-full max-w-3xl space-y-6 my-auto">
            <div className="text-center space-y-2">
              {roleCharacter?.avatarImage ? (
                <img
                  src={roleCharacter.avatarImage}
                  alt={roleCharacter.name}
                  className="w-14 h-14 mx-auto rounded-xl object-cover shadow-sm border border-line"
                />
              ) : (
                <div
                  className="w-12 h-12 mx-auto rounded-xl text-white text-xl font-bold flex items-center justify-center shadow-sm"
                  style={{
                    backgroundColor:
                      roleCharacter?.avatarColor || personaPreset?.avatarColor || 'var(--accent)',
                  }}
                >
                  {roleCharacter?.name.slice(0, 1) || personaPreset?.name.slice(0, 1) || 'W'}
                </div>
              )}
              <h1 className="text-hero font-semibold text-ink">
                {roleCharacter
                  ? userIdentity
                    ? `你以「${userAddress || userIdentity.name}」的身份，与「${roleCharacter.name}」对话`
                    : `与「${roleCharacter.name}」开启角色对话`
                  : personaPreset
                    ? `人设模式：${personaPreset.name}`
                    : '今天想聊点什么，或写点什么？'}
              </h1>
              <p className="text-body text-secondary">
                支持切换通用助手 / 自定义人设 / 扮演作品角色卡，亦可为「我」设定身份，让角色知道在跟谁说话
              </p>
            </div>

            {!hasReadyProvider && (
              <div className="p-4 rounded-xl bg-accent-soft border border-accent/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-read font-semibold text-ink flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-accent" />
                    <span>3 步开始：选厂商拿 Key → 粘贴 → 测试连通</span>
                  </div>
                  <div className="text-body text-secondary">
                    推荐先用 DeepSeek 或硅基流动，支持点击直达官方控制台获取密钥
                  </div>
                </div>
                <button
                  onClick={() => setActiveModal('providers')}
                  className="px-4 py-2 rounded-xl text-body font-medium bg-accent text-white shrink-0 hover:opacity-95 cursor-pointer"
                >
                  立即配置 API
                </button>
              </div>
            )}

            {inputDock}

            <div className="flex flex-wrap items-center justify-center gap-2">
              {QUICK_STARTERS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setInput(s.prompt)}
                  className="px-3.5 py-1.5 rounded-full bg-muted hover:bg-hover border border-line text-body text-secondary hover:text-ink transition cursor-pointer"
                >
                  {s.label}
                </button>
              ))}
              <button
                onClick={() => setActiveModal('dataTransfer')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-line text-body text-secondary hover:bg-hover hover:text-ink transition cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-accent" />
                <span>导入 DeepSeek 记录</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>

          <div
            ref={scrollContainerRef}
            onScroll={handleMessagesScroll}
            className="flex-1 overflow-y-auto px-3 md:px-6"
          >
            <div className="max-w-3xl mx-auto py-6 space-y-6">
              {messages.map((m) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  isLastAssistant={m.id === lastAssistantId}
                  sessionWorldId={session?.worldId}
                  isSessionStreaming={isCurrentSessionStreaming}
                  roleCharacter={roleCharacter}
                  personaPreset={personaPreset}
                  userIdentity={userIdentity}
                  userLabel={userAddress}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          {streamingError && (
            <div className="max-w-3xl w-full mx-auto px-3 md:px-6 pb-2">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-body">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{streamingError}</span>
                </span>
                <button
                  onClick={() => setActiveModal('providers')}
                  className="underline shrink-0 cursor-pointer"
                >
                  检查 API
                </button>
              </div>
            </div>
          )}

          <div className="shrink-0 px-3 md:px-6 pb-3 pt-1">{inputDock}</div>
        </>
      )}
    </div>
  );
};
