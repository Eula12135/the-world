import { db } from '../db/database';
import type {
  Character,
  CharacterRelation,
  ChatSession,
  ProviderConfig,
  TimelineEvent,
  WorldProject,
} from '../types';
import type { DraftSessionConfig } from './types';

export async function loadWorldChildren(_worldId?: string | null) {
  const [characters, relations, timelineEvents] = await Promise.all([
    db.characters.toArray(),
    db.relations.toArray(),
    db.timelineEvents.orderBy('orderIndex').toArray(),
  ]);
  return { characters, relations, timelineEvents };
}

export async function loadSessionContextData(
  session: Pick<ChatSession, 'worldId' | 'enableWorldContext' | 'chatMode' | 'roleCharacterId'>
): Promise<{
  world: WorldProject | null;
  characters: Character[];
  relations: CharacterRelation[];
  timelineEvents: TimelineEvent[];
}> {
  let world: WorldProject | null = null;
  const needsWorldData =
    Boolean(session.enableWorldContext && session.worldId) ||
    session.chatMode === 'character_role' ||
    Boolean(session.roleCharacterId);

  if (!needsWorldData) {
    return { world, characters: [], relations: [], timelineEvents: [] };
  }

  let targetWid = session.worldId;
  let roleChar: Character | undefined;
  if (session.roleCharacterId) {
    roleChar = await db.characters.get(session.roleCharacterId);
    if (!targetWid && roleChar?.worldId) {
      targetWid = roleChar.worldId;
    }
  }

  if (targetWid) {
    world = (await db.worlds.get(targetWid)) ?? null;
    const [wChars, wRels, wEvents] = await Promise.all([
      db.characters.where('worldId').equals(targetWid).toArray(),
      db.relations.where('worldId').equals(targetWid).toArray(),
      db.timelineEvents.where('worldId').equals(targetWid).sortBy('orderIndex'),
    ]);
    const characters =
      roleChar && !wChars.some((c) => c.id === roleChar.id)
        ? [roleChar, ...wChars]
        : wChars;
    return { world, characters, relations: wRels, timelineEvents: wEvents };
  }

  return {
    world: null,
    characters: roleChar ? [roleChar] : [],
    relations: [],
    timelineEvents: [],
  };
}

export function pickDefaultModelConfig(
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
