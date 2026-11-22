import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  Character,
  CharacterRelation,
  ChatMessage,
  ChatSession,
  ImageGenConfig,
  MediaProviderCredential,
  PersonaPreset,
  ProviderConfig,
  TimelineEvent,
  VoiceConfig,
  VoiceProfile,
  WorldProject,
} from '../types';
import { BUILTIN_PROVIDERS, DEFAULT_GLOBAL_SYSTEM_PROMPT } from '../data/providers';
import { DEFAULT_UPDATE_SOURCE } from '../services/updateChecker';

export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  enabled: true,
  presetId: 'zhipu',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',
  model: 'cogview-3-flash',
  size: '1024x1024',
  styleHint: '',
  providerConfigs: {},
};

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  ttsEnabled: true,
  ttsAutoPlay: false,
  ttsEngine: 'native',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  ttsGain: 0,
  ttsStyleInstruction: '',
  ttsNativeVoice: '',
  ttsBaseUrl: 'https://api.siliconflow.cn/v1',
  ttsApiKey: '',
  ttsModel: 'FunAudioLLM/CosyVoice2-0.5B',
  ttsVoice: 'FunAudioLLM/CosyVoice2-0.5B:anna',
  ttsProviderId: 'native',
  ttsProviderConfigs: {},
  sttEngine: 'native',
  sttBaseUrl: 'https://api.siliconflow.cn/v1',
  sttApiKey: '',
  sttModel: 'FunAudioLLM/SenseVoiceSmall',
  sttLanguage: 'zh',
  sttProviderId: 'native',
  sttProviderConfigs: {},
};

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'global',
  theme: 'dark',
  temperature: 0.75,
  topP: 0.95,
  maxTokens: 4096,
  contextMessagesLimit: 20,
  maxWorldContextChars: 100000,
  globalSystemPrompt: DEFAULT_GLOBAL_SYSTEM_PROMPT,
  defaultProviderId: 'deepseek',
  updateRepo: DEFAULT_UPDATE_SOURCE,
  autoCheckUpdates: true,
  imageGen: { ...DEFAULT_IMAGE_GEN_CONFIG },
  voice: { ...DEFAULT_VOICE_CONFIG },
};

export class TheWorldDatabase extends Dexie {
  providers!: Table<ProviderConfig, string>;
  sessions!: Table<ChatSession, string>;
  messages!: Table<ChatMessage, string>;
  worlds!: Table<WorldProject, string>;
  characters!: Table<Character, string>;
  relations!: Table<CharacterRelation, string>;
  timelineEvents!: Table<TimelineEvent, string>;
  personaPresets!: Table<PersonaPreset, string>;
  voiceProfiles!: Table<VoiceProfile, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super('the_world_db');
    this.version(1).stores({
      providers: 'id, enabled, isCustom',
      sessions: 'id, updatedAt, pinned, worldId, sourceId',
      messages: 'id, sessionId, createdAt, [sessionId+createdAt]',
      worlds: 'id, updatedAt',
      worldEntries: 'id, worldId, category, injectionMode, updatedAt',
      characters: 'id, worldId, roleType, injectionMode, updatedAt',
      relations: 'id, worldId, sourceId, targetId, type',
      timelineEvents: 'id, worldId, orderIndex, era, plotLane',
      settings: 'id',
    });

