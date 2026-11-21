import { describe, expect, it } from 'vitest';
import { buildSessionSystemPrompt, estimateTokens } from '../services/contextBuilder';
import { getRecommendedTemplateId, parseDocumentSections } from '../data/worldTemplates';
import { DEFAULT_SETTINGS } from '../db/database';
import type { Character, CharacterRelation, TimelineEvent, WorldProject } from '../types';

const sampleDoc = `## 一、世界概述
双星系统边缘的殖民空间站。

## 二、科技边界
没有超光速引擎，星际通讯存在数年延迟。

## 三、势力格局
深空港务局与自由矿工同盟互相制衡。

## 四、宗教与习俗
星海教会每年冬至举行巡礼仪式。

## 五、禁忌规则
严禁在主反应堆附近开启电磁屏蔽。`;

const baseWorld: WorldProject = {
  id: 'w1',
  name: '星海余烬',
  genre: '科幻',
  document: sampleDoc,
  contextMode: 'progressive',
  pinnedSections: ['五、禁忌规则'],
  selectedSections: [],
  includeCharacters: true,
  includeTimeline: true,
  createdAt: 1,
  updatedAt: 1,
};

describe('worldTemplates & parseDocumentSections', () => {
  it('parses markdown ## headings and recommends templates by genre', () => {
    const sections = parseDocumentSections(sampleDoc);
    expect(sections).toHaveLength(5);
    expect(getRecommendedTemplateId('科幻')).toBe('scifi');
    expect(getRecommendedTemplateId('仙侠')).toBe('xianxia');
    expect(getRecommendedTemplateId('悬疑')).toBe('mystery');
  });
});

