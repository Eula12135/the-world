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

export interface MediaProviderCredential {
  baseUrl: string;
  apiKey: string;
  model: string;
  models?: string[];
  defaultVoice?: string;
}

export interface ImageGenConfig {
  enabled: boolean;
  presetId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  styleHint: string;
  providerConfigs?: Record<string, MediaProviderCredential>;
}

export type TtsEngine = 'native' | 'openai_api';
export type SttEngine = 'native' | 'openai_api';

/** 自动朗读的范围：只读角色台词 / 只读我的台词 / 两边都读 */
export type TtsAutoPlayTarget = 'assistant' | 'user' | 'both';

/**
 * 本地语音缓存条目（按「文本 + 音色 / 模型 / 语速 / 语气」哈希寻址）。
 * 存的是合成结果本身，命中即可直接播放，不再请求 TTS 接口。
 */
export interface TtsCacheEntry {
  /** 影响合成结果的参数 + 文本的哈希，见 services/voice/ttsCache.ts */
  key: string;
  /** 不含音色的同源键，用于「换音色后沿用旧语音、不重新消耗额度」 */
  agnosticKey?: string;
  base64: string;
  contentType: string;
  /** 近似占用（base64 字符数），用于容量上限与清理 */
  bytes: number;
  createdAt: number;
  /** LRU 依据：最近一次播放时间 */
  lastUsedAt: number;
  hits: number;
  /** 便于排查：这段缓存对应哪句话 */
  textPreview: string;
  voiceLabel: string;
  /** 所属会话，用于按会话选择性清理 */
  sessionId?: string;
}

export interface VoiceConfig {
  ttsEnabled: boolean;
  ttsAutoPlay: boolean;
  /** 自动朗读只读哪一侧；缺省按 'assistant' 处理，兼容旧数据 */
  ttsAutoPlayTarget?: TtsAutoPlayTarget;
  /**
   * 换音色后是否沿用旧语音缓存。
   * 默认 false（重新合成，声音是对的但要花额度）；开启后省额度但会播出旧音色。
   */
  ttsCacheKeepOldVoice?: boolean;
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
  ttsProviderId?: string;
  ttsProviderConfigs?: Record<string, MediaProviderCredential>;
  activeVoiceProfileId?: string;
  sttEngine: SttEngine;
  sttBaseUrl: string;
  sttApiKey: string;
  sttModel: string;
  sttLanguage: string;
  sttProviderId?: string;
  sttProviderConfigs?: Record<string, MediaProviderCredential>;
}