    this.version(2)
      .stores({
        providers: 'id, enabled, isCustom',
        sessions: 'id, updatedAt, pinned, worldId, sourceId',
        messages: 'id, sessionId, createdAt, [sessionId+createdAt]',
        worlds: 'id, updatedAt',
        worldEntries: null,
        characters: 'id, worldId, updatedAt',
        relations: null,
        timelineEvents: 'id, worldId, orderIndex',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        const oldEntries = await tx.table('worldEntries').toArray().catch(() => []);
        const oldRelations = await tx.table('relations').toArray().catch(() => []);
        const oldChars = await tx.table('characters').toArray().catch(() => []);
        const oldWorlds = await tx.table('worlds').toArray().catch(() => []);
        const charNameMap = new Map<string, string>(
          oldChars.map((c: { id: string; name: string }) => [c.id, c.name])
        );

        for (const w of oldWorlds) {
          if (typeof w.document === 'string') continue;
          const entries = oldEntries.filter((e: { worldId: string }) => e.worldId === w.id);
          const parts: string[] = [];
          if (w.synopsis) parts.push(`## 一、作品概要\n${w.synopsis}`);
          if (w.calendarNote) parts.push(`## 二、历法说明\n${w.calendarNote}`);
          if (w.styleGuide) parts.push(`## 三、文风要求\n${w.styleGuide}`);
          for (const e of entries) {
            parts.push(`## ${e.title}\n${e.content || e.summary || ''}`);
          }
          await tx.table('worlds').put({
            id: w.id,
            name: w.name,
            genre: w.genre || '其他',
            document: parts.join('\n\n') || '## 一、世界设定\n\n',
            contextMode: 'progressive',
            pinnedSections: [],
            selectedSections: [],
            includeCharacters: true,
            includeTimeline: true,
            createdAt: w.createdAt || Date.now(),
            updatedAt: w.updatedAt || Date.now(),
          });
        }

        for (const c of oldChars) {
          if ('identity' in c) continue;
          const rels = oldRelations
            .filter((r: { sourceId: string; targetId: string }) => r.sourceId === c.id || r.targetId === c.id)
            .map((r: { sourceId: string; targetId: string; label?: string; type?: string; description?: string }) => {
              const otherId = r.sourceId === c.id ? r.targetId : r.sourceId;
              const other = charNameMap.get(otherId) || '他人';
              return `与${other}：${r.label || r.type || '关联'}${r.description ? `（${r.description}）` : ''}`;
            })
            .join('；');
          const notes = [c.appearance && `外貌：${c.appearance}`, c.background && `背景：${c.background}`, c.motivation && `动机：${c.motivation}`, c.notes]
            .filter(Boolean)
            .join('\n');
          await tx.table('characters').put({
            id: c.id,
            worldId: c.worldId,
            name: c.name,
            identity: c.faction || '',
            personality: c.personality || '',
            status: c.currentState || '',
            relationsNote: rels,
            notes,
            avatarColor: c.avatarColor || '#4d6bfe',
            updatedAt: c.updatedAt || Date.now(),
          });
        }

        await tx
          .table('timelineEvents')
          .toCollection()
          .modify((ev: Record<string, unknown>) => {
            if (!('details' in ev)) {
              ev.details = [ev.era && `[${ev.era}]`, ev.summary, ev.impact && `影响：${ev.impact}`]
                .filter(Boolean)
                .join(' ');
              delete ev.era;
              delete ev.plotLane;
              delete ev.summary;
              delete ev.impact;
              delete ev.locationEntryId;
              delete ev.causeEventId;
              delete ev.status;
            }
          });
      });

