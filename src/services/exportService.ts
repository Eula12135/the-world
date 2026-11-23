import {
  db,
  loadProvidersDecrypted,
  loadSettingsDecrypted,
  normalizeSettings,
  prepareProviderForStorage,
  prepareSettingsForStorage,
} from '../db/database';
import type {
  Character,
  CharacterRelation,
  CharacterUserRelationHook,
  ChatMessage,
  ChatSession,
  MediaProviderCredential,
  PersonaPreset,
  ProviderConfig,
  RelationType,
  TimelineEvent,
  UserPersona,
  VoiceProfile,
  WorldProject,
} from '../types';
import { RELATION_TYPE_META, sortEventsChronologically } from './temporalGraph';

function normalizeUserRelationHook(raw: unknown): CharacterUserRelationHook | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const v = r[key];
    return typeof v === 'string' && v.trim() ? v : undefined;
  };
  const typeRaw = r.defaultRelationType;
  const hook: CharacterUserRelationHook = {
    defaultAddress: text('defaultAddress'),
    defaultRelationType:
      typeof typeRaw === 'string' && typeRaw in RELATION_TYPE_META
        ? (typeRaw as RelationType)
        : undefined,
    defaultRelationLabel: text('defaultRelationLabel'),
    defaultRelationDesc: text('defaultRelationDesc'),
    slotHint: text('slotHint'),
  };
  return Object.values(hook).some((v) => v !== undefined) ? hook : undefined;
}

export function sessionToMarkdown(
  session: ChatSession,
  messages: ChatMessage[],
  includeReasoning = true
): string {
  const lines: string[] = [
    `# ${session.title}`,
    '',
    `- 导出时间：${new Date().toLocaleString()}`,
    `- 模型：${session.model}`,
    '',
    '---',
    '',
  ];

  if (session.rollingSummary) {
    lines.push('## 前情记忆摘要', '', session.rollingSummary, '', '---', '');
  }

  for (const m of messages) {
    const roleLabel =
      m.role === 'user' ? '## 用户' : m.role === 'assistant' ? '## AI 助手' : '## 系统';
    lines.push(roleLabel, '');
    if (includeReasoning && m.reasoning) {
      lines.push(
        `<details>`,
        `<summary>思考过程${m.thinkingDurationSec ? `（${m.thinkingDurationSec} 秒）` : ''}</summary>`,
        '',
        m.reasoning,
        '',
        `</details>`,
        ''
      );
    }
    lines.push(m.content, '');
  }

  return lines.join('\n');
}

export function worldToMarkdown(params: {
  world: WorldProject;
  characters: Character[];
  events: TimelineEvent[];
  relations?: CharacterRelation[];
}): string {
  const { world, characters, events, relations = [] } = params;
  const charName = new Map(characters.map((c) => [c.id, c.name]));
  const eventTitle = new Map(events.map((e) => [e.id, e.title]));
  const lines: string[] = [
    `# 《${world.name}》世界观设定集`,
    '',
    world.genre ? `- **题材**：${world.genre}` : '',
    '',
    world.document.trim(),
  ].filter((x) => x !== undefined);

  if (characters.length > 0) {
    lines.push('', '---', '', '# 角色卡');
    for (const c of characters) {
      lines.push('', `## ${c.name}${c.identity ? `（${c.identity}）` : ''}`);
      if (c.personality) lines.push(`- **性格**：${c.personality}`);
      if (c.status) lines.push(`- **当前状态**：${c.status}`);
      if (c.relationsNote) lines.push(`- **人物关系**：${c.relationsNote}`);
      if (c.notes) lines.push(`- **补充备注**：${c.notes}`);
    }
  }

  if (relations.length > 0) {
    lines.push('', '---', '', '# 跨时间人物关系演进');
    for (const rel of relations) {
      const src = charName.get(rel.sourceId) || '?';
      const dst = charName.get(rel.targetId) || '?';
      const arrow = rel.directed ? '→' : '↔';
      lines.push('', `## ${src} ${arrow} ${dst}`);
      for (const ph of rel.phases) {
        const when = ph.fromEventId ? `事件「${eventTitle.get(ph.fromEventId) || '未知事件'}」之后` : '故事初始';
        lines.push(`- **${when}**：${ph.label}${ph.description ? ` — ${ph.description}` : ''}`);
      }
    }
  }

  if (events.length > 0) {
    lines.push('', '---', '', '# 事件时间线');
    const sorted = sortEventsChronologically(events);
    for (const ev of sorted) {
      const who = ev.characterIds.map((id) => charName.get(id)).filter(Boolean).join('、');
      lines.push('', `## ${ev.timeLabel ? `${ev.timeLabel} · ` : ''}${ev.title}`);
      if (who) lines.push(`- **涉及角色**：${who}`);
      if (ev.details) lines.push(ev.details);
    }
  }

  return lines.join('\n');
}

function stripProviderConfigsKeys(
  configs?: Record<string, MediaProviderCredential>
): Record<string, MediaProviderCredential> | undefined {
  if (!configs) return undefined;
  const out: Record<string, MediaProviderCredential> = {};
  for (const [k, v] of Object.entries(configs)) {
    out[k] = { ...v, apiKey: '' };
  }
  return out;
}

