import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  Character,
  CharacterRelation,
  ChatMessage,
  ChatSession,
  ImageGenConfig,
  PersonaPreset,
  ProviderConfig,
  TimelineEvent,
  VoiceConfig,
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
};

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  ttsEnabled: true,
  ttsAutoPlay: false,
  ttsEngine: 'native',
  ttsRate: 1,
  ttsNativeVoice: '',
  ttsBaseUrl: 'https://api.siliconflow.cn/v1',
  ttsApiKey: '',
  ttsModel: 'FunAudioLLM/CosyVoice2-0.5B',
  ttsVoice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
  sttEngine: 'native',
  sttBaseUrl: 'https://api.siliconflow.cn/v1',
  sttApiKey: '',
  sttModel: 'FunAudioLLM/SenseVoiceSmall',
  sttLanguage: 'zh',
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
  }
}

export const db = new TheWorldDatabase();

export function normalizeSettings(raw?: Partial<AppSettings> | null): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(raw || {}),
    id: 'global',
    imageGen: {
      ...DEFAULT_IMAGE_GEN_CONFIG,
      ...(raw?.imageGen || {}),
    },
    voice: {
      ...DEFAULT_VOICE_CONFIG,
      ...(raw?.voice || {}),
    },
  };
}

async function encryptKeyIfDesktop(plain: string): Promise<string> {
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

async function decryptKeyIfDesktop(stored: string): Promise<string> {
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

export async function saveProviderEncrypted(provider: ProviderConfig): Promise<void> {
  const encryptedKey = await encryptKeyIfDesktop(provider.apiKey);
  await db.providers.put({ ...provider, apiKey: encryptedKey });
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

export async function saveSettingsEncrypted(settings: AppSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  const [imgKey, ttsKey, sttKey] = await Promise.all([
    encryptKeyIfDesktop(normalized.imageGen.apiKey),
    encryptKeyIfDesktop(normalized.voice.ttsApiKey),
    encryptKeyIfDesktop(normalized.voice.sttApiKey),
  ]);
  await db.settings.put({
    ...normalized,
    imageGen: { ...normalized.imageGen, apiKey: imgKey },
    voice: { ...normalized.voice, ttsApiKey: ttsKey, sttApiKey: sttKey },
  });
}

export async function loadSettingsDecrypted(): Promise<AppSettings> {
  const stored = await db.settings.get('global');
  const normalized = normalizeSettings(stored);
  const [imgKey, ttsKey, sttKey] = await Promise.all([
    decryptKeyIfDesktop(normalized.imageGen.apiKey),
    decryptKeyIfDesktop(normalized.voice.ttsApiKey),
    decryptKeyIfDesktop(normalized.voice.sttApiKey),
  ]);
  return {
    ...normalized,
    imageGen: { ...normalized.imageGen, apiKey: imgKey },
    voice: { ...normalized.voice, ttsApiKey: ttsKey, sttApiKey: sttKey },
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

export async function deleteWorldCascade(worldId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.worlds, db.characters, db.relations, db.timelineEvents, db.sessions],
    async () => {
      await db.characters.where('worldId').equals(worldId).delete();
      await db.relations.where('worldId').equals(worldId).delete();
      await db.timelineEvents.where('worldId').equals(worldId).delete();
      await db.sessions
        .where('worldId')
        .equals(worldId)
        .modify((s) => {
          s.worldId = undefined;
          s.enableWorldContext = false;
          s.storyPointEventId = undefined;
          if (s.chatMode === 'character_role') {
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
      const events = await db.timelineEvents.where('worldId').equals(char.worldId).toArray();
      for (const ev of events) {
        if (ev.characterIds.includes(characterId)) {
          await db.timelineEvents.update(ev.id, {
            characterIds: ev.characterIds.filter((id) => id !== characterId),
          });
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
