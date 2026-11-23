import { describe, expect, it } from 'vitest';
import {
  buildRoleCharacterPrompt,
  buildSessionSystemPrompt,
  estimateTokens,
} from '../services/contextBuilder';
import { getRecommendedTemplateId, parseDocumentSections, PREAMBLE_HEADING } from '../data/worldTemplates';
import { DEFAULT_SETTINGS } from '../db/database';
import type {
  Character,
  CharacterRelation,
  TimelineEvent,
  UserPersona,
  WorldProject,
} from '../types';

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

  it('keeps content before the first heading instead of silently dropping it', () => {
    const doc = `星海余烬 · 卷一
本书讲述双星系统边缘一座殖民空间站的兴衰。

## 一、世界概述
空间站漂浮在拉格朗日点，靠采集恒星风维持运转。`;

    const sections = parseDocumentSections(doc);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe(PREAMBLE_HEADING);
    expect(sections[0].body).toContain('双星系统边缘');
    expect(sections[0].charCount).toBe(sections[0].body.length);
    expect(sections[1].heading).toBe('一、世界概述');
  });

  it('treats single-hash headings as sections and keeps deeper ones as body', () => {
    const sections = parseDocumentSections(
      `# 世界概述
概述正文

### 一个三级小标题
三级标题下的正文

## 一、势力格局
势力正文`
    );

    expect(sections.map((s) => s.heading)).toEqual(['世界概述', '一、势力格局']);
    expect(sections[0].body).toContain('### 一个三级小标题');
    expect(sections[0].body).toContain('三级标题下的正文');
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
    expect(atEv1.prompt).not.toContain('决裂敌对');
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

  it('omits character relations when includeCharacters is false and handles stale selectedSections in full mode', () => {
    const characters: Character[] = [
      {
        id: 'c1',
        worldId: 'w1',
        name: '林澈',
        identity: '船长',
        personality: '',
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
        personality: '',
        status: '',
        relationsNote: '',
        notes: '',
        avatarColor: '#10b981',
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
        phases: [{ id: 'p0', type: 'friend', label: '挚友', strength: 2, description: '' }],
        updatedAt: 1,
      },
    ];

    const noCharsRes = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: { enableWorldContext: true },
      world: { ...baseWorld, includeCharacters: false },
      characters,
      relations,
      events: [],
    });
    expect(noCharsRes.prompt).not.toContain('当前时间点人物关系网');

    const staleSelectedRes = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: { enableWorldContext: true },
      world: {
        ...baseWorld,
        contextMode: 'full',
        selectedSections: ['已删除的旧章节名'],
      },
      characters: [],
      relations: [],
      events: [],
    });
    expect(staleSelectedRes.prompt).toContain('一、世界概述');
    expect(staleSelectedRes.prompt).toContain('五、禁忌规则');
  });

  it('uses character.systemPrompt directly for standalone or tool-style character cards', () => {
    const standaloneToolChar: Character = {
      id: 'c-tool',
      worldId: '',
      name: '双语润色编辑',
      identity: '翻译与润色助手',
      personality: '',
      status: '',
      relationsNote: '',
      notes: '',
      systemPrompt: '你是专业的中英小说双语润色编辑，请保留文学质感。',
      avatarColor: '#4d6bfe',
      updatedAt: 1,
    };

    const directPrompt = buildRoleCharacterPrompt({
      character: standaloneToolChar,
      world: null,
      relations: [],
      characters: [standaloneToolChar],
      orderedEvents: [],
      extraInstruction: '优先检查节奏拖沓问题',
    });

    expect(directPrompt).toContain('你是专业的中英小说双语润色编辑，请保留文学质感。');
    expect(directPrompt).toContain('优先检查节奏拖沓问题');
    expect(directPrompt).not.toContain('第一人称身份');

    const sessionRes = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        chatMode: 'character_role',
        roleCharacterId: 'c-tool',
        enableWorldContext: false,
      },
      world: null,
      characters: [standaloneToolChar],
      relations: [],
      events: [],
    });

    expect(sessionRes.prompt).toContain('你是专业的中英小说双语润色编辑');
    expect(sessionRes.prompt).not.toContain('清晰、理性且富有洞察力的 AI 助手');
  });
});

