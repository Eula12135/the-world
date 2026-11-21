import { create } from 'zustand';
import {
  db,
  DEFAULT_SETTINGS,
  deleteCharacterCascade,
  deleteSessionCascade,
  deleteTimelineEventCascade,
  deleteWorldCascade,
  ensureDatabaseInitialized,
  loadProvidersDecrypted,
  loadSettingsDecrypted,
  saveProviderEncrypted,
  saveSettingsEncrypted,
} from '../db/database';
import type {
  AppSettings,
  Character,
  CharacterRelation,
  ChatMessage,
  ChatMode,
  ChatSession,
  PersonaPreset,
  ProviderConfig,
  TimelineEvent,
  VoiceProfile,
  WorldProject,
} from '../types';
import { buildSessionSystemPrompt } from '../services/contextBuilder';
import { streamChat } from '../services/llm';
import { compressConversationMemory } from '../services/memoryService';
import type { UpdateCheckResult } from '../services/updateChecker';
import { speakText, stopSpeaking } from '../services/voiceService';
import { createId } from '../utils/platform';

export type ActiveView = 'chat' | 'worlds';
export type ModalKind = 'none' | 'providers' | 'dataTransfer' | 'settings';

export interface DraftSessionConfig {
  providerId: string;
  model: string;
  chatMode: ChatMode;
  personaPresetId?: string;
  roleCharacterId?: string;
  systemPromptOverride?: string;
  worldId?: string;
  enableWorldContext: boolean;
  storyPointEventId?: string;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}

export interface ToastItem {
  id: string;
  text: string;
  tone?: 'info' | 'success' | 'error';
}

interface AppState {
  initialized: boolean;
  activeView: ActiveView;
  activeModal: ModalKind;
  sidebarOpen: boolean;

