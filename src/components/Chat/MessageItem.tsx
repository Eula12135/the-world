import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShallow } from 'zustand/react/shallow';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  BookmarkPlus,
  Edit3,
  Globe,
  RefreshCw,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { Character, ChatMessage, PersonaPreset, ResolvedUserIdentity } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { isVoiceSetupMissing, speakText, stopSpeaking } from '../../services/voiceService';
import { parseRoleplayContent, stripActionsForSpeech } from '../../utils/dialogueParser';
import { hasSpeakerSnapshot, resolveSpeakerDisplay } from '../../utils/speakerSnapshot';
import { openExternalUrl } from '../../utils/platform';

interface MessageItemProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  sessionWorldId?: string;
  isSessionStreaming: boolean;
  roleCharacter?: Character;
  personaPreset?: PersonaPreset;
  /** 当前会话里「我」的身份；未设定时为 null，用户气泡保持原样 */
  userIdentity?: ResolvedUserIdentity | null;
  /** 「我」被称呼的名字（已按 override → 身份 → 角色卡 → 名字 解析过） */
  userLabel?: string;
  /** 未带入上下文的早期消息条数，仅最后一条助手消息显示提示 */
  omittedCount?: number;
}

export const MessageItem: React.FC<MessageItemProps> = React.memo(({
  message,
  isLastAssistant,
  sessionWorldId,
  isSessionStreaming,
  roleCharacter,
  personaPreset,
  userIdentity,
  userLabel,
  omittedCount = 0,
}) => {
  const {
    regenerateLastAssistant,
    deleteMessage,
    editAndResend,
    worlds,
    updateWorld,
    voiceSettings,
    providers,
    voiceProfiles,
    isSpeaking,
    setSpeakingMessageId,
    showToast,
    requestConfirm,
    contextTokens,
    requestWorldPopover,
    characters,
    userPersonas,
  } = useAppStore(
    useShallow((s) => ({
      regenerateLastAssistant: s.regenerateLastAssistant,
      deleteMessage: s.deleteMessage,
      editAndResend: s.editAndResend,
      worlds: s.worlds,
      updateWorld: s.updateWorld,
      voiceSettings: s.settings.voice,
      providers: s.providers,
      voiceProfiles: s.voiceProfiles,
      isSpeaking: s.speakingMessageId === message.id,
      setSpeakingMessageId: s.setSpeakingMessageId,
      showToast: s.showToast,
      requestConfirm: s.requestConfirm,
      contextTokens: s.contextTokens,
      requestWorldPopover: s.requestWorldPopover,
      characters: s.characters,
      userPersonas: s.userPersonas,
    }))
  );

  const [copied, setCopied] = useState(false);
  const [thinkOpen, setThinkOpen] = useState(false);
  const [userActionsOpen, setUserActionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftEdit, setDraftEdit] = useState(message.content);

  const isUser = message.role === 'user';

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
    const voiceProfileId =
      roleCharacter?.voiceProfileId ||
      personaPreset?.voiceProfileId ||
      voiceSettings.activeVoiceProfileId;
    const voiceProfile = voiceProfileId
      ? voiceProfiles.find((vp) => vp.id === voiceProfileId)
      : undefined;
    // 绑定了音色档案时以档案为准；只有在没有档案时才用旧的自定义音色 ID 兜底，
    // 否则角色卡上残留的 voiceName 会盖掉用户精心调好的档案。
    const roleVoiceOverride = voiceProfile
      ? undefined
      : roleCharacter?.voiceName || personaPreset?.voiceName;

    // 没有角色音色、也没有全局默认时不要静默借用别人的声音，直接提示去配置
    if (
      isVoiceSetupMissing({
        engine: voiceSettings.ttsEngine,
        profileId: voiceProfileId,
        voiceOverride: roleVoiceOverride,
      })
    ) {
      setSpeakingMessageId(null);
      showToast(
        '这个角色还没有配置声音：给角色卡绑定音色，或在 设置 → 声音 里指定一个全局默认声音',
        'error'
      );
      return;
    }

    const isRoleplay = Boolean(roleCharacter || personaPreset);
    const textToSpeak = isRoleplay ? stripActionsForSpeech(message.content) : message.content;
    await speakText({
      text: textToSpeak,
      config: voiceSettings,
      providers,
      profile: voiceProfile,
      sessionId: message.sessionId,
      voiceOverride: roleVoiceOverride,
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

  // 「我」自己的台词：用我扮演的这个角色（或自建身份）的音色朗读。
  // 双卡对戏时两边都能听——AI 用它的声音，我用我这张卡的声音。
  const handleSpeakUserToggle = async () => {
    if (isSpeaking) {
      stopSpeaking();
      setSpeakingMessageId(null);
      return;
    }
    setSpeakingMessageId(message.id);
    const profileId = userIdentity?.voiceProfileId || voiceSettings.activeVoiceProfileId;
    const profile = profileId ? voiceProfiles.find((vp) => vp.id === profileId) : undefined;
    const userVoiceOverride = profile ? undefined : userIdentity?.voiceName;
    if (
      isVoiceSetupMissing({
        engine: voiceSettings.ttsEngine,
        profileId,
        voiceOverride: userVoiceOverride,
      })
    ) {
      setSpeakingMessageId(null);
      showToast(
        '「我」还没有配置声音：给身份绑定音色，或在 设置 → 声音 里指定一个全局默认声音',
        'error'
      );
      return;
    }
    // 角色扮演时「我」的消息也可能带（动作描写），朗读前同样要剥掉
    const isRoleplay = Boolean(roleCharacter || personaPreset || userIdentity);
    await speakText({
      text: isRoleplay ? stripActionsForSpeech(message.content) : message.content,
      config: voiceSettings,
      providers,
      profile,
      sessionId: message.sessionId,
      voiceOverride: userVoiceOverride,
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
    const display = resolveSpeakerDisplay(
      message,
      { characters, personas: userPersonas },
      {
        name: (userLabel || userIdentity?.name || '').trim(),
        image: userIdentity?.avatarImage,
        color: userIdentity?.avatarColor,
      }
    );
    // 有无括号动作由解析器判断，无需区分会话模式
    const userRoleplay = message.content ? parseRoleplayContent(message.content) : null;
    const userAvatarImg = display.image;
    const userDisplayName = display.name.trim();
    const showUserIdentity = Boolean(userDisplayName) && (hasSpeakerSnapshot(message) || Boolean(userIdentity));
    return (
      <div className="flex justify-end gap-2.5">
        <div className="max-w-[85%] md:max-w-[75%] space-y-1.5">
          {showUserIdentity && (
            <div className="text-caption font-medium text-secondary text-right">
              {userDisplayName}
            </div>
          )}
          {editing ? (
            <div className="p-3 rounded-xl bg-card border border-accent space-y-2 min-w-[260px]">
              <textarea
                value={draftEdit}
                onChange={(e) => setDraftEdit(e.target.value)}
                rows={4}
                className="w-full bg-transparent text-read text-ink outline-none resize-y"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="px-3 py-1 rounded-lg text-body border border-line text-secondary cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1 rounded-lg text-body bg-accent text-white cursor-pointer"
                >
                  重新发送
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => setUserActionsOpen((v) => !v)}
              className="px-4 py-2.5 rounded-xl rounded-tr-sm bg-user-bubble text-read leading-relaxed text-ink break-words cursor-pointer"
              title="点击展开操作菜单"
            >
              {/* 和 AI 侧共用的视觉语言：动作/语气词用斜体弱化，正文保持正体 */}
              {userRoleplay && (userRoleplay.hasActions || userRoleplay.hasTones) ? (
                <div className="space-y-1">
                  {userRoleplay.blocks.map((block, idx) =>
                    block.kind === 'action' ? (
                      <p key={idx} className="text-body italic text-secondary whitespace-pre-wrap">
                        {block.text}
                      </p>
                    ) : (
                      <p key={idx} className="whitespace-pre-wrap">
                        {block.segments.map((seg, sIdx) =>
                          seg.kind === 'tone' ? (
                            <span key={sIdx} className="italic text-accent/85">
                              {seg.text}
                            </span>
                          ) : (
                            <React.Fragment key={sIdx}>{seg.text}</React.Fragment>
                          )
                        )}
                      </p>
                    )
                  )}
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{message.content}</span>
              )}
            </div>
          )}

          {userActionsOpen && !editing && (
            <div className="flex justify-end gap-1">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-body text-dim hover:text-ink hover:bg-hover cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>复制</span>
              </button>
              {voiceSettings.ttsEnabled && message.content && showUserIdentity && (
                <button
                  onClick={handleSpeakUserToggle}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-body cursor-pointer ${
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
              <button
                onClick={() => {
                  setDraftEdit(message.content);
                  setEditing(true);
                  setUserActionsOpen(false);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-body text-dim hover:text-ink hover:bg-hover cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>编辑重发</span>
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-body text-dim hover:text-danger hover:bg-danger/10 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除</span>
              </button>
            </div>
          )}
        </div>
        {showUserIdentity &&
          (userAvatarImg ? (
            <img
              src={userAvatarImg}
              alt={userDisplayName}
              className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5 border border-line"
            />
          ) : (
            <div
              className="w-7 h-7 rounded-full shrink-0 text-white text-xs font-bold flex items-center justify-center mt-0.5"
              style={{ backgroundColor: display.color || 'var(--accent)' }}
            >
              {userDisplayName.slice(0, 1)}
            </div>
          ))}
      </div>
    );
  }

  const aiDisplay = resolveSpeakerDisplay(
    message,
    { characters, personas: userPersonas },
    {
      name: roleCharacter?.name || personaPreset?.name,
      image: roleCharacter?.avatarImage || personaPreset?.avatarImage,
      color: roleCharacter?.avatarColor || personaPreset?.avatarColor,
    }
  );
  const avatarImg = aiDisplay.image;
  const avatarLabel = aiDisplay.name;
  const avatarColor = aiDisplay.color || 'var(--accent)';
  const roleplayParsed =
    aiDisplay.known && message.content
      ? parseRoleplayContent(message.content)
      : null;
  const useRoleplayView = Boolean(
    roleplayParsed && (roleplayParsed.hasActions || roleplayParsed.hasTones)
  );

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
          <div className="text-caption font-medium text-secondary -mb-1">{avatarLabel}</div>
        )}

        {message.searchQueries && message.searchQueries.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-body text-dim">
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
              className="flex items-center gap-1.5 text-body font-medium text-dim hover:text-secondary cursor-pointer"
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
              <div className="mt-1.5 text-body leading-relaxed text-secondary whitespace-pre-wrap">
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        {message.content ? (
          useRoleplayView && roleplayParsed ? (
            <div className="space-y-1.5">
              {roleplayParsed.blocks.map((block, idx) =>
                block.kind === 'action' ? (
                  <div
                    key={idx}
                    className="my-1.5 pl-3 border-l-2 border-line text-[13.5px] leading-relaxed text-dim italic"
                  >
                    {block.text}
                  </div>
                ) : (
                  <p key={idx} className="text-read leading-relaxed text-ink whitespace-pre-wrap">
                    {block.segments.map((seg, sIdx) =>
                      seg.kind === 'tone' ? (
                        <span key={sIdx} className="text-body text-accent/85 italic mx-0.5">
                          {seg.text}
                        </span>
                      ) : (
                        <React.Fragment key={sIdx}>{seg.text}</React.Fragment>
                      )
                    )}
                  </p>
                )
              )}
            </div>
          ) : (
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) => (/^(https?:|mailto:)/i.test(url) ? url : '')}
                components={{
                  a: ({ href, children, ...props }) => {
                    const safeHref = href && /^(https?:|mailto:)/i.test(href) ? href : undefined;
                    if (!safeHref) return <span>{children}</span>;
                    return (
                      <a
                        {...props}
                        href={safeHref}
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          openExternalUrl(safeHref).catch(() => {});
                        }}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )
        ) : (
          isSessionStreaming &&
          isLastAssistant && (
            <div className="flex items-center gap-2 text-body text-dim">
              <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span>正在思考与生成...</span>
            </div>
          )
        )}

        {message.warningNote && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 text-amber-500 text-body">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{message.warningNote}</span>
          </div>
        )}

        {(!isSessionStreaming || !isLastAssistant) && (
          <div className="flex items-center gap-4 pt-0.5 text-caption text-dim">
            <button
              onClick={handleCopy}
              title={copied ? '已复制' : '复制'}
              aria-label="复制"
              className="hover:text-ink cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>

            {isLastAssistant && (
              <button
                onClick={regenerateLastAssistant}
                title="重新生成"
                aria-label="重新生成"
                className="hover:text-ink cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            {voiceSettings.ttsEnabled && message.content && (
              <button
                onClick={handleSpeakToggle}
                title={isSpeaking ? '停止朗读' : '朗读'}
                aria-label={isSpeaking ? '停止朗读' : '朗读'}
                className={`cursor-pointer ${isSpeaking ? 'text-accent-strong' : 'hover:text-ink'}`}
              >
                {isSpeaking ? (
                  <Square className="w-4 h-4 fill-current" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
            )}

            {sessionWorldId && message.content && (
              <button
                onClick={handleAppendToWorld}
                title="存为设定：把这条回复追加到作品设定文档"
                aria-label="存为设定"
                className="hover:text-ink cursor-pointer"
              >
                <BookmarkPlus className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={handleDelete}
              title="删除"
              aria-label="删除此条回复"
              className="text-danger hover:opacity-80 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {isLastAssistant && (contextTokens || omittedCount > 0) ? (
              <div className="ml-auto flex items-center gap-2 tabular-nums">
                {contextTokens ? <span>{contextTokens} tokens</span> : null}
                {omittedCount > 0 ? (
                  <button
                    onClick={() => requestWorldPopover('memory')}
                    title="这些早期消息没有带进本次上下文，点开查看前情摘要"
                    className="underline decoration-dotted underline-offset-2 hover:text-ink cursor-pointer"
                  >
                    · 早期 {omittedCount} 条未带入
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
});
