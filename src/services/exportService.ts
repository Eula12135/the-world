import {
  db,
  loadProvidersDecrypted,
  loadSettingsDecrypted,
  normalizeSettings,
  saveProviderEncrypted,
  saveSettingsEncrypted,
} from '../db/database';
import type {
  Character,
  CharacterRelation,
  ChatMessage,
  ChatSession,
  PersonaPreset,
  ProviderConfig,
  TimelineEvent,
  WorldProject,
} from '../types';
import { sortEventsChronologically } from './temporalGraph';

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
        imageGen: { ...settings.imageGen, apiKey: '' },
        voice: { ...settings.voice, ttsApiKey: '', sttApiKey: '' },
      };

  return JSON.stringify(
    {
      app: 'the-world',
      backupVersion: 4,
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

  if (Array.isArray(d.providers)) {
    for (const p of d.providers as ProviderConfig[]) {
      await saveProviderEncrypted({
        ...p,
        apiKey: p.apiKey || currentKeyMap.get(p.id) || '',
      });
    }
  }

  await db.transaction(
    'rw',
    [
      db.sessions,
      db.messages,
      db.worlds,
      db.characters,
      db.relations,
      db.timelineEvents,
      db.personaPresets,
    ],
    async () => {
      if (Array.isArray(d.sessions)) await db.sessions.bulkPut(d.sessions);
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
      if (Array.isArray(d.characters)) await db.characters.bulkPut(d.characters);
      if (Array.isArray(d.relations)) await db.relations.bulkPut(d.relations);
      if (Array.isArray(d.timelineEvents)) await db.timelineEvents.bulkPut(d.timelineEvents);
      if (Array.isArray(d.personaPresets)) {
        await db.personaPresets.bulkPut(d.personaPresets as PersonaPreset[]);
      }
    }
  );

  if (d.settings) {
    const merged = normalizeSettings(d.settings);
    merged.imageGen.apiKey = merged.imageGen.apiKey || currentSettings.imageGen.apiKey;
    merged.voice.ttsApiKey = merged.voice.ttsApiKey || currentSettings.voice.ttsApiKey;
    merged.voice.sttApiKey = merged.voice.sttApiKey || currentSettings.voice.sttApiKey;
    await saveSettingsEncrypted(merged);
  }

  return {
    sessionsCount: Array.isArray(d.sessions) ? d.sessions.length : 0,
    worldsCount: Array.isArray(d.worlds) ? d.worlds.length : 0,
  };
}
