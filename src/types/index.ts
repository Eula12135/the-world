export type ProviderProtocol = 'openai' | 'anthropic';

export interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModel: string;
  consoleUrl: string;
  docsUrl: string;
  websiteUrl: string;
  requiresKey: boolean;
  enabled: boolean;
  isCustom: boolean;
}

export type ChatMode = 'assistant' | 'custom_persona' | 'character_role';

export interface PersonaPreset {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  avatarImage?: string;
  avatarColor: string;
  voiceName?: string;
  voiceProfileId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ImageGenConfig {
  enabled: boolean;
  presetId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  styleHint: string;
}

export type TtsEngine = 'native' | 'openai_api';
export type SttEngine = 'native' | 'openai_api';

export interface VoiceConfig {
  ttsEnabled: boolean;
  ttsAutoPlay: boolean;
  ttsEngine: TtsEngine;
  ttsRate: number;
  ttsPitch: number;
  ttsVolume: number;
  ttsGain: number;
  ttsStyleInstruction: string;
  ttsNativeVoice: string;
  ttsBaseUrl: string;
  ttsApiKey: string;
  ttsModel: string;
  ttsVoice: string;
  activeVoiceProfileId?: string;
  sttEngine: SttEngine;
  sttBaseUrl: string;
  sttApiKey: string;
  sttModel: string;
  sttLanguage: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  engine: TtsEngine;
  baseUrl?: string;
  model?: string;
  voiceId: string;
  rate: number;
  pitch: number;
  volume: number;
  gain: number;
  styleInstruction: string;
  isCloned?: boolean;
  sourceText?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  pinned: boolean;
  providerId: string;
  model: string;
  chatMode?: ChatMode;
  personaPresetId?: string;
  roleCharacterId?: string;
  worldId?: string;
  enableWorldContext: boolean;
  storyPointEventId?: string;
  rollingSummary?: string;
  summarizedCount?: number;
  systemPromptOverride?: string;
  importedFrom?: 'deepseek' | 'backup';
  sourceId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  thinkingDurationSec?: number;
  warningNote?: string;
  searchQueries?: string[];
  tokenUsage?: number;
  createdAt: number;
}

export type WorldContextMode = 'progressive' | 'full';

export interface WorldProject {
  id: string;
  name: string;
  genre: string;
  document: string;
  contextMode: WorldContextMode;
  pinnedSections: string[];
  selectedSections: string[];
  includeCharacters: boolean;
  includeTimeline: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Character {
  id: string;
  worldId: string;
  name: string;
  identity: string;
  personality: string;
  status: string;
  relationsNote: string;
  notes: string;
  avatarColor: string;
  avatarImage?: string;
  voiceName?: string;
  voiceProfileId?: string;
  posX?: number;
  posY?: number;
  updatedAt: number;
}

export type RelationType =
  | 'friend'
  | 'ally'
  | 'family'
  | 'mentor'
  | 'romance'
  | 'hierarchy'
  | 'rival'
  | 'hostile'
  | 'secret'
  | 'custom';

export interface RelationPhase {
  id: string;
  fromEventId?: string;
  type: RelationType;
  label: string;
  strength: 1 | 2 | 3;
  description: string;
}

export interface CharacterRelation {
  id: string;
  worldId: string;
  sourceId: string;
  targetId: string;
  directed: boolean;
  phases: RelationPhase[];
  updatedAt: number;
}

export interface TimelineEvent {
  id: string;
  worldId: string;
  timeLabel: string;
  title: string;
  details: string;
  characterIds: string[];
  orderIndex: number;
  updatedAt: number;
}

export type ThemeMode = 'system' | 'dark' | 'light';

export interface AppSettings {
  id: 'global';
  theme: ThemeMode;
  temperature: number;
  topP: number;
  maxTokens: number;
  contextMessagesLimit: number;
  maxWorldContextChars: number;
  globalSystemPrompt: string;
  defaultProviderId: string;
  updateRepo: string;
  autoCheckUpdates: boolean;
  /** 用户选择「忽略此版本」时记录的版本号；只对它完全相等的新版本生效 */
  ignoredVersion?: string;
  imageGen: ImageGenConfig;
  voice: VoiceConfig;
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  openExternal: (url: string) => Promise<boolean>;
  isEncryptionAvailable: () => Promise<boolean>;
  encryptSecret: (plain: string) => Promise<string>;
  decryptSecret: (stored: string) => Promise<string>;
  fetchJson: (params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{ ok: boolean; status: number; text: string }>;
  fetchBinary: (params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{ ok: boolean; status: number; contentType: string; base64: string; errorText: string }>;
  uploadMultipart: (params: {
    url: string;
    headers?: Record<string, string>;
    fields: Record<string, string>;
    fileField: string;
    fileName: string;
    fileMime: string;
    fileBase64: string;
  }) => Promise<{ ok: boolean; status: number; text: string }>;
  streamStart: (params: {
    reqId: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  }) => Promise<void>;
  streamAbort: (reqId: string) => Promise<void>;
  onStreamEvent: (
    reqId: string,
    handler: (ev: {
      type: 'chunk' | 'done' | 'error';
      data?: string;
      status?: number;
      message?: string;
    }) => void
  ) => () => void;
}

declare global {
  interface Window {
    theWorldDesktop?: DesktopBridge;
    TheWorldAndroid?: {
      setTheme: (isDark: boolean) => void;
      speak?: (text: string, rate: number, pitch?: number) => void;
      stopSpeaking?: () => void;
      startNativeStt?: (lang: string) => void;
      downloadAndInstallApk?: (apkUrl: string) => void;
    };
  }
}
