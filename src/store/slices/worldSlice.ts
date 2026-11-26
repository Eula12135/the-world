import {
  db,
  deleteCharacterCascade,
  deleteTimelineEventCascade,
  deleteWorldCascade,
} from '../../db/database';
import {
  materializeSampleWorldPreset,
  SAMPLE_WORLD_PRESETS,
} from '../../data/sampleWorlds';
import {
  hydrateCharactersFromDb,
  prepareCharacterForDb,
  releaseMediaRefCache,
} from '../../services/mediaStore';
import type { WorldProject } from '../../types';
import { sortCharacters } from '../../utils/characterSort';
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

  loadSampleWorld: async (presetId) => {
    const preset = SAMPLE_WORLD_PRESETS.find((p) => p.id === presetId);
    if (!preset) return null;
    const now = Date.now();
    const worldId = createId('world');
    const world: WorldProject = {
      id: worldId,
      name: preset.name,
      genre: preset.genre,
      document: preset.document,
      contextMode: 'progressive',
      pinnedSections: [...preset.pinnedSections],
      selectedSections: [],
      includeCharacters: true,
      includeTimeline: true,
      createdAt: now,
      updatedAt: now,
    };
    const { characters, events, relations } = materializeSampleWorldPreset(worldId, preset);
    const preparedChars =
      characters.length > 0 ? await Promise.all(characters.map(prepareCharacterForDb)) : [];
    await db.transaction(
      'rw',
      [db.worlds, db.characters, db.timelineEvents, db.relations],
      async () => {
        await db.worlds.put(world);
        if (preparedChars.length > 0) await db.characters.bulkPut(preparedChars);
        if (events.length > 0) await db.timelineEvents.bulkPut(events);
        if (relations.length > 0) await db.relations.bulkPut(relations);
      }
    );
    const [worlds, data] = await Promise.all([
      db.worlds.orderBy('updatedAt').reverse().toArray(),
      loadWorldChildren(worldId),
    ]);
    set({
      worlds,
      activeWorldId: worldId,
      worldStudioMode: 'world',
      ...data,
    });
    return worldId;
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
    const worldChanged = Boolean(prev && prev.worldId !== prepared.worldId);
    const recordToSave = worldChanged ? { ...prepared, sortOrder: undefined } : prepared;
    if (worldChanged && prev && prev.worldId) {
      await db.transaction('rw', [db.characters, db.relations, db.timelineEvents], async () => {
        await db.relations.where('sourceId').equals(recordToSave.id).delete();
        await db.relations.where('targetId').equals(recordToSave.id).delete();
        const oldEvents = await db.timelineEvents.where('worldId').equals(prev.worldId).toArray();
        for (const ev of oldEvents) {
          if (ev.characterIds.includes(recordToSave.id)) {
            await db.timelineEvents.update(ev.id, {
              characterIds: ev.characterIds.filter((id) => id !== recordToSave.id),
            });
          }
        }
        await db.characters.put(recordToSave);
      });
    } else {
      await db.characters.put(recordToSave);
    }

    if (recordToSave.worldId) {
      await db.worlds.update(recordToSave.worldId, { updatedAt: Date.now() }).catch(() => {});
    }

    if (worldChanged) {
      const data = await loadWorldChildren(null);
      set({ ...data });
    } else {
      const characters = await hydrateCharactersFromDb(await db.characters.toArray());
      set({ characters });
    }
  },

  toggleCharacterPin: async (id) => {
    const inMemory = get().characters;
    const target = inMemory.find((c) => c.id === id) ?? (await db.characters.get(id));
    if (!target) return;

    const nextPinned = !target.pinned;
    const siblingPool =
      inMemory.length > 0
        ? inMemory.filter((c) => c.worldId === target.worldId)
        : await db.characters.where('worldId').equals(target.worldId).toArray();

    const sameGroup = sortCharacters(
      siblingPool.filter((c) => c.id !== id && Boolean(c.pinned) === nextPinned)
    );

    const patches = new Map<string, { pinned?: boolean; sortOrder: number }>();
    patches.set(id, { pinned: nextPinned, sortOrder: 0 });
    sameGroup.forEach((c, idx) => {
      patches.set(c.id, { sortOrder: (idx + 1) * 10 });
    });

    // 1. 0ms 同步乐观更新内存态，UI 当帧立即响应并播放 FLIP 过渡
    if (inMemory.some((c) => c.id === id)) {
      set((state) => ({
        characters: state.characters.map((c) => {
          const patch = patches.get(c.id);
          return patch ? { ...c, ...patch } : c;
        }),
      }));
    }

    // 2. 单事务并行落盘，不做全表重读与媒体二次水合
    await db.transaction('rw', db.characters, async () => {
      await Promise.all(
        Array.from(patches.entries()).map(([cid, patch]) => db.characters.update(cid, patch))
      );
    });

    if (!inMemory.some((c) => c.id === id)) {
      const characters = await hydrateCharactersFromDb(await db.characters.toArray());
      set({ characters });
    }
  },

  reorderCharacters: async (worldId, orderedIds) => {
    if (orderedIds.length === 0) return;
    const orderMap = new Map<string, number>();
    orderedIds.forEach((id, idx) => {
      orderMap.set(id, idx * 10);
    });

    // 先同步更新内存态，松手瞬间零闪烁
    set((state) => ({
      characters: state.characters.map((c) =>
        c.worldId === worldId && orderMap.has(c.id)
          ? { ...c, sortOrder: orderMap.get(c.id)! }
          : c
      ),
    }));

    await db.transaction('rw', db.characters, async () => {
      for (const [id, sortOrder] of orderMap.entries()) {
        await db.characters.update(id, { sortOrder });
      }
    });
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
