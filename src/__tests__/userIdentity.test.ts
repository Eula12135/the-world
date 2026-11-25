import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db, ensureDatabaseInitialized } from '../db/database';
import { exportFullBackupJson, importFullBackupJson } from '../services/exportService';
import {
  buildUserIdentityComboKey,
  resolveSessionUserRelation,
  resolveUserAddress,
  resolveUserIdentity,
} from '../services/userIdentity';
import { INITIAL_STORY_POINT } from '../services/temporalGraph';
import type {
  Character,
  CharacterRelation,
  RelationPhase,
  TimelineEvent,
  UserPersona,
} from '../types';

function makeCharacter(overrides: Partial<Character> & Pick<Character, 'id' | 'name'>): Character {
  return {
    worldId: '',
    identity: '',
    personality: '',
    status: '',
    relationsNote: '',
    notes: '',
    avatarColor: '#4d6bfe',
    updatedAt: 1,
    ...overrides,
  };
}

function makePersona(overrides: Partial<UserPersona> & Pick<UserPersona, 'id' | 'name'>): UserPersona {
  return {
    addressAs: '',
    identity: '',
    description: '',
    avatarColor: '#4d6bfe',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makePhase(overrides: Partial<RelationPhase> & Pick<RelationPhase, 'id' | 'type'>): RelationPhase {
  return {
    label: '',
    strength: 2,
    description: '',
    ...overrides,
  };
}

function makeRelation(
  overrides: Partial<CharacterRelation> &
    Pick<CharacterRelation, 'id' | 'sourceId' | 'targetId'>
): CharacterRelation {
  return {
    worldId: 'w1',
    directed: true,
    phases: [],
    updatedAt: 1,
    ...overrides,
  };
}

describe('resolveUserIdentity', () => {
  it('maps a persona, trimming addressAs and keeping it empty when unspecified', () => {
    const persona = makePersona({
      id: 'p1',
      name: ' 小澈 ',
      addressAs: '  阿澈 ',
      aliases: ' 澈澈 ',
      identity: '大学同学',
      description: '摄影社的',
    });

    const resolved = resolveUserIdentity({ kind: 'persona', id: 'p1' }, [persona], []);
    expect(resolved).not.toBeNull();
    expect(resolved!.name).toBe('小澈');
    expect(resolved!.addressAs).toBe('阿澈');
    expect(resolved!.aliases).toBe('澈澈');
    expect(resolved!.identity).toBe('大学同学');
    expect(resolved!.kind).toBe('persona');
    expect(resolved!.sourceId).toBe('p1');

    const blank = makePersona({ id: 'p2', name: '无称呼', addressAs: '   ' });
    expect(resolveUserIdentity({ kind: 'persona', id: 'p2' }, [blank], [])!.addressAs).toBe('');
  });

  it('never reads userRelation from the card the user is playing, but does read its voice', () => {
    // 称呼：卡上的钩子是"AI 演它时怎么叫用户"，与"我演它"无关，必须恒为空串。
    // 音色：我演这张卡，这张卡的声音就是我的声音，取它是正确的。
    const shenLan = makeCharacter({
      id: 'c_shenlan',
      name: '沈岚',
      identity: '剑修',
      personality: '寡言',
      notes: '左手有旧伤',
      voiceProfileId: 'vp_shen',
      voiceName: 'external:voice',
      userRelation: { defaultAddress: '师妹', defaultRelationLabel: '同门' },
    });

    const resolved = resolveUserIdentity({ kind: 'character', id: 'c_shenlan' }, [], [shenLan]);
    expect(resolved).not.toBeNull();
    expect(resolved!.addressAs).toBe('');
    expect(resolved!.voiceProfileId).toBe('vp_shen');
    expect(resolved!.voiceName).toBe('external:voice');
    expect(resolved!.identity).toBe('剑修');
    expect(resolved!.description).toBe('寡言\n左手有旧伤');
    expect(resolved!.kind).toBe('character');
    expect(resolved!.sourceId).toBe('c_shenlan');
  });

  it('carries the persona voice through resolution', () => {
    const persona = makePersona({
      id: 'p_voice',
      name: '小澈',
      voiceProfileId: 'vp_xiao',
      voiceName: 'external:xiao',
    });
    const resolved = resolveUserIdentity({ kind: 'persona', id: 'p_voice' }, [persona], []);
    expect(resolved!.voiceProfileId).toBe('vp_xiao');
    expect(resolved!.voiceName).toBe('external:xiao');
  });

  it('returns null when the source entity is missing or unnamed', () => {
    expect(resolveUserIdentity(undefined, [], [])).toBeNull();
    expect(resolveUserIdentity({ kind: 'persona', id: 'nope' }, [], [])).toBeNull();
    expect(resolveUserIdentity({ kind: 'character', id: 'nope' }, [], [])).toBeNull();
    expect(
      resolveUserIdentity({ kind: 'persona', id: 'p1' }, [makePersona({ id: 'p1', name: '   ' })], [])
    ).toBeNull();
  });
});

describe('resolveSessionUserRelation', () => {
  const roleCharacter = makeCharacter({
    id: 'c_lin',
    worldId: 'w1',
    name: '林澈',
    userRelation: {
      defaultAddress: '旅人',
      defaultRelationType: 'friend',
      defaultRelationLabel: '点头之交',
      defaultRelationDesc: '在渡口见过几面',
    },
  });

  it('falls back to the AI character card defaults', () => {
    const resolved = resolveSessionUserRelation({ roleCharacter });
    expect(resolved).not.toBeNull();
    expect(resolved!.label).toBe('点头之交');
    expect(resolved!.description).toBe('在渡口见过几面');
    expect(resolved!.address).toBe('旅人');
    expect(resolved!.source).toBe('card');
  });

  it('returns null when nothing defines a relation', () => {
    expect(resolveSessionUserRelation({ roleCharacter: makeCharacter({ id: 'c_x', name: '无钩子' }) })).toBeNull();
  });

  it('lets the session override win field by field', () => {
    const resolved = resolveSessionUserRelation({
      roleCharacter,
      override: { label: '旧友', address: '小澈' },
    });
    expect(resolved!.label).toBe('旧友');
    expect(resolved!.description).toBe('在渡口见过几面');
    expect(resolved!.address).toBe('小澈');
    expect(resolved!.source).toBe('session');
  });

  it('derives a label from the relation type when only a type is overridden', () => {
    const resolved = resolveSessionUserRelation({
      roleCharacter: makeCharacter({ id: 'c_x', name: '无钩子' }),
      override: { type: 'romance' },
    });
    expect(resolved!.label).toBe('情感');
    expect(resolved!.source).toBe('session');
  });

  it('uses the forward directed edge from the relation graph', () => {
    const shenLan = makeCharacter({ id: 'c_shen', worldId: 'w1', name: '沈岚' });
    const relation = makeRelation({
      id: 'rel1',
      sourceId: 'c_lin',
      targetId: 'c_shen',
      directed: true,
      phases: [makePhase({ id: 'ph1', type: 'rival', label: '死敌', description: '争同一把剑' })],
    });

    const resolved = resolveSessionUserRelation({
      roleCharacter,
      userIdentity: { kind: 'character', id: 'c_shen' },
      characters: [roleCharacter, shenLan],
      relations: [relation],
    });
    expect(resolved!.label).toBe('死敌');
    expect(resolved!.description).toBe('争同一把剑');
    expect(resolved!.source).toBe('graph');
  });

  it('accepts an undirected edge', () => {
    const shenLan = makeCharacter({ id: 'c_shen', worldId: 'w1', name: '沈岚' });
    const relation = makeRelation({
      id: 'rel2',
      sourceId: 'c_shen',
      targetId: 'c_lin',
      directed: false,
      phases: [makePhase({ id: 'ph1', type: 'ally', label: '战友' })],
    });

    const resolved = resolveSessionUserRelation({
      roleCharacter,
      userIdentity: { kind: 'character', id: 'c_shen' },
      characters: [roleCharacter, shenLan],
      relations: [relation],
    });
    expect(resolved!.label).toBe('战友');
    expect(resolved!.source).toBe('graph');
  });

  it('ignores a reverse-only directed edge so secret one-way feelings stay secret', () => {
    const shenLan = makeCharacter({ id: 'c_shen', worldId: 'w1', name: '沈岚' });
    const relation = makeRelation({
      id: 'rel3',
      sourceId: 'c_shen',
      targetId: 'c_lin',
      directed: true,
      phases: [makePhase({ id: 'ph1', type: 'secret', label: '暗恋' })],
    });

    const resolved = resolveSessionUserRelation({
      roleCharacter,
      userIdentity: { kind: 'character', id: 'c_shen' },
      characters: [roleCharacter, shenLan],
      relations: [relation],
    });
    // 反向边被丢弃，退回角色卡默认值
    expect(resolved!.label).toBe('点头之交');
    expect(resolved!.source).toBe('card');
  });

  it('does not consult the graph across different worlds', () => {
    const outsider = makeCharacter({ id: 'c_out', worldId: 'w2', name: '外乡人' });
    const relation = makeRelation({
      id: 'rel4',
      sourceId: 'c_lin',
      targetId: 'c_out',
      phases: [makePhase({ id: 'ph1', type: 'rival', label: '宿敌' })],
    });

    const resolved = resolveSessionUserRelation({
      roleCharacter,
      userIdentity: { kind: 'character', id: 'c_out' },
      characters: [roleCharacter, outsider],
      relations: [relation],
    });
    expect(resolved!.source).toBe('card');
    expect(resolved!.label).toBe('点头之交');
  });

  it('resolves the relation phase at the given story point (anti-spoiler)', () => {
    const shenLan = makeCharacter({ id: 'c_shen', worldId: 'w1', name: '沈岚' });
    const events: TimelineEvent[] = [
      { id: 'e1', worldId: 'w1', timeLabel: '春', title: '初遇', details: '', characterIds: [], orderIndex: 0, updatedAt: 1 },
      { id: 'e2', worldId: 'w1', timeLabel: '冬', title: '反目', details: '', characterIds: [], orderIndex: 1, updatedAt: 1 },
    ];
    const relation = makeRelation({
      id: 'rel5',
      sourceId: 'c_lin',
      targetId: 'c_shen',
      directed: true,
      phases: [
        makePhase({ id: 'ph1', type: 'friend', label: '同门' }),
        makePhase({ id: 'ph2', type: 'rival', label: '反目成仇', fromEventId: 'e2' }),
      ],
    });

    const atStart = resolveSessionUserRelation({
      roleCharacter,
      userIdentity: { kind: 'character', id: 'c_shen' },
      characters: [roleCharacter, shenLan],
      relations: [relation],
      events,
      pointEventId: INITIAL_STORY_POINT,
    });
    expect(atStart!.label).toBe('同门');

    const atLatest = resolveSessionUserRelation({
      roleCharacter,
      userIdentity: { kind: 'character', id: 'c_shen' },
      characters: [roleCharacter, shenLan],
      relations: [relation],
      events,
    });
    expect(atLatest!.label).toBe('反目成仇');
  });
});

describe('resolveUserAddress', () => {
  const roleCharacter = makeCharacter({
    id: 'c_lin',
    name: '林澈',
    userRelation: { defaultAddress: '旅人' },
  });
  const persona = resolveUserIdentity(
    { kind: 'persona', id: 'p1' },
    [makePersona({ id: 'p1', name: '小澈', addressAs: '阿澈' })],
    []
  )!;
  const unnamedPersona = resolveUserIdentity(
    { kind: 'persona', id: 'p2' },
    [makePersona({ id: 'p2', name: '无名', addressAs: '   ' })],
    []
  )!;

  it('prefers the session override', () => {
    expect(
      resolveUserAddress({ identity: persona, roleCharacter, override: { address: '小澈' } })
    ).toBe('小澈');
  });

  it('prefers the self-declared address over the card default', () => {
    expect(resolveUserAddress({ identity: persona, roleCharacter })).toBe('阿澈');
  });

  it('falls back to the AI card default when the persona does not specify one', () => {
    expect(resolveUserAddress({ identity: unnamedPersona, roleCharacter })).toBe('旅人');
  });

  it('uses the character name instead of AI card defaultAddress when playing as another character card', () => {
    const watsonCard = makeCharacter({ id: 'c_watson', name: '约翰·H·华生' });
    const asCharacter = resolveUserIdentity(
      { kind: 'character', id: 'c_watson' },
      [],
      [watsonCard]
    )!;
    expect(resolveUserAddress({ identity: asCharacter, roleCharacter })).toBe('约翰·H·华生');
  });

  it('falls back to the identity name when nothing else applies', () => {
    expect(resolveUserAddress({ identity: unnamedPersona, roleCharacter: null })).toBe('无名');
    expect(resolveUserAddress({ identity: null })).toBe('');
  });
});

describe('buildUserIdentityComboKey', () => {
  it('requires both sides to build a key', () => {
    expect(buildUserIdentityComboKey('c1', { kind: 'persona', id: 'p1' })).toBe('c1:persona:p1');
    expect(buildUserIdentityComboKey('c1', { kind: 'character', id: 'c2' })).toBe('c1:character:c2');
    expect(buildUserIdentityComboKey(undefined, { kind: 'persona', id: 'p1' })).toBeNull();
    expect(buildUserIdentityComboKey('c1', null)).toBeNull();
  });
});

describe('database v8 userPersonas table', () => {
  it('exposes the new table and round-trips a persona without touching other tables', async () => {
    expect(db.tables.map((t) => t.name)).toContain('userPersonas');
    expect(db.tables.map((t) => t.name)).toContain('sessions');

    const persona = makePersona({ id: 'up_test', name: '测试身份', addressAs: '阿测' });
    await db.userPersonas.put(persona);
    const stored = await db.userPersonas.get('up_test');
    expect(stored?.name).toBe('测试身份');
    expect(stored?.addressAs).toBe('阿测');

    await db.userPersonas.delete('up_test');
  });
});

describe('backup round-trip', () => {
  it('preserves userPersonas and character userRelation hooks', async () => {
    await ensureDatabaseInitialized();
    await db.characters.clear();
    await db.userPersonas.clear();

    await db.characters.put(
      makeCharacter({
        id: 'c_rt',
        name: '林澈',
        worldId: 'w_rt',
        userRelation: {
          defaultAddress: '旅人',
          defaultRelationLabel: '点头之交',
          defaultRelationType: 'friend',
        },
      })
    );
    await db.userPersonas.put(makePersona({ id: 'up_rt', name: '小澈', addressAs: '阿澈' }));

    const json = await exportFullBackupJson(false);
    const parsed = JSON.parse(json) as {
      backupVersion: number;
      data: { userPersonas?: unknown[] };
    };
    expect(parsed.backupVersion).toBe(7);
    expect(parsed.data.userPersonas).toHaveLength(1);

    await db.characters.clear();
    await db.userPersonas.clear();
    await importFullBackupJson(json);

    expect((await db.userPersonas.get('up_rt'))?.addressAs).toBe('阿澈');
    expect((await db.characters.get('c_rt'))?.userRelation?.defaultAddress).toBe('旅人');
    expect((await db.characters.get('c_rt'))?.userRelation?.defaultRelationType).toBe('friend');
  });
});
