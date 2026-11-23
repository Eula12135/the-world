import { db } from '../../db/database';
import type { UserPersona } from '../../types';
import { buildUserIdentityComboKey, resolveUserIdentity } from '../../services/userIdentity';
import { createId } from '../../utils/platform';
import type { AppSliceCreator, UserPersonaSlice } from '../types';

async function loadUserPersonas(): Promise<UserPersona[]> {
  return db.userPersonas.orderBy('updatedAt').reverse().toArray();
}

export const createUserPersonaSlice: AppSliceCreator<UserPersonaSlice> = (set, get) => ({
  userPersonas: [],

  upsertUserPersona: async (persona) => {
    await db.userPersonas.put({ ...persona, updatedAt: Date.now() });
    set({ userPersonas: await loadUserPersonas() });
  },

  deleteUserPersona: async (id) => {
    await db.userPersonas.delete(id);
    // 会话里的引用保留不清理：解析时自然降级为匿名（设计 §8.3：不做快照兜底）
    set({ userPersonas: await loadUserPersonas() });
  },

  createUserPersonaFromCharacter: async (characterId) => {
    const resolved = resolveUserIdentity(
      { kind: 'character', id: characterId },
      [],
      get().characters
    );
    if (!resolved) return null;

    const now = Date.now();
    const persona: UserPersona = {
      id: createId('up'),
      name: resolved.name,
      addressAs: '',
      identity: resolved.identity,
      description: resolved.description,
      avatarImage: resolved.avatarImage,
      avatarColor: resolved.avatarColor,
      sourceCharacterId: characterId,
      createdAt: now,
      updatedAt: now,
    };

    await db.userPersonas.put(persona);
    set({ userPersonas: await loadUserPersonas() });
    return persona.id;
  },

  inheritUserRelationOverride: (roleCharacterId, identity, excludeSessionId) => {
    const key = buildUserIdentityComboKey(roleCharacterId, identity);
    if (!key) return undefined;

    // sessions 按 updatedAt 倒序，第一条命中即为最近一次
    const match = get().sessions.find(
      (s) =>
        s.id !== excludeSessionId &&
        Boolean(s.userRelationOverride) &&
        buildUserIdentityComboKey(s.roleCharacterId, s.userIdentity) === key
    );
    return match?.userRelationOverride ? { ...match.userRelationOverride } : undefined;
  },
});