    this.version(3)
      .stores({
        providers: 'id, enabled, isCustom',
        sessions: 'id, updatedAt, pinned, worldId, sourceId',
        messages: 'id, sessionId, createdAt, [sessionId+createdAt]',
        worlds: 'id, updatedAt',
        characters: 'id, worldId, updatedAt',
        relations: 'id, worldId, sourceId, targetId',
        timelineEvents: 'id, worldId, orderIndex',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('worlds')
          .toCollection()
          .modify((w: Record<string, unknown>) => {
            if (!w.contextMode) w.contextMode = 'progressive';
            if (!Array.isArray(w.pinnedSections)) w.pinnedSections = [];
          });
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (typeof s.updateRepo !== 'string') s.updateRepo = '';
            if (typeof s.autoCheckUpdates !== 'boolean') s.autoCheckUpdates = true;
          });
      });

    this.version(4)
      .stores({
        providers: 'id, enabled, isCustom',
        sessions: 'id, updatedAt, pinned, worldId, sourceId',
        messages: 'id, sessionId, createdAt, [sessionId+createdAt]',
        worlds: 'id, updatedAt',
        characters: 'id, worldId, updatedAt',
        relations: 'id, worldId, sourceId, targetId',
        timelineEvents: 'id, worldId, orderIndex',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.maxWorldContextChars === 12000) {
              s.maxWorldContextChars = 100000;
            }
            if ((!s.updateRepo || s.updateRepo === '') && DEFAULT_UPDATE_SOURCE) {
              s.updateRepo = DEFAULT_UPDATE_SOURCE;
            }
          });
      });

    this.version(5)
      .stores({
        providers: 'id, enabled, isCustom',
        sessions: 'id, updatedAt, pinned, worldId, sourceId',
        messages: 'id, sessionId, createdAt, [sessionId+createdAt]',
        worlds: 'id, updatedAt',
        characters: 'id, worldId, updatedAt',
        relations: 'id, worldId, sourceId, targetId',
        timelineEvents: 'id, worldId, orderIndex',
        personaPresets: 'id, updatedAt',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            s.imageGen = {
              ...DEFAULT_IMAGE_GEN_CONFIG,
              ...((s.imageGen as Record<string, unknown>) || {}),
            };
            s.voice = {
              ...DEFAULT_VOICE_CONFIG,
              ...((s.voice as Record<string, unknown>) || {}),
            };
          });
      });

    this.version(6)
      .stores({
        providers: 'id, enabled, isCustom',
        sessions: 'id, updatedAt, pinned, worldId, sourceId',
        messages: 'id, sessionId, createdAt, [sessionId+createdAt]',
        worlds: 'id, updatedAt',
        characters: 'id, worldId, updatedAt',
        relations: 'id, worldId, sourceId, targetId',
        timelineEvents: 'id, worldId, orderIndex',
        personaPresets: 'id, updatedAt',
        voiceProfiles: 'id, updatedAt',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            s.voice = {
              ...DEFAULT_VOICE_CONFIG,
              ...((s.voice as Record<string, unknown>) || {}),
            };
          });
      });

    this.version(7)
      .stores({
        providers: 'id, enabled, isCustom',
        sessions: 'id, updatedAt, pinned, worldId, sourceId',
        messages: 'id, sessionId, createdAt, [sessionId+createdAt]',
        worlds: 'id, updatedAt',
        characters: 'id, worldId, updatedAt',
        relations: 'id, worldId, sourceId, targetId',
        timelineEvents: 'id, worldId, orderIndex',
        personaPresets: 'id, updatedAt',
        voiceProfiles: 'id, updatedAt',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        const oldPresets = await tx.table('personaPresets').toArray().catch(() => []);
        if (oldPresets.length === 0) return;

        const migratedIds = new Set<string>();
        for (const p of oldPresets as PersonaPreset[]) {
          const existingChar = await tx.table('characters').get(p.id);
          if (!existingChar) {
            await tx.table('characters').put({
              id: p.id,
              worldId: '',
              name: p.name || '未命名人设',
              identity: p.description || '',
              personality: '',
              status: '',
              relationsNote: '',
              notes: '',
              systemPrompt: p.systemPrompt || '',
              avatarImage: p.avatarImage,
              avatarColor: p.avatarColor || '#4d6bfe',
              voiceName: p.voiceName,
              voiceProfileId: p.voiceProfileId,
              updatedAt: p.updatedAt || Date.now(),
            } satisfies Character);
          }
          migratedIds.add(p.id);
        }

        await tx
          .table('sessions')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (
              s.chatMode === 'custom_persona' &&
              typeof s.personaPresetId === 'string' &&
              migratedIds.has(s.personaPresetId)
            ) {
              s.chatMode = 'character_role';
              s.roleCharacterId = s.personaPresetId;
              s.personaPresetId = undefined;
            }
          });
      });
  }
}

export const db = new TheWorldDatabase();

function cloneProviderConfigsMap(
  rawMap?: Record<string, MediaProviderCredential>
): Record<string, MediaProviderCredential> {
  const out: Record<string, MediaProviderCredential> = {};
  if (!rawMap || typeof rawMap !== 'object') return out;
  for (const [id, entry] of Object.entries(rawMap)) {
    if (!entry || typeof entry !== 'object') continue;
    out[id] = {
      baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : '',
      apiKey: typeof entry.apiKey === 'string' ? entry.apiKey : '',
      model: typeof entry.model === 'string' ? entry.model : '',
      models: Array.isArray(entry.models)
        ? entry.models.filter((m): m is string => typeof m === 'string' && m.length > 0)
        : undefined,
      defaultVoice: typeof entry.defaultVoice === 'string' ? entry.defaultVoice : undefined,
    };
  }
  return out;
}