  providers: ProviderConfig[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  draftConfig: DraftSessionConfig;
  messages: ChatMessage[];

  worlds: WorldProject[];
  activeWorldId: string | null;
  characters: Character[];
  relations: CharacterRelation[];
  timelineEvents: TimelineEvent[];

  settings: AppSettings;
  personaPresets: PersonaPreset[];
  voiceProfiles: VoiceProfile[];
  updateNotice: UpdateCheckResult | null;

  isStreaming: boolean;
  streamingSessionId: string | null;
  streamingAbort: (() => void) | null;
  streamingError: string | null;
  speakingMessageId: string | null;

  confirmRequest: ConfirmRequest | null;
  toasts: ToastItem[];

  // Actions
  init: () => Promise<void>;
  setActiveView: (v: ActiveView) => void;
  setActiveModal: (m: ModalKind) => void;
  setSidebarOpen: (open: boolean) => void;
  setUpdateNotice: (u: UpdateCheckResult | null) => void;
  setSpeakingMessageId: (id: string | null) => void;
  showToast: (text: string, tone?: ToastItem['tone']) => void;
  requestConfirm: (req: ConfirmRequest | null) => void;

  // Providers & Persona Presets
  saveProvider: (provider: ProviderConfig) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  upsertPersonaPreset: (preset: PersonaPreset) => Promise<void>;
  deletePersonaPreset: (id: string) => Promise<void>;
  upsertVoiceProfile: (profile: VoiceProfile) => Promise<void>;
  deleteVoiceProfile: (id: string) => Promise<void>;

  // Sessions & Chat
  selectSession: (sessionId: string) => Promise<void>;
  startNewDraft: (opts?: {
    worldId?: string;
    storyPointEventId?: string;
    initialPrompt?: string;
    chatMode?: ChatMode;
    personaPresetId?: string;
    roleCharacterId?: string;
    systemPromptOverride?: string;
  }) => Promise<void>;
  updateDraftConfig: (patch: Partial<DraftSessionConfig>) => void;
  updateSession: (sessionId: string, patch: Partial<ChatSession>) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  stopStreaming: () => void;
  regenerateLastAssistant: () => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  editAndResend: (messageId: string, newContent: string) => Promise<void>;
  compressSessionMemory: (sessionId: string, keepRecentCount?: number) => Promise<void>;

  // Worlds
  selectWorld: (worldId: string) => Promise<void>;
  createWorld: (data: { name: string; genre: string; document: string }) => Promise<string>;
  updateWorld: (worldId: string, patch: Partial<WorldProject>) => Promise<void>;
  deleteWorld: (worldId: string) => Promise<void>;
  appendWorldImportData: (params: {
    worldId: string;
    document?: string;
    mergeDocument?: boolean;
    characters: Character[];
    events: TimelineEvent[];
    relations: CharacterRelation[];
  }) => Promise<void>;

  // Characters & Relations & Timeline
  upsertCharacter: (char: Character) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  upsertRelation: (rel: CharacterRelation) => Promise<void>;
  deleteRelation: (id: string) => Promise<void>;
  upsertTimelineEvent: (ev: TimelineEvent) => Promise<void>;
  deleteTimelineEvent: (id: string) => Promise<void>;

  // Settings & Refresh
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  reloadAll: () => Promise<void>;
}

async function loadWorldChildren(_worldId?: string | null) {
  const [characters, relations, timelineEvents] = await Promise.all([
    db.characters.toArray(),
    db.relations.toArray(),
    db.timelineEvents.orderBy('orderIndex').toArray(),
  ]);
  return { characters, relations, timelineEvents };
}

function pickDefaultModelConfig(
  providers: ProviderConfig[],
  defaultProviderId: string
): DraftSessionConfig {
  const ready =
    providers.find((p) => p.enabled && p.requiresKey && p.apiKey.trim().length > 0) ||
    providers.find((p) => p.id === defaultProviderId) ||
    providers[0];
  return {
    providerId: ready?.id || 'deepseek',
    model: ready?.selectedModel || ready?.models[0] || 'deepseek-chat',
    chatMode: 'assistant',
    worldId: undefined,
    enableWorldContext: false,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  activeView: 'chat',
  activeModal: 'none',
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,

  providers: [],
  sessions: [],
  activeSessionId: null,
  draftConfig: {
    providerId: 'deepseek',
    model: 'deepseek-chat',
    chatMode: 'assistant',
    enableWorldContext: false,
  },
  messages: [],

  worlds: [],
  activeWorldId: null,
  characters: [],
  relations: [],
  timelineEvents: [],

  settings: DEFAULT_SETTINGS,
  personaPresets: [],
  voiceProfiles: [],
  updateNotice: null,

  isStreaming: false,
  streamingSessionId: null,
  streamingAbort: null,
  streamingError: null,
  speakingMessageId: null,

  confirmRequest: null,
  toasts: [],

  init: async () => {
    await ensureDatabaseInitialized();
    await get().reloadAll();
    set({ initialized: true });
  },

  reloadAll: async () => {
    const [
      providers,
      sessions,
      worlds,
      resolvedSettings,
      personaPresets,
      voiceProfiles,
      worldData,
    ] = await Promise.all([
      loadProvidersDecrypted(),
      db.sessions.orderBy('updatedAt').reverse().toArray(),
      db.worlds.orderBy('updatedAt').reverse().toArray(),
      loadSettingsDecrypted(),
      db.personaPresets.orderBy('updatedAt').reverse().toArray(),
      db.voiceProfiles.orderBy('updatedAt').reverse().toArray(),
      loadWorldChildren(null),
    ]);

    const currentSessionId = get().activeSessionId;
    const nextSessionId =
      currentSessionId && sessions.some((s) => s.id === currentSessionId)
        ? currentSessionId
        : sessions[0]?.id ?? null;

    const messages = nextSessionId
      ? await db.messages.where('sessionId').equals(nextSessionId).sortBy('createdAt')
      : [];

    const currentWorldId = get().activeWorldId;
    const nextWorldId =
      currentWorldId && worlds.some((w) => w.id === currentWorldId)
        ? currentWorldId
        : worlds[0]?.id ?? null;

    set({
      providers,
      sessions,
      activeSessionId: nextSessionId,
      draftConfig: pickDefaultModelConfig(providers, resolvedSettings.defaultProviderId),
      messages,
      worlds,
      activeWorldId: nextWorldId,
      ...worldData,
      settings: resolvedSettings,
      personaPresets,
      voiceProfiles,
    });
  },

  setActiveView: (v) => set({ activeView: v }),
  setActiveModal: (m) => set({ activeModal: m }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setUpdateNotice: (u) => set({ updateNotice: u }),
  setSpeakingMessageId: (id) => set({ speakingMessageId: id }),

  showToast: (text, tone = 'info') => {
    const id = createId('toast');
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 2400);
  },

  requestConfirm: (req) => set({ confirmRequest: req }),

  saveProvider: async (provider) => {
    await saveProviderEncrypted(provider);
    const providers = await loadProvidersDecrypted();
    set({ providers });
  },

  deleteProvider: async (id) => {
    await db.providers.delete(id);
    const providers = await loadProvidersDecrypted();
    set({ providers });
  },

  upsertPersonaPreset: async (preset) => {
    await db.personaPresets.put(preset);
    const personaPresets = await db.personaPresets.orderBy('updatedAt').reverse().toArray();
    set({ personaPresets });
  },

  deletePersonaPreset: async (id) => {
    await db.personaPresets.delete(id);
    const personaPresets = await db.personaPresets.orderBy('updatedAt').reverse().toArray();
    set({ personaPresets });
  },

  upsertVoiceProfile: async (profile) => {
    await db.voiceProfiles.put(profile);
    const voiceProfiles = await db.voiceProfiles.orderBy('updatedAt').reverse().toArray();
    set({ voiceProfiles });
  },

  deleteVoiceProfile: async (id) => {
    await db.transaction(
      'rw',
      [db.voiceProfiles, db.characters, db.personaPresets],
      async () => {
        await db.voiceProfiles.delete(id);
        await db.characters.toCollection().modify((c) => {
          if (c.voiceProfileId === id) c.voiceProfileId = undefined;
        });
        await db.personaPresets.toCollection().modify((p) => {
          if (p.voiceProfileId === id) p.voiceProfileId = undefined;
        });
      }
    );
    const [voiceProfiles, characters, personaPresets] = await Promise.all([
      db.voiceProfiles.orderBy('updatedAt').reverse().toArray(),
      db.characters.toArray(),
      db.personaPresets.orderBy('updatedAt').reverse().toArray(),
    ]);
    set({ voiceProfiles, characters, personaPresets });
    if (get().settings.voice.activeVoiceProfileId === id) {
      await get().updateSettings({
        voice: { ...get().settings.voice, activeVoiceProfileId: undefined },
      });
    }
  },

  selectSession: async (sessionId) => {
    stopSpeaking();
    const messages = await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
    set({
      activeSessionId: sessionId,
      messages,
      activeView: 'chat',
      streamingError: null,
      speakingMessageId: null,
    });
  },

  startNewDraft: async (opts) => {
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
    if (!trimmed || get().isStreaming) return;

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

    let world: WorldProject | null = null;
    const needsWorldData =
      (session.enableWorldContext && session.worldId) ||
      session.chatMode === 'character_role';
    let worldData = {
      characters: [] as Character[],
      relations: [] as CharacterRelation[],
      timelineEvents: [] as TimelineEvent[],
    };
    if (needsWorldData) {
      let targetWid = session.worldId;
      if (!targetWid && session.roleCharacterId) {
        const roleChar = await db.characters.get(session.roleCharacterId);
        if (roleChar) targetWid = roleChar.worldId;
      }
      if (targetWid) {
        world = (await db.worlds.get(targetWid)) ?? null;
        const [wChars, wRels, wEvents] = await Promise.all([
          db.characters.where('worldId').equals(targetWid).toArray(),
          db.relations.where('worldId').equals(targetWid).toArray(),
          db.timelineEvents.where('worldId').equals(targetWid).sortBy('orderIndex'),
        ]);
        worldData = { characters: wChars, relations: wRels, timelineEvents: wEvents };
      }
    }

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
      recentMessages: recentSlice,
      draftInput: trimmed,
    });

    const historyForApi = [...recentSlice, userMsg];
    const startedAt = Date.now();

    // 流式过程中每个 token 都写一次 IndexedDB 会产生数千次写事务（手机端明显卡顿）。
    // 这里改成「最多每 400ms 落盘一次最新快照」，结束时再写终值。
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    let latestSnapshot: { content: string; reasoning?: string } | null = null;

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

    const abort = streamChat(
      {
        provider,
        model: session.model || provider.selectedModel || provider.models[0],
        systemPrompt,
        history: historyForApi,
        settings: get().settings,
      },
      {
        onDelta: ({ content, reasoning }) => {
          if (get().activeSessionId === targetSessionId) {
            set((state) => ({
              messages: state.messages.map((m) =>
                m.id === assistantMsg.id ? { ...m, content, reasoning: reasoning || undefined } : m
              ),
            }));
          }
          persistThrottled({ content, reasoning: reasoning || undefined });
        },
        onComplete: async ({ content, reasoning }) => {
          cancelPendingPersist();
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
          if (currentSettings.voice.ttsEnabled && currentSettings.voice.ttsAutoPlay && content.trim()) {
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
            const voiceOverride = roleChar?.voiceName || preset?.voiceName;
            set({ speakingMessageId: finalMsg.id });
            speakText({
              text: content,
              config: currentSettings.voice,
              providers: get().providers,
              profile: voiceProfile,
              voiceOverride,
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
          }
        },
        onError: async (err) => {
          cancelPendingPersist();
          const latest = await db.messages.get(assistantMsg.id);
          if (latest && !latest.content && !latest.reasoning) {
            await db.messages.delete(assistantMsg.id);
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

    set({ streamingAbort: abort });
  },

  stopStreaming: () => {
    const abort = get().streamingAbort;
    if (abort) abort();
    set({ isStreaming: false, streamingSessionId: null, streamingAbort: null });
  },

  regenerateLastAssistant: async () => {
    if (get().isStreaming) return;
    const msgs = [...get().messages];
    if (msgs.length === 0) return;

    if (msgs[msgs.length - 1].role === 'assistant') {
      const removed = msgs.pop()!;
      await db.messages.delete(removed.id);
    }
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;

    await db.messages.delete(lastUser.id);
    set({ messages: msgs.filter((m) => m.id !== lastUser.id) });
    await get().sendMessage(lastUser.content);
  },

  deleteMessage: async (messageId) => {
    await db.messages.delete(messageId);
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== messageId),
    }));
  },

  editAndResend: async (messageId, newContent) => {
    if (get().isStreaming) return;
    const msgs = get().messages;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const toDelete = msgs.slice(idx).map((m) => m.id);
    await db.messages.bulkDelete(toDelete);
    set({ messages: msgs.slice(0, idx) });
    await get().sendMessage(newContent);
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

  selectWorld: async (worldId) => {
    set({ activeWorldId: worldId });
  },

  createWorld: async (data) => {
    const now = Date.now();
    const world: WorldProject = {
      id: createId('world'),
      name: data.name.trim(),
      genre: data.genre,
      document: data.document,
      contextMode: 'progressive',
      pinnedSections: [],
      selectedSections: [],
      includeCharacters: true,
      includeTimeline: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.worlds.put(world);
    const worlds = await db.worlds.orderBy('updatedAt').reverse().toArray();
    set({
      worlds,
      activeWorldId: world.id,
    });
    return world.id;
  },

  updateWorld: async (worldId, patch) => {
    await db.worlds.update(worldId, { ...patch, updatedAt: Date.now() });
    const worlds = await db.worlds.orderBy('updatedAt').reverse().toArray();
    set({ worlds });
  },

  deleteWorld: async (worldId) => {
    await deleteWorldCascade(worldId);
    const worlds = await db.worlds.orderBy('updatedAt').reverse().toArray();
    const nextWorldId =
      get().activeWorldId === worldId ? worlds[0]?.id ?? null : get().activeWorldId;
    const worldData = await loadWorldChildren(nextWorldId);
    const sessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
    set({ worlds, activeWorldId: nextWorldId, sessions, ...worldData });
  },

  appendWorldImportData: async ({
    worldId,
    document,
    mergeDocument,
    characters,
    events,
    relations,
  }) => {
    await db.transaction(
      'rw',
      [db.worlds, db.characters, db.timelineEvents, db.relations],
      async () => {
        const w = await db.worlds.get(worldId);
        if (w && document !== undefined) {
          const nextDoc = mergeDocument && w.document.trim()
            ? `${w.document.trimEnd()}\n\n${document.trim()}`
            : document;
          await db.worlds.update(worldId, { document: nextDoc, updatedAt: Date.now() });
        }
        if (characters.length > 0) await db.characters.bulkPut(characters);
        if (events.length > 0) await db.timelineEvents.bulkPut(events);
        if (relations.length > 0) await db.relations.bulkPut(relations);
      }
    );
    const [worlds, data] = await Promise.all([
      db.worlds.orderBy('updatedAt').reverse().toArray(),
      loadWorldChildren(worldId),
    ]);
    set({ worlds, activeWorldId: worldId, ...data });
  },

  upsertCharacter: async (char) => {
    await db.characters.put(char);
    await db.worlds.update(char.worldId, { updatedAt: Date.now() });
    const characters = await db.characters.toArray();
    set({ characters });
  },

  deleteCharacter: async (id) => {
    await deleteCharacterCascade(id);
    const [data, sessions] = await Promise.all([
      loadWorldChildren(null),
      db.sessions.orderBy('updatedAt').reverse().toArray(),
    ]);
    set({ ...data, sessions });
  },

  upsertRelation: async (rel) => {
    await db.relations.put(rel);
    await db.worlds.update(rel.worldId, { updatedAt: Date.now() });
    const relations = await db.relations.toArray();
    set({ relations });
  },

  deleteRelation: async (id) => {
    await db.relations.delete(id);
    const relations = await db.relations.toArray();
    set({ relations });
  },

  upsertTimelineEvent: async (ev) => {
    await db.timelineEvents.put(ev);
    await db.worlds.update(ev.worldId, { updatedAt: Date.now() });
    const timelineEvents = await db.timelineEvents.orderBy('orderIndex').toArray();
    set({ timelineEvents });
  },

  deleteTimelineEvent: async (id) => {
    await deleteTimelineEventCascade(id);
    const data = await loadWorldChildren(null);
    set(data);
  },

  updateSettings: async (patch) => {
    const prev = get().settings;
    const next: AppSettings = {
      ...prev,
      ...patch,
      id: 'global' as const,
      imageGen: patch.imageGen ? { ...prev.imageGen, ...patch.imageGen } : prev.imageGen,
      voice: patch.voice ? { ...prev.voice, ...patch.voice } : prev.voice,
    };
    await saveSettingsEncrypted(next);
    set({ settings: next });
  },
}));