function mergePreservedProviderConfigs(
  incoming?: Record<string, MediaProviderCredential>,
  existing?: Record<string, MediaProviderCredential>
): Record<string, MediaProviderCredential> {
  const merged: Record<string, MediaProviderCredential> = {};
  if (existing) {
    for (const [k, v] of Object.entries(existing)) {
      merged[k] = { ...v };
    }
  }
  if (incoming) {
    for (const [k, v] of Object.entries(incoming)) {
      const prevKey = existing?.[k]?.apiKey || '';
      merged[k] = {
        ...v,
        apiKey: v.apiKey || prevKey,
      };
    }
  }
  return merged;
}

export async function exportFullBackupJson(includeApiKeys: boolean): Promise<string> {
  const [
    providers,
    sessions,
    messages,
    worlds,
    characters,
    relations,
    timelineEvents,
    personaPresets,
    userPersonas,
    voiceProfiles,
    settings,
  ] = await Promise.all([
    loadProvidersDecrypted(),
    db.sessions.toArray(),
    db.messages.toArray(),
    db.worlds.toArray(),
    db.characters.toArray(),
    db.relations.toArray(),
    db.timelineEvents.toArray(),
    db.personaPresets.toArray(),
    db.userPersonas.toArray(),
    db.voiceProfiles.toArray(),
    loadSettingsDecrypted(),
  ]);

  const sanitizedProviders: ProviderConfig[] = providers.map((p) => ({
    ...p,
    apiKey: includeApiKeys ? p.apiKey : '',
  }));

  const sanitizedSettings = includeApiKeys
    ? settings
    : {
        ...settings,
        imageGen: {
          ...settings.imageGen,
          apiKey: '',
          providerConfigs: stripProviderConfigsKeys(settings.imageGen.providerConfigs),
        },
        voice: {
          ...settings.voice,
          ttsApiKey: '',
          sttApiKey: '',
          ttsProviderConfigs: stripProviderConfigsKeys(settings.voice.ttsProviderConfigs),
          sttProviderConfigs: stripProviderConfigsKeys(settings.voice.sttProviderConfigs),
        },
      };

  return JSON.stringify(
    {
      app: 'the-world',
      backupVersion: 7,
      exportedAt: new Date().toISOString(),
      includesApiKeys: includeApiKeys,
      data: {
        providers: sanitizedProviders,
        sessions,
        messages,
        worlds,
        characters,
        relations,
        timelineEvents,
        personaPresets,
        userPersonas,
        voiceProfiles,
        settings: sanitizedSettings,
      },
    },
    null,
    2
  );
}