export function inferTtsProviderIdFromBaseUrl(baseUrl: string, engine?: string): string {
  if (engine === 'native') return 'native';
  const b = (baseUrl || '').trim().toLowerCase();
  if (/api\.breeze\.blue|breezeblue\.ai/.test(b)) return 'breeze';
  if (b.includes('siliconflow')) return 'siliconflow_tts';
  if (b.includes('fish.audio')) return 'fish_audio';
  if (b.includes('minimaxi')) return 'minimax_tts';
  if (b.includes('elevenlabs')) return 'elevenlabs_tts';
  if (b.includes('dashscope')) return 'dashscope_tts';
  if (b.includes('api.openai.com')) return 'openai_tts';
  return 'custom_tts';
}

export function inferSttProviderIdFromBaseUrl(baseUrl: string, engine?: string): string {
  if (engine === 'native') return 'native';
  const b = (baseUrl || '').trim().toLowerCase();
  if (b.includes('siliconflow')) return 'siliconflow_stt';
  if (b.includes('groq.com')) return 'groq_stt';
  if (b.includes('api.openai.com')) return 'openai_stt';
  return 'custom_stt';
}

export function normalizeSettings(raw?: Partial<AppSettings> | null): AppSettings {
  const mergedImageGen: ImageGenConfig = {
    ...DEFAULT_IMAGE_GEN_CONFIG,
    ...(raw?.imageGen || {}),
  };
  const imgPresetId = mergedImageGen.presetId || DEFAULT_IMAGE_GEN_CONFIG.presetId;
  const imgConfigs = cloneProviderConfigsMap(raw?.imageGen?.providerConfigs);
  if (
    !imgConfigs[imgPresetId] &&
    (mergedImageGen.apiKey || mergedImageGen.baseUrl || mergedImageGen.model)
  ) {
    imgConfigs[imgPresetId] = {
      baseUrl: mergedImageGen.baseUrl,
      apiKey: mergedImageGen.apiKey,
      model: mergedImageGen.model,
    };
  }
  mergedImageGen.providerConfigs = imgConfigs;

  const mergedVoice: VoiceConfig = {
    ...DEFAULT_VOICE_CONFIG,
    ...(raw?.voice || {}),
  };
  const ttsProviderId =
    raw?.voice?.ttsProviderId ||
    inferTtsProviderIdFromBaseUrl(mergedVoice.ttsBaseUrl, mergedVoice.ttsEngine);
  const ttsConfigs = cloneProviderConfigsMap(raw?.voice?.ttsProviderConfigs);
  if (mergedVoice.ttsEngine === 'openai_api' && !ttsConfigs[ttsProviderId]) {
    ttsConfigs[ttsProviderId] = {
      baseUrl: mergedVoice.ttsBaseUrl,
      apiKey: mergedVoice.ttsApiKey,
      model: mergedVoice.ttsModel,
      defaultVoice: mergedVoice.ttsVoice,
    };
  }
  mergedVoice.ttsProviderId = ttsProviderId;
  mergedVoice.ttsProviderConfigs = ttsConfigs;

  const sttProviderId =
    raw?.voice?.sttProviderId ||
    inferSttProviderIdFromBaseUrl(mergedVoice.sttBaseUrl, mergedVoice.sttEngine);
  const sttConfigs = cloneProviderConfigsMap(raw?.voice?.sttProviderConfigs);
  if (mergedVoice.sttEngine === 'openai_api' && !sttConfigs[sttProviderId]) {
    sttConfigs[sttProviderId] = {
      baseUrl: mergedVoice.sttBaseUrl,
      apiKey: mergedVoice.sttApiKey,
      model: mergedVoice.sttModel,
    };
  }
  mergedVoice.sttProviderId = sttProviderId;
  mergedVoice.sttProviderConfigs = sttConfigs;

  return {
    ...DEFAULT_SETTINGS,
    ...(raw || {}),
    id: 'global',
    imageGen: mergedImageGen,
    voice: mergedVoice,
  };
}

