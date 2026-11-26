import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureDatabaseInitialized } from '../db/database';
import { exportFullBackupJson, importFullBackupJson } from '../services/exportService';
import { useAppStore } from '../store/useAppStore';
import type { Character } from '../types';
import { reorderWithinPinGroup, sortCharacters } from '../utils/characterSort';

function makeChar(overrides: Partial<Character> & Pick<Character, 'id' | 'name'>): Character {
  return {
    worldId: 'w_test',
    identity: '',
    personality: '',
    status: '',
    relationsNote: '',
    notes: '',
    avatarColor: '#4d6bfe',
    updatedAt: 100,
    ...overrides,
  };
}

describe('characterSort utilities', () => {
  it('places pinned characters first, then sortOrder ascending, then updatedAt descending', () => {
    const chars: Character[] = [
      makeChar({ id: 'c_old', name: '旧卡', updatedAt: 100 }),
      makeChar({ id: 'c_new', name: '新卡', updatedAt: 500 }),
      makeChar({ id: 'c_ordered_2', name: '排第二', sortOrder: 20, updatedAt: 50 }),
      makeChar({ id: 'c_ordered_1', name: '排第一', sortOrder: 10, updatedAt: 40 }),
      makeChar({ id: 'c_pin_b', name: '置顶B', pinned: true, sortOrder: 10, updatedAt: 10 }),
      makeChar({ id: 'c_pin_a', name: '置顶A', pinned: true, sortOrder: 0, updatedAt: 5 }),
    ];

    const sorted = sortCharacters(chars);
    expect(sorted.map((c) => c.id)).toEqual([
      'c_pin_a',
      'c_pin_b',
      'c_ordered_1',
      'c_ordered_2',
      'c_new',
      'c_old',
    ]);
  });

  it('reorders within the same pin group and rejects cross-group drags', () => {
    const list = [
      makeChar({ id: 'p1', name: 'P1', pinned: true }),
      makeChar({ id: 'p2', name: 'P2', pinned: true }),
      makeChar({ id: 'u1', name: 'U1', pinned: false }),
      makeChar({ id: 'u2', name: 'U2' }),
      makeChar({ id: 'u3', name: 'U3' }),
    ];

    // Cross-group drag returns null so pinned status is never accidentally altered
    expect(reorderWithinPinGroup(list, 'p1', 'u1')).toBeNull();
    expect(reorderWithinPinGroup(list, 'u2', 'p2')).toBeNull();

    // Dragging u3 onto u1 moves u3 to u1's slot
    const moved = reorderWithinPinGroup(list, 'u3', 'u1');
    expect(moved?.map((c) => c.id)).toEqual(['p1', 'p2', 'u3', 'u1', 'u2']);
  });
});

describe('character pinning, reordering & backup persistence', () => {
  beforeEach(async () => {
    await db.characters.clear();
    await db.worlds.clear();
    await ensureDatabaseInitialized();
    await useAppStore.getState().init();
  });

  it('toggles pin and persists custom drag order in store & IndexedDB', async () => {
    const store = useAppStore.getState();
    await store.upsertCharacter(makeChar({ id: 'c1', name: '福尔摩斯', updatedAt: 100 }));
    await store.upsertCharacter(makeChar({ id: 'c2', name: '华生', updatedAt: 200 }));
    await store.upsertCharacter(makeChar({ id: 'c3', name: '艾琳', updatedAt: 300 }));

    // Reorder unpinned: c1 -> c3 -> c2
    await useAppStore.getState().reorderCharacters('w_test', ['c1', 'c3', 'c2']);
    let current = sortCharacters(
      useAppStore.getState().characters.filter((c) => c.worldId === 'w_test')
    );
    expect(current.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);

    // Pin c2 -> c2 jumps to top
    await useAppStore.getState().toggleCharacterPin('c2');
    // Pin c3 -> newly pinned c3 jumps ahead of c2
    await useAppStore.getState().toggleCharacterPin('c3');

    current = sortCharacters(
      useAppStore.getState().characters.filter((c) => c.worldId === 'w_test')
    );
    expect(current.map((c) => c.id)).toEqual(['c3', 'c2', 'c1']);
    expect(current[0].pinned).toBe(true);
    expect(current[1].pinned).toBe(true);
    expect(current[2].pinned).toBeFalsy();

    // Unpin c3 -> c3 moves to top of unpinned group (after pinned c2, before c1)
    await useAppStore.getState().toggleCharacterPin('c3');
    current = sortCharacters(
      useAppStore.getState().characters.filter((c) => c.worldId === 'w_test')
    );
    expect(current.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('preserves pinned and sortOrder across full backup export and import', async () => {
    const store = useAppStore.getState();
    await store.upsertCharacter(
      makeChar({ id: 'c_fav', name: '置顶主角', pinned: true, sortOrder: 0, updatedAt: 10 })
    );
    await store.upsertCharacter(
      makeChar({ id: 'c_sec', name: '次席配角', pinned: false, sortOrder: 20, updatedAt: 500 })
    );

    const json = await exportFullBackupJson(false);
    await db.characters.clear();
    await importFullBackupJson(json);

    const restored = sortCharacters(await db.characters.toArray());
    expect(restored.map((c) => c.id)).toEqual(['c_fav', 'c_sec']);
    expect(restored[0].pinned).toBe(true);
    expect(restored[0].sortOrder).toBe(0);
    expect(restored[1].sortOrder).toBe(20);
  });
});
