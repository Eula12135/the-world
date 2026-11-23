import { db, deleteSessionCascade } from '../../db/database';
import type { ChatMessage } from '../../types';
import { buildSessionSystemPrompt } from '../../services/contextBuilder';
import { streamChat } from '../../services/llm';
import { compressConversationMemory } from '../../services/memoryService';
import { speakText, shouldAutoPlaySpeech, stopSpeaking } from '../../services/voiceService';
import { resolveUserIdentity } from '../../services/userIdentity';
import { stripActionsForSpeech } from '../../utils/dialogueParser';
import { createId } from '../../utils/platform';
import { loadSessionContextData, pickDefaultModelConfig } from '../helpers';
import type { AppSliceCreator, ChatSlice, DraftSessionConfig } from '../types';

let selectSessionSeq = 0;
let isSendingLock = false;

// 自动朗读串行队列：先把「我」这句播完，再播角色的回复，避免后一句把前一句打断
let autoPlayChain: Promise<void> = Promise.resolve();
function enqueueAutoPlay(task: () => Promise<void>): void {
  autoPlayChain = autoPlayChain.then(task, task).catch(() => undefined);
}

export const createChatSlice: AppSliceCreator<ChatSlice> = (set, get) => ({
  sessions: [],
  activeSessionId: null,
  draftConfig: {
    providerId: 'deepseek',
    model: 'deepseek-chat',
    chatMode: 'assistant',
    enableWorldContext: false,
  },
  messages: [],
  isStreaming: false,
  streamingSessionId: null,
  streamingAbort: null,
  streamingError: null,

  selectSession: async (sessionId) => {
    const seq = ++selectSessionSeq;
    stopSpeaking();
    const messages = await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
    if (seq !== selectSessionSeq) return;
    set({
      activeSessionId: sessionId,
      messages,
      activeView: 'chat',
      streamingError: null,
      speakingMessageId: null,
    });
  },

  startNewDraft: async (opts) => {
    selectSessionSeq++;
    stopSpeaking();
    const { providers, settings, activeSessionId, sessions } = get();
    const currentSess = sessions.find((s) => s.id === activeSessionId);
    const base = pickDefaultModelConfig(providers, settings.defaultProviderId);
    const nextDraft: DraftSessionConfig = {
      providerId: currentSess?.providerId || base.providerId,
      model: currentSess?.model || base.model,
      chatMode: opts?.chatMode || 'assistant',
      personaPresetId: opts?.personaPresetId,
      roleCharacterId: opts?.roleCharacterId,
      userIdentity: opts?.userIdentity,
      userRelationOverride:
        opts?.userRelationOverride ??
        get().inheritUserRelationOverride(opts?.roleCharacterId, opts?.userIdentity),
      systemPromptOverride: opts?.systemPromptOverride,
      worldId: opts?.worldId,
      enableWorldContext: Boolean(opts?.worldId),
      storyPointEventId: opts?.storyPointEventId,
    };

    set({
      activeSessionId: null,
      draftConfig: nextDraft,
      messages: [],
      activeView: 'chat',
      streamingError: null,
      speakingMessageId: null,
    });

    if (opts?.initialPrompt) {
      await get().sendMessage(opts.initialPrompt);
    }
  },

  updateDraftConfig: (patch) => {
    set((s) => ({ draftConfig: { ...s.draftConfig, ...patch } }));
  },

  updateSession: async (sessionId, patch) => {
    await db.sessions.update(sessionId, { ...patch, updatedAt: patch.updatedAt ?? Date.now() });
    const sessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
    set({ sessions });
  },

  deleteSession: async (sessionId) => {
    selectSessionSeq++;
    if (get().streamingSessionId === sessionId) {
      get().stopStreaming();
    }
    stopSpeaking();
    await deleteSessionCascade(sessionId);
    const sessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
    const nextId =
      get().activeSessionId === sessionId ? sessions[0]?.id ?? null : get().activeSessionId;
    const messages = nextId
      ? await db.messages.where('sessionId').equals(nextId).sortBy('createdAt')
      : [];
    set({ sessions, activeSessionId: nextId, messages, speakingMessageId: null });
  },

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().isStreaming || isSendingLock) return;
    isSendingLock = true;
    stopSpeaking();
    set({ speakingMessageId: null });
    try {
      const now = Date.now();
      let targetSessionId = get().activeSessionId;
      let session = targetSessionId
        ? get().sessions.find((s) => s.id === targetSessionId) ?? null
        : null;

      if (!session) {
        const draft = get().draftConfig;
        targetSessionId = createId('sess');
        session = {
          id: targetSessionId,
          title: trimmed.slice(0, 24),
          pinned: false,
          providerId: draft.providerId,
          model: draft.model,
          chatMode: draft.chatMode,
          personaPresetId: draft.personaPresetId,
          roleCharacterId: draft.roleCharacterId,
          userIdentity: draft.userIdentity,
          userRelationOverride: draft.userRelationOverride,
          systemPromptOverride: draft.systemPromptOverride,
          worldId: draft.worldId,
          enableWorldContext: draft.enableWorldContext,
          storyPointEventId: draft.storyPointEventId,
          createdAt: now,
          updatedAt: now,
        };
        await db.sessions.put(session);
        set({ activeSessionId: targetSessionId });
      }

      const provider =
        get().providers.find((p) => p.id === session!.providerId) || get().providers[0];
      if (!provider) {
        set({ streamingError: '未找到可用的模型厂商配置' });
        return;
      }

      const existingMessages = await db.messages
        .where('sessionId')
        .equals(targetSessionId!)
        .sortBy('createdAt');

      const userMsg: ChatMessage = {
        id: createId('msg'),
        sessionId: targetSessionId!,
        role: 'user',
        content: trimmed,
        createdAt: now,
      };

      const assistantMsg: ChatMessage = {
        id: createId('msg'),
        sessionId: targetSessionId!,
        role: 'assistant',
        content: '',
        reasoning: '',
        createdAt: now + 1,
      };

      await db.messages.bulkPut([userMsg, assistantMsg]);
      // 会话标题在创建时已由首条消息生成，这里只需推进 updatedAt
      await db.sessions.update(targetSessionId!, { updatedAt: now });

      const updatedSessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
      if (get().activeSessionId === targetSessionId) {
        set({ messages: [...existingMessages, userMsg, assistantMsg] });
      }
      set({
        sessions: updatedSessions,
        isStreaming: true,
        streamingSessionId: targetSessionId,
        streamingError: null,
      });

      const voiceCfg = get().settings.voice;
      if (
        shouldAutoPlaySpeech({
          enabled: voiceCfg.ttsEnabled,
          target: voiceCfg.ttsAutoPlayTarget,
          side: 'user',
        })
      ) {
        const identity = resolveUserIdentity(
          session.userIdentity,
          get().userPersonas,
          get().characters
        );
        const userProfileId = identity?.voiceProfileId || voiceCfg.activeVoiceProfileId;
        const userProfile = userProfileId
          ? get().voiceProfiles.find((vp) => vp.id === userProfileId)
          : undefined;
        const userVoiceOverride = userProfile ? undefined : identity?.voiceName;
        const isRoleplaySession =
          session.chatMode === 'character_role' || session.chatMode === 'custom_persona';
        const userSpeechText = isRoleplaySession ? stripActionsForSpeech(trimmed) : trimmed;
        enqueueAutoPlay(async () => {
          set({ speakingMessageId: userMsg.id });
          await speakText({
            text: userSpeechText,
            config: voiceCfg,
            providers: get().providers,
            profile: userProfile,
            voiceOverride: userVoiceOverride,
            sessionId: targetSessionId || undefined,
            onEnd: () => {
              if (get().speakingMessageId === userMsg.id) {
                set({ speakingMessageId: null });
              }
            },
            onError: (msg) => {
              if (get().speakingMessageId === userMsg.id) {
                set({ speakingMessageId: null });
              }
              get().showToast(msg, 'error');
            },
          });
        });
      }

      const { world, ...worldData } = await loadSessionContextData(session);

      // Only send unsummarized recent turns when rollingSummary is active
      const skipCount =
        session.rollingSummary && session.summarizedCount && session.summarizedCount > 0
          ? Math.min(session.summarizedCount, existingMessages.length)
          : 0;
      const recentSlice = existingMessages.slice(skipCount);

      const { prompt: systemPrompt } = buildSessionSystemPrompt({
        settings: get().settings,
        session,
        world,
        characters: worldData.characters,
        relations: worldData.relations,
        events: worldData.timelineEvents,
        personas: get().userPersonas,
        recentMessages: recentSlice,
        draftInput: trimmed,
      });

      const historyForApi = [...recentSlice, userMsg];
      const startedAt = Date.now();

      // 流式过程中每个 token 都写一次 IndexedDB 会产生数千次写事务（手机端明显卡顿）。
      // 这里改成「最多每 400ms 落盘一次最新快照」，结束或中止时再写终值。
      let persistTimer: ReturnType<typeof setTimeout> | null = null;
      let latestSnapshot: { content: string; reasoning?: string } | null = null;
      let latestContent = '';
      let latestReasoning = '';
      let streamSettled = false;

      const cancelPendingPersist = () => {
        if (persistTimer) {
          clearTimeout(persistTimer);
          persistTimer = null;
        }
        latestSnapshot = null;
      };

      const persistThrottled = (snapshot: { content: string; reasoning?: string }) => {
        latestSnapshot = snapshot;
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
          persistTimer = null;
          const snapshotToWrite = latestSnapshot;
          latestSnapshot = null;
          if (snapshotToWrite) {
            db.messages.update(assistantMsg.id, snapshotToWrite).catch(() => {});
          }
        }, 400);
      };

      const rawAbort = streamChat(
        {
          provider,
          model: session.model || provider.selectedModel || provider.models[0],
          systemPrompt,
          history: historyForApi,
          settings: get().settings,
        },
        {
          onDelta: ({ content, reasoning }) => {
            if (streamSettled) return;
            latestContent = content;
            latestReasoning = reasoning;
            if (get().activeSessionId === targetSessionId) {
              set((state) => ({
                messages: state.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content, reasoning: reasoning || undefined }
                    : m
                ),
              }));
            }
            persistThrottled({ content, reasoning: reasoning || undefined });
          },
          onComplete: async ({ content, reasoning }) => {
            if (streamSettled) return;
            streamSettled = true;
            cancelPendingPersist();
            latestContent = content;
            latestReasoning = reasoning;
            const duration = reasoning
              ? Math.round(((Date.now() - startedAt) / 1000) * 10) / 10
              : undefined;
            const finalMsg: ChatMessage = {
              ...assistantMsg,
              content,
              reasoning: reasoning || undefined,
              thinkingDurationSec: duration,
            };
            await db.messages.put(finalMsg);
            await db.sessions.update(targetSessionId!, { updatedAt: Date.now() });
            const freshSessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
            if (get().activeSessionId === targetSessionId) {
              set((state) => ({
                messages: state.messages.map((m) => (m.id === assistantMsg.id ? finalMsg : m)),
              }));
            }
            set({
              isStreaming: false,
              streamingSessionId: null,
              streamingAbort: null,
              sessions: freshSessions,
            });

            const currentSettings = get().settings;
            if (
              shouldAutoPlaySpeech({
                enabled: currentSettings.voice.ttsEnabled,
                target: currentSettings.voice.ttsAutoPlayTarget,
                side: 'assistant',
              }) &&
              content.trim()
            ) {
              const latestSess = freshSessions.find((s) => s.id === targetSessionId);
              const roleChar = latestSess?.roleCharacterId
                ? get().characters.find((c) => c.id === latestSess.roleCharacterId)
                : undefined;
              const preset = latestSess?.personaPresetId
                ? get().personaPresets.find((p) => p.id === latestSess.personaPresetId)
                : undefined;
              const voiceProfileId =
                roleChar?.voiceProfileId ||
                preset?.voiceProfileId ||
                currentSettings.voice.activeVoiceProfileId;
              const voiceProfile = voiceProfileId
                ? get().voiceProfiles.find((vp) => vp.id === voiceProfileId)
                : undefined;
              // 绑定了音色档案时以档案为准；旧的自定义音色 ID 只在没有档案时兜底
              const voiceOverride = voiceProfile
                ? undefined
                : roleChar?.voiceName || preset?.voiceName;
              const isRoleplay = Boolean(
                latestSess?.chatMode === 'character_role' ||
                  latestSess?.chatMode === 'custom_persona' ||
                  roleChar ||
                  preset
              );
              const textToSpeak = isRoleplay ? stripActionsForSpeech(content) : content;
              enqueueAutoPlay(async () => {
                set({ speakingMessageId: finalMsg.id });
                await speakText({
                  text: textToSpeak,
                  config: currentSettings.voice,
                  providers: get().providers,
                  profile: voiceProfile,
                  voiceOverride,
                  sessionId: targetSessionId || undefined,
                  onEnd: () => {
                    if (get().speakingMessageId === finalMsg.id) {
                      set({ speakingMessageId: null });
                    }
                  },
                  onError: (msg) => {
                    if (get().speakingMessageId === finalMsg.id) {
                      set({ speakingMessageId: null });
                    }
                    get().showToast(msg, 'error');
                  },
                });
              });
            }
          },
          onError: async (err) => {
            if (streamSettled) return;
            streamSettled = true;
            cancelPendingPersist();
            if (latestContent.trim() || latestReasoning.trim()) {
              await db.messages
                .update(assistantMsg.id, {
                  content: latestContent,
                  reasoning: latestReasoning || undefined,
                })
                .catch(() => {});
            } else {
              await db.messages.delete(assistantMsg.id).catch(() => {});
              if (get().activeSessionId === targetSessionId) {
                set((state) => ({
                  messages: state.messages.filter((m) => m.id !== assistantMsg.id),
                }));
              }
            }
            set({
              isStreaming: false,
              streamingSessionId: null,
              streamingAbort: null,
              streamingError: err.message,
            });
          },
        }
      );

      const abortHandler = () => {
        if (streamSettled) return;
        streamSettled = true;
        cancelPendingPersist();
        rawAbort();
        if (latestContent.trim() || latestReasoning.trim()) {
          db.messages
            .update(assistantMsg.id, {
              content: latestContent,
              reasoning: latestReasoning || undefined,
            })
            .catch(() => {});
        } else {
          db.messages.delete(assistantMsg.id).catch(() => {});
          if (get().activeSessionId === targetSessionId) {
            set((state) => ({
              messages: state.messages.filter((m) => m.id !== assistantMsg.id),
            }));
          }
        }
      };

      set({ streamingAbort: abortHandler });
    } finally {
      isSendingLock = false;
    }
  },

  stopStreaming: () => {
    const abort = get().streamingAbort;
    if (abort) abort();
    set({ isStreaming: false, streamingSessionId: null, streamingAbort: null });
  },

  regenerateLastAssistant: async () => {
    if (get().isStreaming || isSendingLock) return;
    const msgs = [...get().messages];
    if (msgs.length === 0) return;

    const activeSessId = get().activeSessionId;
    const session = activeSessId ? get().sessions.find((s) => s.id === activeSessId) : undefined;
    const provider = session
      ? get().providers.find((p) => p.id === session.providerId) || get().providers[0]
      : get().providers[0];
    if (!provider) {
      set({ streamingError: '未找到可用的模型厂商配置' });
      return;
    }

    const toDeleteIds: string[] = [];
    const lastIdx = msgs.length - 1;
    let firstDeletedIdx = lastIdx;
    if (msgs[lastIdx].role === 'assistant') {
      const removed = msgs.pop()!;
      toDeleteIds.push(removed.id);
    }
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx === -1) return;
    const lastUser = msgs[lastUserIdx];
    toDeleteIds.push(lastUser.id);
    firstDeletedIdx = lastUserIdx;

    if (get().speakingMessageId && toDeleteIds.includes(get().speakingMessageId!)) {
      stopSpeaking();
      set({ speakingMessageId: null });
    }

    await db.messages.bulkDelete(toDeleteIds);
    const remainingMsgs = msgs.filter((m) => m.id !== lastUser.id);
    if (session && session.summarizedCount && firstDeletedIdx < session.summarizedCount) {
      const nextCount = Math.min(firstDeletedIdx, remainingMsgs.length);
      await get().updateSession(session.id, {
        summarizedCount: nextCount,
        rollingSummary: nextCount === 0 ? undefined : session.rollingSummary,
      });
    }
    set({ messages: remainingMsgs });
    await get().sendMessage(lastUser.content);
  },

  deleteMessage: async (messageId) => {
    if (get().speakingMessageId === messageId) {
      stopSpeaking();
      set({ speakingMessageId: null });
    }
    const msgs = get().messages;
    const idx = msgs.findIndex((m) => m.id === messageId);
    const targetMsg = idx !== -1 ? msgs[idx] : undefined;
    await db.messages.delete(messageId);
    if (targetMsg) {
      const session = get().sessions.find((s) => s.id === targetMsg.sessionId);
      if (session && session.summarizedCount && idx < session.summarizedCount) {
        const nextCount = Math.max(0, session.summarizedCount - 1);
        await get().updateSession(session.id, {
          summarizedCount: nextCount,
          rollingSummary: nextCount === 0 ? undefined : session.rollingSummary,
        });
      }
    }
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== messageId),
    }));
  },

  editAndResend: async (messageId, newContent) => {
    const trimmed = newContent.trim();
    if (!trimmed || get().isStreaming || isSendingLock) return;
    const msgs = get().messages;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    const targetMsg = msgs[idx];
    const session = get().sessions.find((s) => s.id === targetMsg.sessionId);
    const provider = session
      ? get().providers.find((p) => p.id === session.providerId) || get().providers[0]
      : get().providers[0];
    if (!provider) {
      set({ streamingError: '未找到可用的模型厂商配置' });
      return;
    }

    const toDelete = msgs.slice(idx).map((m) => m.id);
    if (get().speakingMessageId && toDelete.includes(get().speakingMessageId!)) {
      stopSpeaking();
      set({ speakingMessageId: null });
    }
    await db.messages.bulkDelete(toDelete);
    if (session && session.summarizedCount && idx < session.summarizedCount) {
      await get().updateSession(session.id, {
        summarizedCount: idx,
        rollingSummary: idx === 0 ? undefined : session.rollingSummary,
      });
    }
    set({ messages: msgs.slice(0, idx) });
    await get().sendMessage(trimmed);
  },

  compressSessionMemory: async (sessionId, keepRecentCount = 6) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const provider =
      get().providers.find((p) => p.id === session.providerId) || get().providers[0];
    if (!provider) throw new Error('未找到可用模型配置');

    const allMsgs = await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
    const prevCount = session.summarizedCount || 0;
    const cutoff = Math.max(prevCount, allMsgs.length - keepRecentCount);
    const toCompress = allMsgs.slice(prevCount, cutoff);
    if (toCompress.length === 0) {
      get().showToast('近期消息较少，暂无需压缩');
      return;
    }

    const summary = await compressConversationMemory({
      provider,
      model: session.model || provider.selectedModel || provider.models[0],
      existingSummary: session.rollingSummary,
      messagesToCompress: toCompress,
    });

    await get().updateSession(sessionId, {
      rollingSummary: summary,
      summarizedCount: cutoff,
    });
    get().showToast(`已浓缩 ${toCompress.length} 条早期消息为前情记忆`, 'success');
  },
});
