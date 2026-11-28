import { db, deleteSessionCascade } from '../../db/database';
import type { ChatMessage } from '../../types';
import { buildSessionSystemPrompt } from '../../services/contextBuilder';
import { streamChat } from '../../services/llm';
import { compressConversationMemory } from '../../services/memoryService';
import { isVoiceSetupMissing, shouldAutoPlaySpeech, speakText, stopSpeaking } from '../../services/voiceService';
import { resolveUserIdentity } from '../../services/userIdentity';
import { stripActionsForSpeech } from '../../utils/dialogueParser';
import { buildSpeakerSnapshot, hasSpeakerSnapshot } from '../../utils/speakerSnapshot';
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

/**
 * 切换角色 / 身份时，把「旧发言人」冻结进该会话里还没有快照的消息。
 *
 * 只在切换发生的那一刻冻结：用切换前的 session 值，而不是全局回填 ——
 * 全局回填会把「中途切过角色」的会话固化成错误数据。
 */
async function freezeSpeakersBeforeSwitch(deps: {
  get: () => {
    characters: Array<{ id: string; name: string }>;
    userPersonas: Array<{ id: string; name: string }>;
    messages: ChatMessage[];
    activeSessionId: string | null;
  };
  set: (fn: (state: { messages: ChatMessage[] }) => { messages: ChatMessage[] }) => void;
  sessionId: string;
  patch: { roleCharacterId?: string; userIdentity?: { kind: 'character' | 'persona'; id: string } };
}) {
  const { get, set, sessionId, patch } = deps;
  const session = await db.sessions.get(sessionId);
  if (!session) return;

  const roleChanged =
    patch.roleCharacterId !== undefined && patch.roleCharacterId !== session.roleCharacterId;
  const identityChanged =
    patch.userIdentity !== undefined &&
    `${patch.userIdentity?.kind ?? ''}:${patch.userIdentity?.id ?? ''}` !==
      `${session.userIdentity?.kind ?? ''}:${session.userIdentity?.id ?? ''}`;
  if (!roleChanged && !identityChanged) return;

  const msgs = await db.messages.where('sessionId').equals(sessionId).toArray();
  const chars = get().characters;
  const personas = get().userPersonas;

  // 推断「这些没有快照的老消息当时是谁在说」：
  // 优先用会话里最近一条带快照的同类消息（更新后生成的），它比 session 当前值更接近事实。
  // 例如：老消息全是 A，装了新版后切到 B 说了几句，此时老消息应冻结成 A 而不是 B。
  const lastAssistantSnapshot = [...msgs]
    .reverse()
    .find((m) => m.role === 'assistant' && m.speakerCharacterId)?.speakerCharacterId;
  const lastUserSnapshot = [...msgs]
    .reverse()
    .find((m) => m.role === 'user' && (m.speakerCharacterId || m.speakerPersonaId));

  const inferredRoleId = lastAssistantSnapshot ?? session.roleCharacterId;
  const oldRoleChar = inferredRoleId ? chars.find((c) => c.id === inferredRoleId) : undefined;

  const identity = session.userIdentity;
  const inferredIdentityCharId =
    lastUserSnapshot?.speakerCharacterId ??
    (identity?.kind === 'character' ? identity.id : undefined);
  const inferredIdentityPersonaId =
    lastUserSnapshot?.speakerPersonaId ?? (identity?.kind === 'persona' ? identity.id : undefined);
  const oldIdentityChar = inferredIdentityCharId
    ? chars.find((c) => c.id === inferredIdentityCharId)
    : undefined;
  const oldIdentityPersona = inferredIdentityPersonaId
    ? personas.find((p) => p.id === inferredIdentityPersonaId)
    : undefined;

  const updated: ChatMessage[] = [];
  for (const m of msgs) {
    if (hasSpeakerSnapshot(m)) continue;
    if (m.role === 'assistant' && roleChanged) {
      updated.push(
        oldRoleChar
          ? { ...m, speakerCharacterId: oldRoleChar.id, speakerName: oldRoleChar.name }
          : { ...m, speakerFrozen: true }
      );
    } else if (m.role === 'user' && identityChanged) {
      if (oldIdentityChar) {
        updated.push({ ...m, speakerCharacterId: oldIdentityChar.id, speakerName: oldIdentityChar.name });
      } else if (oldIdentityPersona) {
        updated.push({ ...m, speakerPersonaId: oldIdentityPersona.id, speakerName: oldIdentityPersona.name });
      } else {
        updated.push({ ...m, speakerFrozen: true });
      }
    }
  }

  if (updated.length === 0) return;
  await db.messages.bulkPut(updated);

  if (get().activeSessionId === sessionId) {
    const byId = new Map(updated.map((m) => [m.id, m]));
    set((state) => ({ messages: state.messages.map((m) => byId.get(m.id) ?? m) }));
  }
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
    // 切换扮演角色 / 「我」的身份之前，先把旧值冻结进历史消息。
    // 否则老消息没有快照，会按回退链显示成新角色，等于篡改历史。
    await freezeSpeakersBeforeSwitch({ get, set, sessionId, patch });
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

  // reuseLastUser：复用已存在的最后一条用户消息（重新生成时用），不新建、不重播用户语音
  sendMessage: async (text, options) => {
    const reuseLastUser = Boolean(options?.reuseLastUser);
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

      // 重新生成时不新建用户消息：保留原时间戳与发言人快照，也避免把这句话再朗读一遍
      const reusedUserMsg = reuseLastUser
        ? [...existingMessages].reverse().find((m) => m.role === 'user')
        : undefined;

      const userMsg: ChatMessage =
        reusedUserMsg ??
        ({
          id: createId('msg'),
          sessionId: targetSessionId!,
          role: 'user',
          content: trimmed,
          createdAt: now,
          ...buildSpeakerSnapshot({
            role: 'user',
            userIdentity: session!.userIdentity,
            characters: get().characters,
            personas: get().userPersonas,
          }),
        } as ChatMessage);

      const assistantMsg: ChatMessage = {
        id: createId('msg'),
        sessionId: targetSessionId!,
        role: 'assistant',
        content: '',
        reasoning: '',
        createdAt: now + 1,
        ...buildSpeakerSnapshot({
          role: 'assistant',
          roleCharacter: session!.roleCharacterId
            ? get().characters.find((c) => c.id === session!.roleCharacterId)
            : undefined,
          characters: get().characters,
          personas: get().userPersonas,
        }),
      };

      if (reusedUserMsg) {
        await db.messages.put(assistantMsg);
      } else {
        await db.messages.bulkPut([userMsg, assistantMsg]);
      }
      // 会话标题在创建时已由首条消息生成，这里只需推进 updatedAt
      await db.sessions.update(targetSessionId!, { updatedAt: now });

      const updatedSessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
      if (get().activeSessionId === targetSessionId) {
        set({
          messages: reusedUserMsg
            ? [...existingMessages, assistantMsg]
            : [...existingMessages, userMsg, assistantMsg],
        });
      }
      set({
        sessions: updatedSessions,
        isStreaming: true,
        streamingSessionId: targetSessionId,
        streamingError: null,
      });

      const voiceCfg = get().settings.voice;
      if (
        !reusedUserMsg &&
        shouldAutoPlaySpeech({
          enabled: voiceCfg.ttsEnabled,
          autoPlay: voiceCfg.ttsAutoPlay,
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
        // 没有可用声音时不自动朗读；用户手动点「朗读」时会看到配置提示
        if (
          !isVoiceSetupMissing({
            engine: voiceCfg.ttsEngine,
            profileId: userProfileId,
            voiceOverride: userVoiceOverride,
          })
        ) {
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

      // 复用用户消息时 recentSlice 里已经包含它，不能再追加一次
      const historyForApi = reusedUserMsg && recentSlice.some((m) => m.id === userMsg.id)
        ? [...recentSlice]
        : [...recentSlice, userMsg];
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
                autoPlay: currentSettings.voice.ttsAutoPlay,
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
              // 无可用声音时不自动朗读，避免静默借用别人的音色
              if (
                !isVoiceSetupMissing({
                  engine: currentSettings.voice.ttsEngine,
                  profileId: voiceProfileId,
                  voiceOverride,
                })
              ) {
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

    const last = msgs[msgs.length - 1];
    // 只删最后一条助手消息；用户消息原样保留（时间戳、发言人快照都不动），
    // 因此不会再「重念」用户刚说过的那句话
    if (last.role === 'assistant') {
      if (get().speakingMessageId === last.id) {
        stopSpeaking();
        set({ speakingMessageId: null });
      }
      await db.messages.delete(last.id);
      const deletedIdx = msgs.length - 1;
      if (session && session.summarizedCount && deletedIdx < session.summarizedCount) {
        await get().updateSession(session.id, {
          summarizedCount: Math.max(0, session.summarizedCount - 1),
        });
      }
      msgs.pop();
      set({ messages: [...msgs] });
    }

    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;

    await get().sendMessage(lastUser.content, { reuseLastUser: true });
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

    let summary: string;
    try {
      summary = await compressConversationMemory({
        provider,
        model: session.model || provider.selectedModel || provider.models[0],
        existingSummary: session.rollingSummary,
        messagesToCompress: toCompress,
      });
    } catch (err) {
      // 压缩失败时保留原前情：绝不能把空摘要写回去
      const msg = err instanceof Error ? err.message : '记忆压缩失败';
      get().showToast(msg, 'error');
      return;
    }

    await get().updateSession(sessionId, {
      rollingSummary: summary,
      summarizedCount: cutoff,
    });
    get().showToast(`已浓缩 ${toCompress.length} 条早期消息为前情记忆`, 'success');
  },
});
