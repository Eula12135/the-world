import {
  db,
  deleteCharacterCascade,
  deleteTimelineEventCascade,
  deleteWorldCascade,
} from '../../db/database';
import {
  hydrateCharactersFromDb,
  prepareCharacterForDb,
  releaseMediaRefCache,
} from '../../services/mediaStore';
import type { WorldProject } from '../../types';
import { createId } from '../../utils/platform';
import { loadWorldChildren } from '../helpers';
import type { AppSliceCreator, WorldSlice } from '../types';

export const createWorldSlice: AppSliceCreator<WorldSlice> = (set, get) => ({
  worlds: [],
  activeWorldId: null,
  characters: [],
  relations: [],
  timelineEvents: [],

  selectWorld: async (worldId) => {
    set({ activeWorldId: worldId, worldStudioMode: 'world' });
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
      worldStudioMode: 'world',
    });
    return world.id;
  },

  updateWorld: async (worldId, patch) => {
    await db.worlds.update(worldId, { ...patch, updatedAt: Date.now() });
    const worlds = await db.worlds.orderBy('updatedAt').reverse().toArray();
    set({ worlds });
  },

  deleteWorld: async (worldId, opts) => {
    const keepCharacters = Boolean(opts?.keepCharacters);
    await deleteWorldCascade(worldId, { keepCharacters });
    const worlds = await db.worlds.orderBy('updatedAt').reverse().toArray();
    const nextWorldId =
      get().activeWorldId === worldId ? worlds[0]?.id ?? null : get().activeWorldId;
    const worldData = await loadWorldChildren(nextWorldId);
    const sessions = await db.sessions.orderBy('updatedAt').reverse().toArray();
    const draft = get().draftConfig;
    const nextDraft =
      draft.worldId === worldId
        ? {
            ...draft,
            worldId: undefined,
            enableWorldContext: false,
            storyPointEventId: undefined,
            ...(!keepCharacters && draft.chatMode === 'character_role'
              ? { chatMode: 'assistant' as const, roleCharacterId: undefined }
              : {}),
          }
        : draft;
    set({
      worlds,
      activeWorldId: nextWorldId,
      sessions,
      draftConfig: nextDraft,
      ...worldData,
    });
  },

  appendWorldImportData: async ({
    worldId,
    document,
    mergeDocument,
    characters,
    events,
    relations,
  }) => {
    const preparedChars =
      characters.length > 0 ? await Promise.all(characters.map(prepareCharacterForDb)) : [];
    await db.transaction(
      'rw',
      [db.worlds, db.characters, db.timelineEvents, db.relations],
      async () => {
        const w = await db.worlds.get(worldId);
        if (w && document !== undefined) {
          const nextDoc =
            mergeDocument && w.document.trim()
              ? `${w.document.trimEnd()}\n\n${document.trim()}`
              : document;
          await db.worlds.update(worldId, { document: nextDoc, updatedAt: Date.now() });
        }
        if (preparedChars.length > 0) await db.characters.bulkPut(preparedChars);
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
    const prev = await db.characters.get(char.id);
    const prepared = await prepareCharacterForDb(char);
    const worldChanged = Boolean(prev && prev.worldId && prev.worldId !== prepared.worldId);
    if (worldChanged && prev) {
      await db.transaction('rw', [db.characters, db.relations, db.timelineEvents], async () => {
        await db.relations.where('sourceId').equals(prepared.id).delete();
        await db.relations.where('targetId').equals(prepared.id).delete();
        const oldEvents = await db.timelineEvents.where('worldId').equals(prev.worldId).toArray();
        for (const ev of oldEvents) {
          if (ev.characterIds.includes(prepared.id)) {
            await db.timelineEvents.update(ev.id, {
              characterIds: ev.characterIds.filter((id) => id !== prepared.id),
            });
          }
        }
        await db.characters.put(prepared);
      });
    } else {
      await db.characters.put(prepared);
    }

    if (prepared.worldId) {
      await db.worlds.update(prepared.worldId, { updatedAt: Date.now() }).catch(() => {});
    }

    if (worldChanged) {
      const data = await loadWorldChildren(null);
      set({ ...data });
    } else {
      const characters = await hydrateCharactersFromDb(await db.characters.toArray());
      set({ characters });
    }
  },

  deleteCharacter: async (id) => {
    releaseMediaRefCache(`char_avatar_${id}`);
    await deleteCharacterCascade(id);
    const [data, sessions] = await Promise.all([
      loadWorldChildren(null),
      db.sessions.orderBy('updatedAt').reverse().toArray(),
    ]);
    const draft = get().draftConfig;
    const nextDraft =
      draft.roleCharacterId === id
        ? {
            ...draft,
            roleCharacterId: undefined,
            ...(draft.chatMode === 'character_role'
              ? { chatMode: 'assistant' as const }
              : {}),
          }
        : draft;
    set({ ...data, sessions, draftConfig: nextDraft });
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
    const [data, sessions] = await Promise.all([
      loadWorldChildren(null),
      db.sessions.orderBy('updatedAt').reverse().toArray(),
    ]);
    const draft = get().draftConfig;
    set({
      ...data,
      sessions,
      draftConfig:
        draft.storyPointEventId === id ? { ...draft, storyPointEventId: undefined } : draft,
    });
  },
});
