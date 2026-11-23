import type { StateCreator } from 'zustand';
import type {
  AppSettings,
  Character,
  CharacterRelation,
  ChatMessage,
  ChatMode,
  ChatSession,
  PersonaPreset,
  ProviderConfig,
  SessionUserRelationOverride,
  TimelineEvent,
  UserIdentityRef,
  UserPersona,
  VoiceProfile,
  WorldProject,
} from '../types';
import type { UpdateCheckResult } from '../services/updateChecker';

export type ActiveView = 'chat' | 'worlds';
export type ModalKind = 'none' | 'providers' | 'dataTransfer' | 'settings';
export type ProvidersModalTab = 'llm' | 'image' | 'voice';
export type VoiceStudioSubTab = 'library' | 'create' | 'stt';
export type PendingVoiceBindTarget =
  | { kind: 'character'; characterId: string; characterName: string }
  | { kind: 'persona' }
  | null;

export interface DraftSessionConfig {
  providerId: string;
  model: string;
  chatMode: ChatMode;
  personaPresetId?: string;
  roleCharacterId?: string;
  userIdentity?: UserIdentityRef;
  userRelationOverride?: SessionUserRelationOverride;
  systemPromptOverride?: string;
  worldId?: string;
  enableWorldContext: boolean;
  storyPointEventId?: string;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  secondaryLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onSecondary?: () => Promise<void> | void;
}

export interface ToastItem {
  id: string;
  text: string;
  tone?: 'info' | 'success' | 'error';
}

export interface UiSlice {
  activeView: ActiveView;
  worldStudioMode: 'world' | 'standalone_characters';
  pendingCreateStandaloneChar: boolean;
  activeModal: ModalKind;
  providersModalTab: ProvidersModalTab;
  voiceStudioSubTab: VoiceStudioSubTab;
  pendingVoiceBindTarget: PendingVoiceBindTarget;
  lastCreatedVoiceForTarget: { targetKey: string; profileId: string } | null;
  sidebarOpen: boolean;
  updateNotice: UpdateCheckResult | null;
  speakingMessageId: string | null;
  confirmRequest: ConfirmRequest | null;
  toasts: ToastItem[];

  setActiveView: (v: ActiveView) => void;
  setWorldStudioMode: (mode: 'world' | 'standalone_characters') => void;
  openStandaloneCharacters: (autoCreate?: boolean) => void;
  clearPendingCreateStandaloneChar: () => void;
  setActiveModal: (m: ModalKind) => void;
  setProvidersModalTab: (tab: ProvidersModalTab) => void;
  setVoiceStudioSubTab: (subTab: VoiceStudioSubTab) => void;
  openProvidersModal: (
    tab: ProvidersModalTab,
    opts?: {
      voiceSubTab?: VoiceStudioSubTab;
      bindTarget?: PendingVoiceBindTarget;
    }
  ) => void;
  clearPendingVoiceBind: () => void;
  completePendingVoiceBind: (profileId: string) => Promise<void>;
  clearLastCreatedVoiceForTarget: () => void;
  setSidebarOpen: (open: boolean) => void;
  setUpdateNotice: (u: UpdateCheckResult | null) => void;
  setSpeakingMessageId: (id: string | null) => void;
  showToast: (text: string, tone?: ToastItem['tone']) => void;
  requestConfirm: (req: ConfirmRequest | null) => void;
}

export interface ProvidersSlice {
  providers: ProviderConfig[];
  settings: AppSettings;
  personaPresets: PersonaPreset[];
  voiceProfiles: VoiceProfile[];

  saveProvider: (provider: ProviderConfig) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  upsertPersonaPreset: (preset: PersonaPreset) => Promise<void>;
  deletePersonaPreset: (id: string) => Promise<void>;
  upsertVoiceProfile: (profile: VoiceProfile) => Promise<void>;
  deleteVoiceProfile: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

export interface UserPersonaSlice {
  userPersonas: UserPersona[];
  upsertUserPersona: (persona: UserPersona) => Promise<void>;
  deleteUserPersona: (id: string) => Promise<void>;
  /** 以某张角色卡为底稿新建一份独立身份（复制，不是引用），返回新身份 id */
  createUserPersonaFromCharacter: (characterId: string) => Promise<string | null>;
  /** 按 (AI 角色, 我) 组合键找最近一次会话的关系覆盖，用于新建或切换时继承 */
  inheritUserRelationOverride: (
    roleCharacterId?: string,
    identity?: UserIdentityRef,
    excludeSessionId?: string
  ) => SessionUserRelationOverride | undefined;
}

export interface ChatSlice {
  sessions: ChatSession[];
  activeSessionId: string | null;
  draftConfig: DraftSessionConfig;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingSessionId: string | null;
  streamingAbort: (() => void) | null;
  streamingError: string | null;

  selectSession: (sessionId: string) => Promise<void>;
  startNewDraft: (opts?: {
    worldId?: string;
    storyPointEventId?: string;
    initialPrompt?: string;
    chatMode?: ChatMode;
    personaPresetId?: string;
    roleCharacterId?: string;
    userIdentity?: UserIdentityRef;
    userRelationOverride?: SessionUserRelationOverride;
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
}

export interface WorldSlice {
  worlds: WorldProject[];
  activeWorldId: string | null;
  characters: Character[];
  relations: CharacterRelation[];
  timelineEvents: TimelineEvent[];

  selectWorld: (worldId: string) => Promise<void>;
  createWorld: (data: { name: string; genre: string; document: string }) => Promise<string>;
  updateWorld: (worldId: string, patch: Partial<WorldProject>) => Promise<void>;
  deleteWorld: (worldId: string, opts?: { keepCharacters?: boolean }) => Promise<void>;
  appendWorldImportData: (params: {
    worldId: string;
    document?: string;
    mergeDocument?: boolean;
    characters: Character[];
    events: TimelineEvent[];
    relations: CharacterRelation[];
  }) => Promise<void>;
  upsertCharacter: (char: Character) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  upsertRelation: (rel: CharacterRelation) => Promise<void>;
  deleteRelation: (id: string) => Promise<void>;
  upsertTimelineEvent: (ev: TimelineEvent) => Promise<void>;
  deleteTimelineEvent: (id: string) => Promise<void>;
}

export interface RootSlice {
  initialized: boolean;
  initError: string | null;
  init: () => Promise<void>;
  reloadAll: () => Promise<void>;
}

export type AppState = RootSlice & UiSlice & ProvidersSlice & ChatSlice & WorldSlice & UserPersonaSlice;

export type AppSliceCreator<T> = StateCreator<AppState, [], [], T>;
