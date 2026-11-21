import type { CharacterRelation, RelationPhase, RelationType, TimelineEvent } from '../types';

export const INITIAL_STORY_POINT = '__initial__';

export const RELATION_TYPE_META: Record<RelationType, { label: string; color: string }> = {
  friend: { label: '好友', color: '#10b981' },
  ally: { label: '同盟', color: '#06b6d4' },
  family: { label: '亲属', color: '#f59e0b' },
  mentor: { label: '师徒', color: '#6366f1' },
  romance: { label: '情感', color: '#ec4899' },
  hierarchy: { label: '上下级', color: '#8b5cf6' },
  rival: { label: '竞争', color: '#f97316' },
  hostile: { label: '敌对', color: '#ef4444' },
  secret: { label: '隐秘关系', color: '#a855f7' },
  custom: { label: '自定义', color: '#64748b' },
};

export interface ResolvedRelationState {
  relation: CharacterRelation;
  activePhase: RelationPhase | null;
  previousPhase?: RelationPhase;
  changedAtCurrentEvent: boolean;
}

export function sortEventsChronologically(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Resolves the effective relation phase at a specific point in the timeline.
 * - pointEventId === '__initial__': only phases with no fromEventId
 * - pointEventId === undefined: latest chronological phase (all events have occurred)
 * - pointEventId === <eventId>: all initial phases + phases triggered at or before that event
 */
export function resolveRelationAtPoint(
  relation: CharacterRelation,
  orderedEvents: TimelineEvent[],
  pointEventId?: string
): ResolvedRelationState {
  const orderMap = new Map<string, number>();
  orderedEvents.forEach((ev, idx) => {
    orderMap.set(ev.id, idx);
  });

  const phases = relation.phases || [];
  if (phases.length === 0) {
    return { relation, activePhase: null, changedAtCurrentEvent: false };
  }

  // Sort phases chronologically: initial phases (-1) first, then by event index
  const ranked = phases
    .map((p, origIdx) => ({
      phase: p,
      rank: p.fromEventId && orderMap.has(p.fromEventId) ? orderMap.get(p.fromEventId)! : -1,
      origIdx,
    }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.origIdx - b.origIdx));

  if (pointEventId === INITIAL_STORY_POINT) {
    const initialOnes = ranked.filter((r) => r.rank === -1);
    const activePhase = initialOnes.length > 0 ? initialOnes[initialOnes.length - 1].phase : null;
    return { relation, activePhase, changedAtCurrentEvent: false };
  }

  const targetRank =
    pointEventId && orderMap.has(pointEventId) ? orderMap.get(pointEventId)! : Number.MAX_SAFE_INTEGER;

  const eligible = ranked.filter((r) => r.rank <= targetRank);
  if (eligible.length === 0) {
    return { relation, activePhase: null, changedAtCurrentEvent: false };
  }

  const latest = eligible[eligible.length - 1];
  const prev = eligible.length >= 2 ? eligible[eligible.length - 2] : undefined;
  const changedAtCurrentEvent = Boolean(
    pointEventId && latest.phase.fromEventId === pointEventId
  );

  return {
    relation,
    activePhase: latest.phase,
    previousPhase: changedAtCurrentEvent ? prev?.phase : undefined,
    changedAtCurrentEvent,
  };
}

export function getEventsUpToPoint(
  orderedEvents: TimelineEvent[],
  pointEventId?: string
): TimelineEvent[] {
  if (pointEventId === INITIAL_STORY_POINT) return [];
  if (!pointEventId) return orderedEvents;
  const idx = orderedEvents.findIndex((e) => e.id === pointEventId);
  // 锚点事件已不存在时必须失败关闭：早先返回全部事件会把后续剧情泄露给模型
  if (idx === -1) return [];
  return orderedEvents.slice(0, idx + 1);
}