export interface VoiceProfile {
  id: string;
  name: string;
  providerId?: string;
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
  /** 可选参考音频（idb://media/<id> 引用或内联 data:audio/...），用于角色卡分享与跨账号复刻 */
  sampleAudio?: string;
  /** 提示词捏声线时的原始音色描述配方 */
  designPrompt?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 独立二进制媒体表条目（v11）：将立绘图片与语音样本从角色卡/人设主表剥离，
 * 避免全表加载时把大量大体积 Base64 字符串常驻在主状态树中。
 */
export interface MediaBlobEntry {
  id: string;
  mimeType: string;
  /** 二进制字节（支持原生 Blob/Uint8Array 的环境）或 Base64 兜底 */
  bytes: Uint8Array;
  size: number;
  createdAt: number;
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
  /** 本次对话「我」以谁的身份进入 */
  userIdentity?: UserIdentityRef;
  /** 仅存用户显式改过的关系字段，不是完整关系 */
  userRelationOverride?: SessionUserRelationOverride;
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
  /**
   * 发言时扮演的角色卡 ID（AI 侧；「我」是角色卡时用户侧同样是角色卡 ID）。
   * 与 speakerPersonaId 一同作为「这条消息是新消息」的判据；老消息两者皆空。
   */
  speakerCharacterId?: string;
  /** 发言时「我」使用的自建身份 ID */
  speakerPersonaId?: string;
  /** 发言时的名字冗余：卡片被删除后历史消息仍能显示是谁说的 */
  speakerName?: string;
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

/** 生图取景：头像特写 / 半身立绘 / 横版场景，与「分辨率尺寸」一一对应 */
export type ImageFramingId = 'avatar' | 'halfBody' | 'scene';

export interface Character {
  id: string;
  /** 所属作品 ID；为空字符串 '' 表示不绑定任何作品的独立角色 */
  worldId: string;
  name: string;
  identity: string;
  personality: string;
  status: string;
  relationsNote: string;
  notes: string;
  /** 可选自定义完整系统提示词（适合工具型人设或完全自由发挥的角色） */
  systemPrompt?: string;
  /** 生图取景；不填则跟随「模型 → 生图模型 → 分辨率尺寸」 */
  imageFramingId?: ImageFramingId;
  /** 生图画风预设 id；'none' 表示不指定（完全手写提示词），不填则跟随默认画风 */
  imageStyleId?: string;
  avatarColor: string;
  avatarImage?: string;
  voiceName?: string;
  voiceProfileId?: string;
  /** 与「我」的关系钩子（可选）：AI 扮演该角色时默认怎么称呼用户、默认是什么关系 */
  userRelation?: CharacterUserRelationHook;
  /** 是否置顶角色卡 */
  pinned?: boolean;
  /** 自定义排序权重（越小越靠前） */
  sortOrder?: number;
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

/** 角色卡上的「我」关系钩子：卡作者为该卡预设的默认称呼与默认关系 */
export interface CharacterUserRelationHook {
  /** 默认怎么称呼用户 */
  defaultAddress?: string;
  defaultRelationType?: RelationType;
  defaultRelationLabel?: string;
  defaultRelationDesc?: string;
  /** 用户可以是：他的同门 / 他早年失散的宿敌 */
  slotHint?: string;
}

/** 「我」的身份来源：自建人设，或直接引用一张角色卡 */
export type UserIdentityKind = 'persona' | 'character';

export interface UserIdentityRef {
  kind: UserIdentityKind;
  id: string;
}

/** 自建的「我」。不含默认关系钩子权：那属于角色卡 */
export interface UserPersona {
  id: string;
  name: string;
  /** 角色怎么称呼我；留空表示不指定，交给 AI 角色卡的 defaultAddress 决定 */
  addressAs: string;
  aliases?: string;
  identity: string;
  description: string;
  avatarImage?: string;
  avatarColor: string;
  /** 朗读「我」的台词时使用的音色档案；留空则跟随全局默认声音 */
  voiceProfileId?: string;
  /** 未绑档案时的外部音色 ID 兜底 */
  voiceName?: string;
  /** 从哪张角色卡复制来的，仅作溯源，不是引用 */
  sourceCharacterId?: string;
  createdAt: number;
  updatedAt: number;
}

/** 解析后的「我」：渲染层与提示词层唯一消费的形状，不关心来源 */
export interface ResolvedUserIdentity {
  name: string;
  /** 身份自身提供的称呼，可为空串（表示交给角色卡决定）；「我」是角色卡时恒为空串 */
  addressAs: string;
  aliases?: string;
  identity: string;
  description: string;
  avatarImage?: string;
  avatarColor: string;
  /** 朗读「我」的台词时使用的音色；自建身份取自己的，引用角色卡时取该卡的 */
  voiceProfileId?: string;
  voiceName?: string;
  kind: UserIdentityKind;
  /** 溯源用的源实体 id */
  sourceId: string;
}

/** 会话级「我 × 角色」关系的局部覆盖，只存用户显式改过的字段 */
export interface SessionUserRelationOverride {
  type?: RelationType;
  label?: string;
  description?: string;
  address?: string;
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
      speakWithId?: (
        text: string,
        rate: number,
        pitch: number,
        volume: number,
        utteranceId: string
      ) => void;
      stopSpeaking?: () => void;
      startNativeStt?: (lang: string) => void;
      /** 把 data URL 图片写入系统相册 */
      saveImageToGallery?: (dataUrl: string, filename: string) => void;
      downloadAndInstallApk?: (apkUrl: string) => void;
      exportTextFile?: (filename: string, content: string, mimeType: string) => void;
      exportBinaryFile?: (filename: string, base64Content: string, mimeType: string) => void;
      uploadMultipart?: (reqId: string, jsonSpec: string) => void;
      streamStart?: (reqId: string, jsonSpec: string) => void;
      streamAbort?: (reqId: string) => void;
    };
  }
}