export async function importFullBackupJson(rawText: string): Promise<{
  sessionsCount: number;
  worldsCount: number;
}> {
  const parsed = JSON.parse(rawText);
  if (!parsed || parsed.app !== 'the-world' || !parsed.data) {
    throw new Error('不是有效的 The World 备份文件');
  }
  const d = parsed.data;
  const [currentProviders, currentSettings] = await Promise.all([
    loadProvidersDecrypted(),
    loadSettingsDecrypted(),
  ]);
  const currentKeyMap = new Map(currentProviders.map((p) => [p.id, p.apiKey]));

  const encryptedProviders = Array.isArray(d.providers)
    ? await Promise.all(
        (d.providers as ProviderConfig[]).map((p) =>
          prepareProviderForStorage({
            ...p,
            apiKey: p.apiKey || currentKeyMap.get(p.id) || '',
          })
        )
      )
    : null;

  let encryptedSettings = null;
  if (d.settings) {
    const merged = normalizeSettings(d.settings);
    merged.imageGen.apiKey = merged.imageGen.apiKey || currentSettings.imageGen.apiKey;
    merged.imageGen.providerConfigs = mergePreservedProviderConfigs(
      merged.imageGen.providerConfigs,
      currentSettings.imageGen.providerConfigs
    );
    merged.voice.ttsApiKey = merged.voice.ttsApiKey || currentSettings.voice.ttsApiKey;
    merged.voice.sttApiKey = merged.voice.sttApiKey || currentSettings.voice.sttApiKey;
    merged.voice.ttsProviderConfigs = mergePreservedProviderConfigs(
      merged.voice.ttsProviderConfigs,
      currentSettings.voice.ttsProviderConfigs
    );
    merged.voice.sttProviderConfigs = mergePreservedProviderConfigs(
      merged.voice.sttProviderConfigs,
      currentSettings.voice.sttProviderConfigs
    );
    encryptedSettings = await prepareSettingsForStorage(merged);
  }

  await db.transaction(
    'rw',
    [
      db.providers,
      db.sessions,
      db.messages,
      db.worlds,
      db.characters,
      db.relations,
      db.timelineEvents,
      db.personaPresets,
      db.userPersonas,
      db.voiceProfiles,
      db.settings,
    ],
    async () => {
      if (encryptedProviders) await db.providers.bulkPut(encryptedProviders);
      const importedPresetIds = new Set(
        Array.isArray(d.personaPresets)
          ? (d.personaPresets as PersonaPreset[]).map((p) => p.id).filter(Boolean)
          : []
      );
      if (Array.isArray(d.sessions)) {
        const normalizedSessions = (d.sessions as ChatSession[]).map((s) =>
          s.chatMode === 'custom_persona' &&
          s.personaPresetId &&
          importedPresetIds.has(s.personaPresetId)
            ? {
                ...s,
                chatMode: 'character_role' as const,
                roleCharacterId: s.personaPresetId,
                personaPresetId: undefined,
              }
            : s
        );
        await db.sessions.bulkPut(normalizedSessions);
      }
      if (Array.isArray(d.messages)) await db.messages.bulkPut(d.messages);
      if (Array.isArray(d.worlds)) {
        for (const w of d.worlds) {
          await db.worlds.put({
            id: w.id,
            name: w.name || '未命名作品',
            genre: w.genre || '其他',
            document:
              typeof w.document === 'string'
                ? w.document
                : [w.synopsis, w.styleGuide].filter(Boolean).join('\n\n') || '',
            contextMode: w.contextMode || 'progressive',
            pinnedSections: Array.isArray(w.pinnedSections) ? w.pinnedSections : [],
            selectedSections: Array.isArray(w.selectedSections) ? w.selectedSections : [],
            includeCharacters: w.includeCharacters ?? true,
            includeTimeline: w.includeTimeline ?? true,
            createdAt: w.createdAt || Date.now(),
            updatedAt: w.updatedAt || Date.now(),
          });
        }
      }
      if (Array.isArray(d.characters)) {
        const normalizedChars = d.characters
          .filter(
            (c: any) => c && typeof c === 'object' && typeof c.id === 'string' && c.id.trim()
          )
          .map((c: any) => ({
            id: c.id,
            worldId: typeof c.worldId === 'string' ? c.worldId : '',
            name: typeof c.name === 'string' && c.name.trim() ? c.name : '未命名角色',
            identity: typeof c.identity === 'string' ? c.identity : '',
            personality: typeof c.personality === 'string' ? c.personality : '',
            status: typeof c.status === 'string' ? c.status : '',
            relationsNote: typeof c.relationsNote === 'string' ? c.relationsNote : '',
            notes: typeof c.notes === 'string' ? c.notes : '',
            systemPrompt: typeof c.systemPrompt === 'string' ? c.systemPrompt : undefined,
            avatarImage: typeof c.avatarImage === 'string' ? c.avatarImage : undefined,
            avatarPrompt: typeof c.avatarPrompt === 'string' ? c.avatarPrompt : undefined,
            avatarColor:
              typeof c.avatarColor === 'string' && c.avatarColor ? c.avatarColor : '#4d6bfe',
            voiceName: typeof c.voiceName === 'string' ? c.voiceName : undefined,
            voiceProfileId: typeof c.voiceProfileId === 'string' ? c.voiceProfileId : undefined,
            userRelation: normalizeUserRelationHook(c.userRelation),
            updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
          }));
        if (normalizedChars.length > 0) {
          await db.characters.bulkPut(normalizedChars);
        }
      }
      if (Array.isArray(d.relations)) await db.relations.bulkPut(d.relations);
      if (Array.isArray(d.timelineEvents)) await db.timelineEvents.bulkPut(d.timelineEvents);
      if (Array.isArray(d.personaPresets)) {
        const presets = d.personaPresets as PersonaPreset[];
        await db.personaPresets.bulkPut(presets);
        for (const p of presets) {
          const existing = await db.characters.get(p.id);
          if (!existing) {
            await db.characters.put({
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
            });
          }
        }
      }
      if (Array.isArray(d.voiceProfiles)) {
        await db.voiceProfiles.bulkPut(d.voiceProfiles as VoiceProfile[]);
      }
      if (Array.isArray(d.userPersonas)) {
        const personas = (d.userPersonas as UserPersona[])
          .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && p.id.trim())
          .map((p) => ({
            id: p.id,
            name: typeof p.name === 'string' && p.name.trim() ? p.name : '未命名身份',
            addressAs: typeof p.addressAs === 'string' ? p.addressAs : '',
            aliases: typeof p.aliases === 'string' ? p.aliases : undefined,
            identity: typeof p.identity === 'string' ? p.identity : '',
            description: typeof p.description === 'string' ? p.description : '',
            avatarImage: typeof p.avatarImage === 'string' ? p.avatarImage : undefined,
            avatarColor:
              typeof p.avatarColor === 'string' && p.avatarColor ? p.avatarColor : '#4d6bfe',
            sourceCharacterId:
              typeof p.sourceCharacterId === 'string' ? p.sourceCharacterId : undefined,
            createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
            updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now(),
          }));
        if (personas.length > 0) await db.userPersonas.bulkPut(personas);
      }
      if (encryptedSettings) {
        await db.settings.put(encryptedSettings);
      }
    }
  );

  return {
    sessionsCount: Array.isArray(d.sessions) ? d.sessions.length : 0,
    worldsCount: Array.isArray(d.worlds) ? d.worlds.length : 0,
  };
}
