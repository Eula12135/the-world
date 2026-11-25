import type {
  Character,
  CharacterRelation,
  RelationType,
  ResolvedUserIdentity,
  SessionUserRelationOverride,
  TimelineEvent,
  UserIdentityRef,
  UserPersona,
} from '../types';
import { RELATION_TYPE_META, resolveRelationAtPoint, sortEventsChronologically } from './temporalGraph';

const FALLBACK_AVATAR_COLOR = '#4d6bfe';

function joinNonEmpty(parts: Array<string | undefined>): string {
  return parts
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 把身份引用解析成中性形状，供渲染层与提示词层消费。
 *
 * 返回 null 表示身份不可用：源实体已被删除，或名字为空。调用方应降级为匿名。
 */
export function resolveUserIdentity(
  ref: UserIdentityRef | null | undefined,
  personas: UserPersona[],
  characters: Character[]
): ResolvedUserIdentity | null {
  if (!ref) return null;

  if (ref.kind === 'persona') {
    const persona = personas.find((p) => p.id === ref.id);
    if (!persona) return null;
    const name = (persona.name || '').trim();
    if (!name) return null;
    return {
      name,
      addressAs: (persona.addressAs || '').trim(),
      aliases: (persona.aliases || '').trim() || undefined,
      identity: persona.identity || '',
      description: persona.description || '',
      avatarImage: persona.avatarImage,
      avatarColor: persona.avatarColor || FALLBACK_AVATAR_COLOR,
      voiceProfileId: persona.voiceProfileId,
      voiceName: persona.voiceName,
      kind: 'persona',
      sourceId: persona.id,
    };
  }

  const character = characters.find((c) => c.id === ref.id);
  if (!character) return null;
  const name = (character.name || '').trim();
  if (!name) return null;
  return {
    name,
    // 刻意留空：角色卡上的 userRelation 描述的是「AI 演这张卡时怎么叫用户」，
    // 与「我演这张卡」无关。读了就是张冠李戴，称呼一律交给 resolveUserAddress。
    addressAs: '',
    identity: character.identity || '',
    description: joinNonEmpty([character.personality, character.notes]),
    avatarImage: character.avatarImage,
    avatarColor: character.avatarColor || FALLBACK_AVATAR_COLOR,
    // 音色则相反：我演这张卡，这张卡的声音就是「我」的声音，取它是正确的
    voiceProfileId: character.voiceProfileId,
    voiceName: character.voiceName,
    kind: 'character',
    sourceId: character.id,
  };
}

export interface ResolvedUserRelation {
  type?: RelationType;
  label: string;
  description: string;
  address?: string;
  /** 最终值来自哪一层：会话覆盖 / 人物关系图 / 角色卡默认值 */
  source: 'session' | 'graph' | 'card';
}

interface BaseRelation {
  type?: RelationType;
  label?: string;
  description?: string;
  address?: string;
  source: 'graph' | 'card';
}

/**
 * 从人物关系图中挑出「AI 角色 ↔ 我」的那条边，按方向优先级：
 *
 * 1. `AI 角色 → 我` 的有向边（AI 对我的视角）
 * 2. 无向边
 * 3. 只有 `我 → AI 角色` 的单向边时，不采用
 *
 * 第 3 条是故意留空的：「沈岚暗恋林澈、林澈并不知情」这种设定，
 * 一旦把反向边透给 AI，角色就会知道本不该知道的事。
 */
function pickRelationEdge(
  roleCharacterId: string,
  userCharacterId: string,
  relations: CharacterRelation[]
): CharacterRelation | null {
  const forward = relations.find(
    (r) => r.sourceId === roleCharacterId && r.targetId === userCharacterId
  );
  if (forward) return forward;

  const undirected = relations.find(
    (r) =>
      !r.directed &&
      ((r.sourceId === roleCharacterId && r.targetId === userCharacterId) ||
        (r.sourceId === userCharacterId && r.targetId === roleCharacterId))
  );
  return undirected ?? null;
}

function resolveGraphRelation(params: {
  roleCharacter?: Character | null;
  userIdentity?: UserIdentityRef | null;
  characters: Character[];
  relations: CharacterRelation[];
  events: TimelineEvent[];
  pointEventId?: string;
}): BaseRelation | null {
  const { roleCharacter, userIdentity, characters, relations, events, pointEventId } = params;
  if (!roleCharacter || !userIdentity || userIdentity.kind !== 'character') return null;
  if (userIdentity.id === roleCharacter.id) return null;

  const identityCharacter = characters.find((c) => c.id === userIdentity.id);
  if (!identityCharacter) return null;

  // 仅同作品的两张卡才查关系图：跨作品不存在可复用的关系
  const sameWorld =
    Boolean(roleCharacter.worldId) && roleCharacter.worldId === identityCharacter.worldId;
  if (!sameWorld) return null;

  const edge = pickRelationEdge(roleCharacter.id, identityCharacter.id, relations);
  if (!edge) return null;

  // 复用时间线解析：自动带上当前故事点，不剧透后续反转
  const resolved = resolveRelationAtPoint(edge, sortEventsChronologically(events), pointEventId);
  const phase = resolved.activePhase;
  if (!phase) return null;

  return {
    type: phase.type,
    label: (phase.label || '').trim() || RELATION_TYPE_META[phase.type]?.label || '',
    description: phase.description || '',
    source: 'graph',
  };
}

function resolveBaseRelation(params: {
  roleCharacter?: Character | null;
  userIdentity?: UserIdentityRef | null;
  characters: Character[];
  relations: CharacterRelation[];
  events: TimelineEvent[];
  pointEventId?: string;
}): BaseRelation | null {
  const graphRelation = resolveGraphRelation(params);
  if (graphRelation) return graphRelation;

  const hook = params.roleCharacter?.userRelation;
  if (
    hook &&
    (hook.defaultAddress ||
      hook.defaultRelationLabel ||
      hook.defaultRelationDesc ||
      hook.defaultRelationType)
  ) {
    return {
      type: hook.defaultRelationType,
      label: hook.defaultRelationLabel || '',
      description: hook.defaultRelationDesc || '',
      address: hook.defaultAddress || '',
      source: 'card',
    };
  }

  return null;
}

function hasOverrideFields(override: SessionUserRelationOverride | null | undefined): boolean {
  if (!override) return false;
  return (
    override.type !== undefined ||
    override.label !== undefined ||
    override.description !== undefined ||
    override.address !== undefined
  );
}

/**
 * 「我 × 角色」关系的取值优先级：
 *
 * 本会话 override（逐字段覆盖） > 两卡之间已有的人物关系 > AI 角色卡默认值 > 无
 *
 * 返回 null 表示没有任何关系信息，调用方不应注入关系块。
 */
export function resolveSessionUserRelation(params: {
  roleCharacter?: Character | null;
  userIdentity?: UserIdentityRef | null;
  override?: SessionUserRelationOverride | null;
  characters?: Character[];
  relations?: CharacterRelation[];
  events?: TimelineEvent[];
  pointEventId?: string;
}): ResolvedUserRelation | null {
  const { roleCharacter, userIdentity, override } = params;

  const base = resolveBaseRelation({
    roleCharacter,
    userIdentity,
    characters: params.characters || [],
    relations: params.relations || [],
    events: params.events || [],
    pointEventId: params.pointEventId,
  });

  const type = override?.type ?? base?.type;
  const label = (override?.label ?? base?.label ?? '').trim();
  const description = (override?.description ?? base?.description ?? '').trim();
  const address = (override?.address ?? base?.address ?? '').trim() || undefined;

  if (!label && !description && !type) return null;

  return {
    type,
    label: label || (type ? RELATION_TYPE_META[type]?.label || '' : ''),
    description,
    address,
    source: hasOverrideFields(override) ? 'session' : base?.source || 'card',
  };
}

/**
 * 「我」在提示词与界面上被称呼的名字，四级取第一个非空：
 *
 * 会话 override.address > 身份自填 addressAs > AI 角色卡 defaultAddress > 身份 name
 *
 * AI 角色卡的钩子排在身份自填之后：用户明确写下的称呼应当压过卡的默认值；
 * 而自建身份的 addressAs 留空即表示「不指定」，这时才轮到卡上的默认值生效。
 */
export function resolveUserAddress(params: {
  identity: ResolvedUserIdentity | null;
  roleCharacter?: Character | null;
  override?: SessionUserRelationOverride | null;
}): string {
  const { identity, roleCharacter, override } = params;
  if (!identity) return '';

  const fromOverride = (override?.address || '').trim();
  if (fromOverride) return fromOverride;

  const fromIdentity = (identity.addressAs || '').trim();
  if (fromIdentity) return fromIdentity;

  // 当「我」扮演的是另一张角色卡时，应该使用该角色的真实姓名，
  // 而不是 AI 角色卡面向匿名用户的默认称呼（如「先生/旅人」）。
  if (identity.kind === 'character') {
    return identity.name;
  }

  const fromCard = (roleCharacter?.userRelation?.defaultAddress || '').trim();
  if (fromCard) return fromCard;

  return identity.name;
}

/**
 * `(AI 角色, 我)` 的组合键，用于「新建会话继承上次关系」和「切换后失效」判定。
 * 任一方缺失时返回 null，表示不参与匹配。
 */
export function buildUserIdentityComboKey(
  roleCharacterId: string | undefined | null,
  ref: UserIdentityRef | undefined | null
): string | null {
  if (!roleCharacterId || !ref || !ref.id) return null;
  return `${roleCharacterId}:${ref.kind}:${ref.id}`;
}