describe('「我」的提示词注入', () => {
  const linChe: Character = {
    id: 'c1',
    worldId: 'w1',
    name: '林澈',
    identity: '星海领航员',
    personality: '冷静克制',
    status: '',
    relationsNote: '',
    notes: '',
    avatarColor: '#4d6bfe',
    updatedAt: 1,
    userRelation: {
      defaultAddress: '旅人',
      defaultRelationLabel: '点头之交',
      defaultRelationDesc: '在渡口见过几面',
    },
  };
  const shenLan: Character = {
    id: 'c2',
    worldId: 'w1',
    name: '沈岚',
    identity: '剑修',
    personality: '',
    status: '',
    relationsNote: '',
    notes: '',
    avatarColor: '#8b5cf6',
    updatedAt: 1,
  };
  const xiaoChe: UserPersona = {
    id: 'p1',
    name: '小澈',
    addressAs: '',
    aliases: '阿澈',
    identity: '大学同学',
    description: '摄影社的',
    avatarColor: '#10b981',
    createdAt: 1,
    updatedAt: 1,
  };

  it('注入身份、关系与硬约束，并把称呼写进开场句', () => {
    const res = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        chatMode: 'character_role',
        roleCharacterId: 'c1',
        enableWorldContext: false,
        userIdentity: { kind: 'persona', id: 'p1' },
      },
      world: null,
      characters: [linChe],
      relations: [],
      events: [],
      personas: [xiaoChe],
    });

    expect(res.prompt).toContain('【关于"我"（正在与你对话的人）】');
    // 自建身份的 addressAs 留空 → 落到角色卡的 defaultAddress
    expect(res.prompt).toContain('称呼：旅人');
    expect(res.prompt).toContain('姓名：小澈');
    expect(res.prompt).toContain('其他叫法：阿澈');
    expect(res.prompt).toContain('身份：大学同学');
    expect(res.prompt).toContain('【你我关系】');
    expect(res.prompt).toContain('- 点头之交 — 在渡口见过几面');
    expect(res.prompt).toContain('【扮演约束】');
    expect(res.prompt).toContain('不要自行编造用户的姓名、外貌、身份或经历');
    expect(res.prompt).toContain('不要替用户描写动作、对话或心理活动');
    expect(res.prompt).toContain('和「旅人」对话');
  });

  it('自建身份自填的称呼压过角色卡默认值', () => {
    const res = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        chatMode: 'character_role',
        roleCharacterId: 'c1',
        enableWorldContext: false,
        userIdentity: { kind: 'persona', id: 'p1' },
      },
      world: null,
      characters: [linChe],
      relations: [],
      events: [],
      personas: [{ ...xiaoChe, addressAs: '阿澈' }],
    });

    expect(res.prompt).toContain('称呼：阿澈');
    expect(res.prompt).toContain('和「阿澈」对话');
  });

  it('未选身份时提示词与改动前一致', () => {
    const res = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        chatMode: 'character_role',
        roleCharacterId: 'c1',
        enableWorldContext: false,
      },
      world: null,
      characters: [linChe],
      relations: [],
      events: [],
      personas: [xiaoChe],
    });

    expect(res.prompt).not.toContain('【关于"我"');
    expect(res.prompt).not.toContain('【扮演约束】');
    expect(res.prompt).not.toContain('【你我关系】');
    expect(res.prompt).toContain('和用户对话');
  });

  it('双卡对戏时关系只注入一次（开世界上下文也不重复）', () => {
    const relations: CharacterRelation[] = [
      {
        id: 'r1',
        worldId: 'w1',
        sourceId: 'c1',
        targetId: 'c2',
        directed: true,
        phases: [
          { id: 'ph1', type: 'hostile', label: '死敌', strength: 2, description: '争同一把剑' },
        ],
        updatedAt: 1,
      },
    ];

    const res = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        chatMode: 'character_role',
        roleCharacterId: 'c1',
        enableWorldContext: true,
        userIdentity: { kind: 'character', id: 'c2' },
      },
      world: baseWorld,
      characters: [linChe, shenLan],
      relations,
      events: [],
      personas: [],
    });

    expect(res.prompt).toContain('【你我关系】');
    expect(res.prompt.match(/死敌/g) || []).toHaveLength(1);
  });

  it('通用助手与自定义人设不注入身份', () => {
    const assistant = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        chatMode: 'assistant',
        enableWorldContext: false,
        userIdentity: { kind: 'persona', id: 'p1' },
      },
      personas: [xiaoChe],
    });
    expect(assistant.prompt).not.toContain('【关于"我"');

    const custom = buildSessionSystemPrompt({
      settings: DEFAULT_SETTINGS,
      session: {
        chatMode: 'custom_persona',
        systemPromptOverride: '你是一位古剑守护者',
        enableWorldContext: false,
        userIdentity: { kind: 'persona', id: 'p1' },
      },
      personas: [xiaoChe],
    });
    expect(custom.prompt).not.toContain('【关于"我"');
  });
});