export async function encryptKeyIfDesktop(plain: string): Promise<string> {
  if (!plain || plain.startsWith('enc:')) return plain;
  if (typeof window !== 'undefined' && window.theWorldDesktop?.encryptSecret) {
    try {
      return await window.theWorldDesktop.encryptSecret(plain);
    } catch {
      return plain;
    }
  }
  return plain;
}

export async function decryptKeyIfDesktop(stored: string): Promise<string> {
  if (!stored || !stored.startsWith('enc:')) return stored;
  if (typeof window !== 'undefined' && window.theWorldDesktop?.decryptSecret) {
    try {
      return await window.theWorldDesktop.decryptSecret(stored);
    } catch {
      return '';
    }
  }
  return '';
}

async function transformProviderConfigsKeys(
  configs: Record<string, MediaProviderCredential> | undefined,
  fn: (val: string) => Promise<string>
): Promise<Record<string, MediaProviderCredential>> {
  const out: Record<string, MediaProviderCredential> = {};
  if (!configs) return out;
  const entries = await Promise.all(
    Object.entries(configs).map(async ([k, v]) => [k, { ...v, apiKey: await fn(v.apiKey) }] as const)
  );
  for (const [k, v] of entries) {
    out[k] = v;
  }
  return out;
}

export async function prepareProviderForStorage(provider: ProviderConfig): Promise<ProviderConfig> {
  const encryptedKey = await encryptKeyIfDesktop(provider.apiKey);
  return { ...provider, apiKey: encryptedKey };
}

export async function saveProviderEncrypted(provider: ProviderConfig): Promise<void> {
  await db.providers.put(await prepareProviderForStorage(provider));
}

export async function loadProvidersDecrypted(): Promise<ProviderConfig[]> {
  const list = await db.providers.toArray();
  return Promise.all(
    list.map(async (p) => ({
      ...p,
      apiKey: await decryptKeyIfDesktop(p.apiKey),
    }))
  );
}

export async function prepareSettingsForStorage(settings: AppSettings): Promise<AppSettings> {
  const normalized = normalizeSettings(settings);
  const [imgKey, ttsKey, sttKey, imgMap, ttsMap, sttMap] = await Promise.all([
    encryptKeyIfDesktop(normalized.imageGen.apiKey),
    encryptKeyIfDesktop(normalized.voice.ttsApiKey),
    encryptKeyIfDesktop(normalized.voice.sttApiKey),
    transformProviderConfigsKeys(normalized.imageGen.providerConfigs, encryptKeyIfDesktop),
    transformProviderConfigsKeys(normalized.voice.ttsProviderConfigs, encryptKeyIfDesktop),
    transformProviderConfigsKeys(normalized.voice.sttProviderConfigs, encryptKeyIfDesktop),
  ]);
  return {
    ...normalized,
    imageGen: { ...normalized.imageGen, apiKey: imgKey, providerConfigs: imgMap },
    voice: {
      ...normalized.voice,
      ttsApiKey: ttsKey,
      sttApiKey: sttKey,
      ttsProviderConfigs: ttsMap,
      sttProviderConfigs: sttMap,
    },
  };
}

export async function saveSettingsEncrypted(settings: AppSettings): Promise<void> {
  await db.settings.put(await prepareSettingsForStorage(settings));
}

export async function loadSettingsDecrypted(): Promise<AppSettings> {
  const stored = await db.settings.get('global');
  const normalized = normalizeSettings(stored);
  const [imgKey, ttsKey, sttKey, imgMap, ttsMap, sttMap] = await Promise.all([
    decryptKeyIfDesktop(normalized.imageGen.apiKey),
    decryptKeyIfDesktop(normalized.voice.ttsApiKey),
    decryptKeyIfDesktop(normalized.voice.sttApiKey),
    transformProviderConfigsKeys(normalized.imageGen.providerConfigs, decryptKeyIfDesktop),
    transformProviderConfigsKeys(normalized.voice.ttsProviderConfigs, decryptKeyIfDesktop),
    transformProviderConfigsKeys(normalized.voice.sttProviderConfigs, decryptKeyIfDesktop),
  ]);
  return {
    ...normalized,
    imageGen: { ...normalized.imageGen, apiKey: imgKey, providerConfigs: imgMap },
    voice: {
      ...normalized.voice,
      ttsApiKey: ttsKey,
      sttApiKey: sttKey,
      ttsProviderConfigs: ttsMap,
      sttProviderConfigs: sttMap,
    },
  };
}

