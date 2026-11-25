import { describe, expect, it } from 'vitest';
import {
  PREAMBLE_HEADING,
  parseDocumentSections,
  parseEditableSections,
  serializeEditableSections,
} from '../data/worldTemplates';
import {
  materializeSampleWorldPreset,
  SAMPLE_WORLD_PRESETS,
} from '../data/sampleWorlds';
import {
  INITIAL_STORY_POINT,
  resolveRelationAtPoint,
  sortEventsChronologically,
} from '../services/temporalGraph';

describe('worldTemplates section round-trip', () => {
  it('parses and serializes multi-section markdown documents including preamble', () => {
    const doc = [
      '这是一段写在卷首的总序。',
      '',
      '## 一、世界概述',
      '双月悬空，潮汐受控于古神残响。',
      '',
      '## 二、力量体系',
      '### 1. 灵脉阶位',
      '共分九阶。',
      '',
    ].join('\n');

    const editable = parseEditableSections(doc);
    expect(editable).toHaveLength(3);
    expect(editable[0]).toMatchObject({
      heading: PREAMBLE_HEADING,
      body: '这是一段写在卷首的总序。',
      isPreamble: true,
    });
    expect(editable[1]).toMatchObject({
      heading: '一、世界概述',
      body: '双月悬空，潮汐受控于古神残响。',
      isPreamble: false,
    });
    expect(editable[2]).toMatchObject({
      heading: '二、力量体系',
      body: '### 1. 灵脉阶位\n共分九阶。',
      isPreamble: false,
    });

    const serialized = serializeEditableSections(editable);
    const reparsed = parseDocumentSections(serialized);
    expect(reparsed.map((s) => ({ heading: s.heading, body: s.body }))).toEqual(
      editable.map((s) => ({ heading: s.heading, body: s.body }))
    );
  });

  it('preserves empty sections across round-trip serialization', () => {
    const doc = '## 一、世界设定\n\n## 二、地理版图\n';
    const editable = parseEditableSections(doc);
    expect(editable).toHaveLength(2);
    expect(editable[0].body).toBe('');
    expect(editable[1].body).toBe('');

    const serialized = serializeEditableSections(editable);
    expect(serialized).toBe('## 一、世界设定\n\n## 二、地理版图\n');

    const reparsed = parseDocumentSections(serialized);
    expect(reparsed.map((s) => s.heading)).toEqual(['一、世界设定', '二、地理版图']);
    expect(reparsed.map((s) => s.body)).toEqual(['', '']);
  });

  it('supports reordering, renaming, and adding sections cleanly', () => {
    const initial = parseEditableSections('## 第一章\n内容 A\n\n## 第二章\n内容 B\n');
    const reordered = [
      initial[1],
      { ...initial[0], heading: '序章设定' },
      { id: 'sec-new', heading: '新增附录', body: '补充说明' },
    ];

    const serialized = serializeEditableSections(reordered);
    const reparsed = parseDocumentSections(serialized);
    expect(reparsed.map((s) => ({ heading: s.heading, body: s.body }))).toEqual([
      { heading: '第二章', body: '内容 B' },
      { heading: '序章设定', body: '内容 A' },
      { heading: '新增附录', body: '补充说明' },
    ]);
  });

  it('materializes public-domain sample worlds with valid sections, timeline events, and multi-phase relations', () => {
    expect(SAMPLE_WORLD_PRESETS.length).toBeGreaterThanOrEqual(2);

    for (const preset of SAMPLE_WORLD_PRESETS) {
      const sections = parseDocumentSections(preset.document);
      expect(sections.length).toBeGreaterThanOrEqual(7);
      for (const pinned of preset.pinnedSections) {
        expect(sections.some((s) => s.heading === pinned)).toBe(true);
      }

      const { characters, events, relations } = materializeSampleWorldPreset('world-demo', preset);
      expect(characters.length).toBe(preset.characters.length);
      expect(events.length).toBe(preset.timelineEvents.length);
      expect(relations.length).toBe(preset.relations.length);

      const orderedEvents = sortEventsChronologically(events);
      const charIds = new Set(characters.map((c) => c.id));
      const eventIds = new Set(events.map((e) => e.id));

      for (const ev of events) {
        expect(ev.characterIds.length).toBeGreaterThan(0);
        for (const cid of ev.characterIds) {
          expect(charIds.has(cid)).toBe(true);
        }
      }

      for (const rel of relations) {
        expect(charIds.has(rel.sourceId)).toBe(true);
        expect(charIds.has(rel.targetId)).toBe(true);
        expect(rel.phases.length).toBeGreaterThanOrEqual(2);
        for (const ph of rel.phases) {
          if (ph.fromEventId) {
            expect(eventIds.has(ph.fromEventId)).toBe(true);
          }
        }

        const initialResolved = resolveRelationAtPoint(rel, orderedEvents, INITIAL_STORY_POINT);
        const latestResolved = resolveRelationAtPoint(rel, orderedEvents, undefined);
        expect(initialResolved.activePhase).not.toBeNull();
        expect(latestResolved.activePhase).not.toBeNull();
        expect(latestResolved.activePhase?.label).not.toBe(initialResolved.activePhase?.label);
      }
    }
  });
});
