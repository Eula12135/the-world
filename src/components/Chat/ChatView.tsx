import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { startVoiceCapture, stopSpeaking, type VoiceCaptureHandle } from '../../services/voiceService';
import { MessageItem } from './MessageItem';
import { WorldContextPopover } from '../Common/WorldContextPopover';
import { SessionModeModal } from '../Common/SessionModeModal';

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
    settings,
    isStreaming,
    streamingSessionId,
    streamingError,
    sendMessage,
    stopStreaming,
    setActiveModal,
    updateSettings,
    setSpeakingMessageId,
    showToast,
  } = useAppStore();

  const [input, setInput] = useState('');
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'transcribing'>('idle');
  const voiceHandleRef = useRef<VoiceCaptureHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const keyboardOpen = useMobileKeyboardOpen();

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
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

  const isCurrentSessionStreaming =
    isStreaming && (activeSessionId === null || streamingSessionId === activeSessionId);

  const currentProviderId = session ? session.providerId : draftConfig.providerId;
  const hasReadyProvider = useMemo(
    () =>
      currentProviderId === 'ollama' ||
      providers.some((p) => p.enabled && p.requiresKey && p.apiKey.trim().length > 0),
    [providers, currentProviderId]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: isCurrentSessionStreaming ? 'auto' : 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content, isCurrentSessionStreaming]);

  useEffect(() => {
    if (!keyboardOpen || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [keyboardOpen, messages.length]);

  useEffect(() => {
    return () => {
      voiceHandleRef.current?.stop();
      voiceHandleRef.current = null;
    };
  }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    await sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SessionModeModal />
        <WorldContextPopover draftInput={input} />
      </div>

      <div className="rounded-2xl bg-card border border-line shadow-sm p-3 focus-within:border-accent/60 transition">
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
          className="w-full max-h-44 bg-transparent text-[15px] text-ink outline-none resize-none placeholder:text-dim leading-relaxed"
        />

        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={handleToggleVoiceInput}
              disabled={voiceState === 'transcribing'}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[12px] border transition cursor-pointer ${
                voiceState === 'listening'
                  ? 'border-red-500/60 bg-red-500/12 text-red-500 font-medium animate-pulse'
                  : 'border-line text-secondary hover:bg-hover hover:text-ink'
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
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[12px] border transition cursor-pointer ${
                  settings.voice.ttsAutoPlay
                    ? 'border-accent/50 bg-accent-soft text-accent font-medium'
                    : 'border-line text-secondary hover:bg-hover hover:text-ink'
                }`}
                title="AI 回复完成后自动朗读"
              >
                {settings.voice.ttsAutoPlay ? (
                  <Volume2 className="w-3.5 h-3.5" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5" />
                )}
                <span>自动朗读</span>
              </button>
            )}

            <span className="hidden md:inline text-[11.5px] text-dim ml-1">
              纯本地客户端 · 密钥仅存本机
            </span>
          </div>

          {isCurrentSessionStreaming ? (
            <button
              onClick={stopStreaming}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-[13px] font-medium bg-red-500 text-white hover:bg-red-600 cursor-pointer shrink-0"
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
                  className="w-14 h-14 mx-auto rounded-2xl object-cover shadow-sm border border-line"
                />
              ) : (
                <div
                  className="w-12 h-12 mx-auto rounded-2xl text-white text-xl font-bold flex items-center justify-center shadow-sm"
                  style={{
                    backgroundColor:
                      roleCharacter?.avatarColor || personaPreset?.avatarColor || 'var(--accent)',
                  }}
                >
                  {roleCharacter?.name.slice(0, 1) || personaPreset?.name.slice(0, 1) || 'W'}
                </div>
              )}
              <h1 className="text-[20px] font-semibold text-ink">
                {roleCharacter
                  ? `与「${roleCharacter.name}」开启角色对话`
                  : personaPreset
                    ? `人设模式：${personaPreset.name}`
                    : '今天想聊点什么，或写点什么？'}
              </h1>
              <p className="text-[13px] text-secondary">
                支持切换通用助手 / 自定义人设 / 扮演作品角色卡，亦支持生图与语音框架
              </p>
            </div>

            {!hasReadyProvider && (
              <div className="p-4 rounded-2xl bg-accent-soft border border-accent/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-[14px] font-semibold text-ink flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-accent" />
                    <span>3 步开始：选厂商拿 Key → 粘贴 → 测试连通</span>
                  </div>
                  <div className="text-[12px] text-secondary">
                    推荐先用 DeepSeek 或硅基流动，支持点击直达官方控制台获取密钥
                  </div>
                </div>
                <button
                  onClick={() => setActiveModal('providers')}
                  className="px-4 py-2 rounded-xl text-[13px] font-medium bg-accent text-white shrink-0 hover:opacity-95 cursor-pointer"
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
                  className="px-3.5 py-1.5 rounded-full bg-muted hover:bg-hover border border-line text-[13px] text-secondary hover:text-ink transition cursor-pointer"
                >
                  {s.label}
                </button>
              ))}
              <button
                onClick={() => setActiveModal('dataTransfer')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-line text-[13px] text-secondary hover:bg-hover hover:text-ink transition cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-accent" />
                <span>导入 DeepSeek 记录</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-3 md:px-6">
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
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          {streamingError && (
            <div className="max-w-3xl w-full mx-auto px-3 md:px-6 pb-2">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-[13px]">
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