export async function ensureDatabaseInitialized(): Promise<void> {
  const existingProviders = await db.providers.count();
  if (existingProviders === 0) {
    await db.providers.bulkPut(BUILTIN_PROVIDERS);
  } else {
    const existingIds = new Set((await db.providers.toArray()).map((p) => p.id));
    const missing = BUILTIN_PROVIDERS.filter((p) => !existingIds.has(p.id));
    if (missing.length > 0) {
      await db.providers.bulkPut(missing);
    }
  }

  const existingSettings = await db.settings.get('global');
  if (!existingSettings) {
    await saveSettingsEncrypted(DEFAULT_SETTINGS);
  } else if (!existingSettings.imageGen || !existingSettings.voice) {
    await db.settings.put(normalizeSettings(existingSettings));
  }
}

export async function deleteSessionCascade(sessionId: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.messages, async () => {
    await db.messages.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

export async function deleteWorldCascade(
  worldId: string,
  options?: { keepCharacters?: boolean }
): Promise<void> {
  const keepChars = Boolean(options?.keepCharacters);
  await db.transaction(
    'rw',
    [db.worlds, db.characters, db.relations, db.timelineEvents, db.sessions],
    async () => {
      if (keepChars) {
        await db.characters
          .where('worldId')
          .equals(worldId)
          .modify((c) => {
            c.worldId = '';
            c.updatedAt = Date.now();
          });
      } else {
        await db.characters.where('worldId').equals(worldId).delete();
      }
      await db.relations.where('worldId').equals(worldId).delete();
      await db.timelineEvents.where('worldId').equals(worldId).delete();
      await db.sessions
        .where('worldId')
        .equals(worldId)
        .modify((s) => {
          s.worldId = undefined;
          s.enableWorldContext = false;
          s.storyPointEventId = undefined;
          if (!keepChars && s.chatMode === 'character_role') {
            s.chatMode = 'assistant';
            s.roleCharacterId = undefined;
          }
        });
      await db.worlds.delete(worldId);
    }
  );
}

export async function deleteCharacterCascade(characterId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.characters, db.relations, db.timelineEvents, db.sessions],
    async () => {
      const char = await db.characters.get(characterId);
      if (!char) return;
      await db.relations.where('sourceId').equals(characterId).delete();
      await db.relations.where('targetId').equals(characterId).delete();
      if (char.worldId) {
        const events = await db.timelineEvents.where('worldId').equals(char.worldId).toArray();
        for (const ev of events) {
          if (ev.characterIds.includes(characterId)) {
            await db.timelineEvents.update(ev.id, {
              characterIds: ev.characterIds.filter((id) => id !== characterId),
            });
          }
        }
      }
      await db.sessions
        .toCollection()
        .modify((s) => {
          if (s.roleCharacterId === characterId) {
            s.roleCharacterId = undefined;
            if (s.chatMode === 'character_role') {
              s.chatMode = 'assistant';
            }
          }
        });
      await db.characters.delete(characterId);
    }
  );
}

export async function deleteTimelineEventCascade(eventId: string): Promise<void> {
  await db.transaction('rw', db.timelineEvents, db.relations, db.sessions, async () => {
    const ev = await db.timelineEvents.get(eventId);
    if (!ev) return;
    const rels = await db.relations.where('worldId').equals(ev.worldId).toArray();
    for (const rel of rels) {
      if (rel.phases.some((p) => p.fromEventId === eventId)) {
        await db.relations.update(rel.id, {
          phases: rel.phases.map((p) =>
            p.fromEventId === eventId ? { ...p, fromEventId: undefined } : p
          ),
        });
      }
    }
    await db.sessions
      .where('worldId')
      .equals(ev.worldId)
      .modify((s) => {
        if (s.storyPointEventId === eventId) s.storyPointEventId = undefined;
      });
    await db.timelineEvents.delete(eventId);
  });
}