describe('buildSessionSystemPrompt (progressive disclosure + temporal + rolling summary)', () => {
  it('returns base prompt + rolling summary even without bound world', () => {
    const res = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        enableWorldContext: false,
        rollingSummary: '主角已抵达第三空间站。',
      },
      world: baseWorld,
    });
    expect(res.stats.mode).toBe('none');
    expect(res.stats.hasRollingSummary).toBe(true);
    expect(res.prompt).toContain('主角已抵达第三空间站');
  });

  it('progressively discloses pinned + query-matched sections while keeping TOC index', () => {
    const res = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: { enableWorldContext: true },
      world: baseWorld,
      draftInput: '请写一段星海教会冬至巡礼仪式的场面',
    });

    expect(res.stats.mode).toBe('progressive');
    // Pinned section + matched section
    expect(res.stats.includedSections).toContain('五、禁忌规则');
    expect(res.stats.includedSections).toContain('四、宗教与习俗');
    expect(res.stats.omittedSections.length).toBeGreaterThan(0);
    // Catalog index still lists omitted headings briefly
    expect(res.prompt).toContain('全书设定目录索引');
    expect(res.prompt).toContain('二、科技边界');
    expect(res.stats.estimatedTokens).toBeGreaterThan(0);
  });

  it('respects storyPointEventId for anti-spoiler events and temporal relation resolution', () => {
    const characters: Character[] = [
      {
        id: 'c1',
        worldId: 'w1',
        name: '陈默',
        identity: '领航员',
        personality: '沉稳',
        status: '',
        relationsNote: '',
        notes: '',
        avatarColor: '#4d6bfe',
        updatedAt: 1,
      },
      {
        id: 'c2',
        worldId: 'w1',
        name: '苏岚',
        identity: '轮机长',
        personality: '果敢',
        status: '',
        relationsNote: '',
        notes: '',
        avatarColor: '#10b981',
        updatedAt: 1,
      },
    ];
    const events: TimelineEvent[] = [
      {
        id: 'ev1',
        worldId: 'w1',
        timeLabel: '第1年',
        title: '初遇航线',
        details: '共同出航',
        characterIds: ['c1', 'c2'],
        orderIndex: 10,
        updatedAt: 1,
      },
      {
        id: 'ev2',
        worldId: 'w1',
        timeLabel: '第4年',
        title: '反应堆事件',
        details: '产生路线分歧',
        characterIds: ['c1', 'c2'],
        orderIndex: 20,
        updatedAt: 1,
      },
    ];
    const relations: CharacterRelation[] = [
      {
        id: 'r1',
        worldId: 'w1',
        sourceId: 'c1',
        targetId: 'c2',
        directed: false,
        phases: [
          { id: 'p0', type: 'friend', label: '挚友', strength: 3, description: '生死之交' },
          {
            id: 'p2',
            fromEventId: 'ev2',
            type: 'hostile',
            label: '决裂敌对',
            strength: 3,
            description: '理念彻底背离',
          },
        ],
        updatedAt: 1,
      },
    ];

    const atEv1 = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: { enableWorldContext: true, storyPointEventId: 'ev1' },
      world: baseWorld,
      characters,
      relations,
      events,
    });
    expect(atEv1.prompt).toContain('挚友');
    expect(atEv1.prompt).not.toContain('决裂敌裂');
    expect(atEv1.prompt).not.toContain('反应堆事件');

    const atEv2 = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: { enableWorldContext: true, storyPointEventId: 'ev2' },
      world: baseWorld,
      characters,
      relations,
      events,
    });
    expect(atEv2.prompt).toContain('决裂敌对');
    expect(atEv2.prompt).toContain('刚由「挚友」转变');
    expect(atEv2.prompt).toContain('反应堆事件');
  });

  it('estimates tokens and truncates when exceeding budget', () => {
    expect(estimateTokens('测试文本abc')).toBeGreaterThan(3);
    const res = buildSessionSystemPrompt({
      settings: { ...DEFAULT_SETTINGS, maxWorldContextChars: 1000 },
      session: { enableWorldContext: true },
      world: {
        ...baseWorld,
        contextMode: 'full',
        document: `## 长设定\n${'内容'.repeat(2000)}`,
      },
    });
    expect(res.stats.truncated).toBe(true);
    expect(res.prompt).toContain('自动截断');
  });

  it('supports >15k chars under default 100k limit and unlimited mode when maxWorldContextChars is 0', () => {
    const doc16k = `## 大型世界观\n${'山河远阔，风云际会。'.repeat(1600)}`;
    const defaultRes = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: { enableWorldContext: true },
      world: {
        ...baseWorld,
        contextMode: 'full',
        document: doc16k,
      },
    });
    expect(defaultRes.stats.truncated).toBe(false);
    expect(defaultRes.stats.charCount).toBeGreaterThan(15000);

    const doc200k = `## 超长设定集\n${'文字设定记录。'.repeat(30000)}`;
    const unlimitedRes = buildSessionSystemPrompt({
      settings: { ...DEFAULT_SETTINGS, maxWorldContextChars: 0 },
      session: { enableWorldContext: true },
      world: {
        ...baseWorld,
        contextMode: 'full',
        document: doc200k,
      },
    });
    expect(unlimitedRes.stats.truncated).toBe(false);
    expect(unlimitedRes.stats.charCount).toBeGreaterThan(200000);
  });

  it('supports custom_persona (without AI assistant prefix) and character_role prompts', () => {
    const personaRes = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        chatMode: 'custom_persona',
        systemPromptOverride: '你是隐居山林的古剑守护者，说话冷淡简短。',
        enableWorldContext: false,
      },
    });
    expect(personaRes.prompt).toContain('隐居山林的古剑守护者');
    expect(personaRes.prompt).not.toContain('AI 助手');

    const characters: Character[] = [
      {
        id: 'c1',
        worldId: 'w1',
        name: '林澈',
        identity: '星海领航员',
        personality: '冷静克制',
        status: '驻守前哨站',
        relationsNote: '',
        notes: '左腕有旧伤',
        avatarColor: '#4d6bfe',
        updatedAt: 1,
      },
      {
        id: 'c2',
        worldId: 'w1',
        name: '苏岚',
        identity: '轮机长',
        personality: '果敢',
        status: '',
        relationsNote: '',
        notes: '',
        avatarColor: '#10b981',
        updatedAt: 1,
      },
    ];
    const events: TimelineEvent[] = [
      {
        id: 'ev1',
        worldId: 'w1',
        timeLabel: '第1年',
        title: '反应堆事故',
        details: '各自抉择',
        characterIds: ['c1', 'c2'],
        orderIndex: 10,
        updatedAt: 1,
      },
    ];
    const relations: CharacterRelation[] = [
      {
        id: 'r1',
        worldId: 'w1',
        sourceId: 'c1',
        targetId: 'c2',
        directed: false,
        phases: [
          { id: 'p0', type: 'friend', label: '挚友', strength: 3, description: '共度危机' },
          {
            id: 'p1',
            fromEventId: 'ev1',
            type: 'hostile',
            label: '疏离敌对',
            strength: 2,
            description: '立场分裂',
          },
        ],
        updatedAt: 1,
      },
    ];

    const roleRes = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        chatMode: 'character_role',
        roleCharacterId: 'c1',
        storyPointEventId: 'ev1',
        enableWorldContext: false,
        systemPromptOverride: '此时你正在修理导航仪',
      },
      world: baseWorld,
      characters,
      relations,
      events,
    });
    expect(roleRes.prompt).toContain('以角色「林澈」的第一人称身份');
    expect(roleRes.prompt).toContain('冷静克制');
    expect(roleRes.prompt).toContain('对 苏岚：疏离敌对');
    expect(roleRes.prompt).toContain('此时你正在修理导航仪');
    expect(roleRes.prompt).not.toContain('清晰、理性且富有洞察力的 AI 助手');
  });
});
