import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  Globe,
  RefreshCw,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { Character, ChatMessage, PersonaPreset } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { speakText, stopSpeaking } from '../../services/voiceService';

interface MessageItemProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  sessionWorldId?: string;
  isSessionStreaming: boolean;
  roleCharacter?: Character;
  personaPreset?: PersonaPreset;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isLastAssistant,
  sessionWorldId,
  isSessionStreaming,
  roleCharacter,
  personaPreset,
}) => {
  const {
    regenerateLastAssistant,
    deleteMessage,
    editAndResend,
    worlds,
    updateWorld,
    settings,
    providers,
    speakingMessageId,
    setSpeakingMessageId,
    showToast,
    requestConfirm,
  } = useAppStore();

  const [copied, setCopied] = useState(false);
  const [thinkOpen, setThinkOpen] = useState(false);
  const [userActionsOpen, setUserActionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftEdit, setDraftEdit] = useState(message.content);

  const isUser = message.role === 'user';
  const isSpeaking = speakingMessageId === message.id;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      showToast('已复制到剪贴板', 'success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast('复制失败，请长按手动选择', 'error');
    }
  };

  const handleSpeakToggle = async () => {
    if (isSpeaking) {
      stopSpeaking();
      setSpeakingMessageId(null);
      return;
    }
    setSpeakingMessageId(message.id);
    await speakText({
      text: message.content,
      config: settings.voice,
      providers,
      voiceOverride: roleCharacter?.voiceName || personaPreset?.voiceName,
      onEnd: () => {
        if (useAppStore.getState().speakingMessageId === message.id) {
          setSpeakingMessageId(null);
        }
      },
      onError: (msg) => {
        if (useAppStore.getState().speakingMessageId === message.id) {
          setSpeakingMessageId(null);
        }
        showToast(msg, 'error');
      },
    });
  };

  const handleSaveEdit = async () => {
    const trimmed = draftEdit.trim();
    if (!trimmed) return;
    setEditing(false);
    await editAndResend(message.id, trimmed);
  };

  const handleAppendToWorld = async () => {
    const targetWorld = sessionWorldId ? worlds.find((w) => w.id === sessionWorldId) : null;
    if (!targetWorld) return;
    const clean = message.content.trim();
    const title = clean.split('\n')[0]?.replace(/^[#>*\s]+/, '').slice(0, 24) || '灵感片段';
    const nextDoc = `${targetWorld.document.trimEnd()}\n\n## 灵感补充：${title}\n${clean}\n`;
    await updateWorld(targetWorld.id, { document: nextDoc });
    showToast(`已追加到《${targetWorld.name}》设定文档`, 'success');
  };

  const handleDelete = () => {
    requestConfirm({
      title: '删除消息',
      message: '确定要删除这条消息吗？',
      onConfirm: async () => {
        await deleteMessage(message.id);
      },
    });
  };

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] md:max-w-[75%] space-y-1.5">
          {editing ? (
            <div className="p-3 rounded-2xl bg-card border border-accent space-y-2 min-w-[260px]">
              <textarea
                value={draftEdit}
                onChange={(e) => setDraftEdit(e.target.value)}
                rows={4}
                className="w-full bg-transparent text-[15px] text-ink outline-none resize-y"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="px-3 py-1 rounded-lg text-[12px] border border-line text-secondary cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1 rounded-lg text-[12px] bg-accent text-white cursor-pointer"
                >
                  重新发送
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => setUserActionsOpen((v) => !v)}
              className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-user-bubble text-[15px] leading-relaxed text-ink whitespace-pre-wrap break-words cursor-pointer"
              title="点击展开操作菜单"
            >
              {message.content}
            </div>
          )}

          {userActionsOpen && !editing && (
            <div className="flex justify-end gap-1">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-dim hover:text-ink hover:bg-hover cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>复制</span>
              </button>
              <button
                onClick={() => {
                  setDraftEdit(message.content);
                  setEditing(true);
                  setUserActionsOpen(false);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-dim hover:text-ink hover:bg-hover cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>编辑重发</span>
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-dim hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const avatarImg = roleCharacter?.avatarImage || personaPreset?.avatarImage;
  const avatarLabel = roleCharacter?.name || personaPreset?.name;
  const avatarColor = roleCharacter?.avatarColor || personaPreset?.avatarColor || 'var(--accent)';

  return (
    <div className="flex gap-3">
      {avatarImg ? (
        <img
          src={avatarImg}
          alt={avatarLabel || 'avatar'}
          className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5 border border-line"
        />
      ) : (
        <div
          className="w-7 h-7 rounded-full shrink-0 text-white text-xs font-bold flex items-center justify-center mt-0.5"
          style={{ backgroundColor: avatarColor }}
        >
          {avatarLabel ? avatarLabel.slice(0, 1) : 'W'}
        </div>
      )}

      <div className="flex-1 min-w-0 space-y-2.5">
        {avatarLabel && (
          <div className="text-[11.5px] font-medium text-secondary -mb-1">{avatarLabel}</div>
        )}

        {message.searchQueries && message.searchQueries.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-dim">
            <Globe className="w-3.5 h-3.5" />
            <span>检索词：</span>
            {message.searchQueries.map((q, idx) => (
              <span key={idx} className="px-2 py-0.5 rounded-full bg-muted text-secondary">
                {q}
              </span>
            ))}
          </div>
        )}

        {message.reasoning && (
          <div className="border-l-2 border-line pl-3">
            <button
              onClick={() => setThinkOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[13px] font-medium text-dim hover:text-secondary cursor-pointer"
            >
              {thinkOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <span>
                {message.thinkingDurationSec
                  ? `已深度思考（${message.thinkingDurationSec} 秒）`
                  : '思考过程'}
              </span>
            </button>
            {thinkOpen && (
              <div className="mt-1.5 text-[13px] leading-relaxed text-secondary whitespace-pre-wrap">
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        {message.content ? (
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={(url) => (/^(https?:|mailto:)/i.test(url) ? url : '')}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          isSessionStreaming &&
          isLastAssistant && (
            <div className="flex items-center gap-2 text-[13px] text-dim">
              <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span>正在思考与生成...</span>
            </div>
          )
        )}

        {message.warningNote && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 text-amber-500 text-[12px]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{message.warningNote}</span>
          </div>
        )}

        {(!isSessionStreaming || !isLastAssistant) && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-dim hover:text-ink hover:bg-hover cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>

            {settings.voice.ttsEnabled && message.content && (
              <button
                onClick={handleSpeakToggle}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] cursor-pointer ${
                  isSpeaking
                    ? 'text-accent bg-accent-soft font-medium'
                    : 'text-dim hover:text-ink hover:bg-hover'
                }`}
              >
                {isSpeaking ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span>停止朗读</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>朗读</span>
                  </>
                )}
              </button>
            )}

            {isLastAssistant && (
              <button
                onClick={regenerateLastAssistant}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-dim hover:text-ink hover:bg-hover cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>重新生成</span>
              </button>
            )}

            {sessionWorldId && message.content && (
              <button
                onClick={handleAppendToWorld}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-dim hover:text-accent hover:bg-accent-soft cursor-pointer"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>追加到设定文档</span>
              </button>
            )}

            <button
              onClick={handleDelete}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-dim hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
              aria-label="删除此条回复"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
