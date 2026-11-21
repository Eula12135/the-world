import { describe, expect, it } from 'vitest';
import {
  getEventsUpToPoint,
  INITIAL_STORY_POINT,
  resolveRelationAtPoint,
  sortEventsChronologically,
} from '../services/temporalGraph';
import type { CharacterRelation, TimelineEvent } from '../types';

const events: TimelineEvent[] = [
  {
    id: 'ev1',
    worldId: 'w1',
    timeLabel: '第1年',
    title: '并肩作战',
    details: '共同抵御外敌',
    characterIds: ['c1', 'c2'],
    orderIndex: 10,
    updatedAt: 1,
  },
  {
    id: 'ev2',
    worldId: 'w1',
    timeLabel: '第3年',
    title: '背叛之夜',
    details: '核心机密泄露',
    characterIds: ['c1', 'c2'],
    orderIndex: 20,
    updatedAt: 1,
  },
  {
    id: 'ev3',
    worldId: 'w1',
    timeLabel: '第5年',
    title: '冰释前嫌',
    details: '联手对抗共同威胁',
    characterIds: ['c1', 'c2'],
    orderIndex: 30,
    updatedAt: 1,
  },
];

const relation: CharacterRelation = {
  id: 'r1',
  worldId: 'w1',
  sourceId: 'c1',
  targetId: 'c2',
  directed: false,
  phases: [
    { id: 'p0', type: 'friend', label: '好友', strength: 2, description: '同窗旧识' },
    {
      id: 'p2',
      fromEventId: 'ev2',
      type: 'hostile',
      label: '敌对',
      strength: 3,
      description: '因背叛反目成仇',
    },
    {
      id: 'p3',
      fromEventId: 'ev3',
      type: 'ally',
      label: '暂定同盟',
      strength: 2,
      description: '暂搁旧怨',
    },
  ],
  updatedAt: 1,
};

describe('temporalGraph', () => {
  it('resolves different relationship phases across timeline checkpoints', () => {
    const ordered = sortEventsChronologically(events);

    const atInit = resolveRelationAtPoint(relation, ordered, INITIAL_STORY_POINT);
    expect(atInit.activePhase?.label).toBe('好友');
    expect(atInit.changedAtCurrentEvent).toBe(false);

    const atEv1 = resolveRelationAtPoint(relation, ordered, 'ev1');
    expect(atEv1.activePhase?.label).toBe('好友');
    expect(atEv1.changedAtCurrentEvent).toBe(false);

    const atEv2 = resolveRelationAtPoint(relation, ordered, 'ev2');
    expect(atEv2.activePhase?.type).toBe('hostile');
    expect(atEv2.activePhase?.label).toBe('敌对');
    expect(atEv2.changedAtCurrentEvent).toBe(true);
    expect(atEv2.previousPhase?.label).toBe('好友');

    const atEv3 = resolveRelationAtPoint(relation, ordered, 'ev3');
    expect(atEv3.activePhase?.label).toBe('暂定同盟');
    expect(atEv3.changedAtCurrentEvent).toBe(true);
    expect(atEv3.previousPhase?.label).toBe('敌对');

    const atLatest = resolveRelationAtPoint(relation, ordered, undefined);
    expect(atLatest.activePhase?.label).toBe('暂定同盟');
  });

  it('filters visible timeline events up to target story point (anti-spoiler)', () => {
    const ordered = sortEventsChronologically(events);
    expect(getEventsUpToPoint(ordered, INITIAL_STORY_POINT)).toHaveLength(0);
    expect(getEventsUpToPoint(ordered, 'ev1').map((e) => e.id)).toEqual(['ev1']);
    expect(getEventsUpToPoint(ordered, 'ev2').map((e) => e.id)).toEqual(['ev1', 'ev2']);
    expect(getEventsUpToPoint(ordered, undefined)).toHaveLength(3);
  });
});
