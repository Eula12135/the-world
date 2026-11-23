import type {
  AppSettings,
  Character,
  CharacterRelation,
  ChatMessage,
  ChatSession,
  ResolvedUserIdentity,
  TimelineEvent,
  UserPersona,
  WorldProject,
} from '../types';
import { parseDocumentSections, type DocSection } from '../data/worldTemplates';
import {
  getEventsUpToPoint,
  INITIAL_STORY_POINT,
  RELATION_TYPE_META,
  resolveRelationAtPoint,
  sortEventsChronologically,
} from './temporalGraph';
import {
  resolveSessionUserRelation,
  resolveUserAddress,
  resolveUserIdentity,
  type ResolvedUserRelation,
} from './userIdentity';

export interface ContextBuildStats {
  worldName?: string;
  mode: 'progressive' | 'full' | 'none';
  includedSections: string[];
  omittedSections: string[];
  totalSections: number;
  characterCount: number;
  relationCount: number;
  eventCount: number;
  hasRollingSummary: boolean;
  charCount: number;
  estimatedTokens: number;
  truncated: boolean;
}

export interface ContextBuildResult {
  prompt: string;
  stats: ContextBuildStats;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 1.3 + other / 3.5);
}

function extractBigrams(text: string): Set<string> {
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const grams = new Set<string>();
  for (const token of clean.split(/\s+/)) {
    if (!token) continue;
    if (token.length >= 2) grams.add(token);
    for (let i = 0; i < token.length - 1; i++) {
      grams.add(token.slice(i, i + 2));
    }
  }
  return grams;
}

function scoreSectionRelevance(section: DocSection, queryGrams: Set<string>, rawQuery: string): number {
  if (queryGrams.size === 0) return 0;
  let score = 0;
  const headingLower = section.heading.toLowerCase();
  const bodyLower = section.body.toLowerCase();
  const qLower = rawQuery.toLowerCase();

  // Direct title mention gets top priority
  const cleanHeading = headingLower.replace(/^[一二三四五六七八九十百0-9]+[、.\s]*/, '');
  if (cleanHeading.length >= 2 && qLower.includes(cleanHeading)) {
    score += 25;
  }

  for (const gram of queryGrams) {
    if (headingLower.includes(gram)) score += 4;
    else if (bodyLower.includes(gram)) score += 1;
  }
  return score;
}

/**
 * 「我」的提示词块。identity 为空时不产出任何内容，
 * 以保证未启用该功能的会话提示词逐字节不变。
 */
export function buildUserBlock(params: {
  identity?: ResolvedUserIdentity | null;
  relation?: ResolvedUserRelation | null;
  address?: string;
}): string {
  const { identity, relation } = params;
  if (!identity) return '';

  const address = (params.address || '').trim();
  const callName = address || identity.name;

  const lines = ['【关于"我"（正在与你对话的人）】', `- 称呼：${callName}`];
  if (address && address !== identity.name) lines.push(`- 姓名：${identity.name}`);
  if (identity.aliases) lines.push(`- 其他叫法：${identity.aliases}`);
  if (identity.identity) lines.push(`- 身份：${identity.identity}`);
  if (identity.description) lines.push(`- 人设：${identity.description}`);

  const blocks = [lines.join('\n')];

  const relationLabel = (relation?.label || '').trim();
  const relationDesc = (relation?.description || '').trim();
  if (relationLabel || relationDesc) {
    const detail = relationLabel
      ? `- ${relationLabel}${relationDesc ? ` — ${relationDesc}` : ''}`
      : `- ${relationDesc}`;
    blocks.push(`【你我关系】\n${detail}`);
  }

  blocks.push(
    [
      '【扮演约束】',
      '- 不要自行编造用户的姓名、外貌、身份或经历；不确定时以角色口吻直接问。',
      '- 不要替用户描写动作、对话或心理活动。',
    ].join('\n')
  );

  return blocks.join('\n\n');
}

export function buildRoleCharacterPrompt(params: {
  character: Character;
  world?: WorldProject | null;
  relations: CharacterRelation[];
  characters: Character[];
  orderedEvents: TimelineEvent[];
  pointEventId?: string;
  extraInstruction?: string;
  userIdentity?: ResolvedUserIdentity | null;
  userRelation?: ResolvedUserRelation | null;
  userAddress?: string;
}): string {
  const {
    character,
    world,
    relations,
    characters,
    orderedEvents,
    pointEventId,
    extraInstruction,
    userIdentity,
    userRelation,
    userAddress,
  } = params;
  const charMap = new Map(characters.map((c) => [c.id, c.name]));
  const customPrompt = character.systemPrompt?.trim();
  const lines: string[] = [];
  // 没有「我」时保持原文「和用户对话」，确保既有提示词逐字节不变
  const addressee = userIdentity
    ? `「${(userAddress || '').trim() || userIdentity.name}」`
    : '用户';

  if (customPrompt) {
    lines.push(customPrompt);
  } else {
    lines.push(
      `请直接以角色「${character.name}」的第一人称身份、视角与口吻和${addressee}对话${
        world ? `（所属作品：《${world.name}》${world.genre ? ` · ${world.genre}` : ''}）` : ''
      }。除非用户在正文中要求跳出视角，否则不要以“AI助手”口吻自称或说教。`
    );
    // 动作/神态写进括号，朗读时才能被正确剥离；否则模型常把旁白写成裸行，
    // 「意味深长地笑」这种动作就会被当成台词念出来。
    lines.push(
      '【输出格式】\n动作、神态、心理与环境描写一律写在全角括号（）内；括号外只写角色说出口的台词，不要在括号外写旁白。'
    );

    const profile: string[] = [];
    if (character.identity) profile.push(`- 身份定位：${character.identity}`);
    if (character.personality) profile.push(`- 性格特点：${character.personality}`);
    if (character.status) profile.push(`- 当前状态：${character.status}`);
    if (character.relationsNote) profile.push(`- 关系简记：${character.relationsNote}`);
    if (character.notes) profile.push(`- 补充细节：${character.notes}`);

    if (profile.length > 0) {
      lines.push('【你的角色档案】\n' + profile.join('\n'));
    }
  }

  const userBlock = buildUserBlock({
    identity: userIdentity,
    relation: userRelation,
    address: userAddress,
  });
  if (userBlock) lines.push(userBlock);

  // 「AI 角色 ↔ 我」这条边统一交给【你我关系】表达，
  // 否则同一条关系会被注入两次，甚至前后矛盾。
  const userCharacterId =
    userIdentity?.kind === 'character' ? userIdentity.sourceId : undefined;
  const roleRelations = relations.filter((r) => {
    if (r.sourceId !== character.id && r.targetId !== character.id) return false;
    if (!userCharacterId) return true;
    const touchesUser =
      (r.sourceId === character.id && r.targetId === userCharacterId) ||
      (r.targetId === character.id && r.sourceId === userCharacterId);
    return !touchesUser;
  });
  if (roleRelations.length > 0) {
    const relLines: string[] = [];
    for (const rel of roleRelations) {
      const resolved = resolveRelationAtPoint(rel, orderedEvents, pointEventId);
      if (!resolved.activePhase) continue;
      const otherId = rel.sourceId === character.id ? rel.targetId : rel.sourceId;
      const otherName = charMap.get(otherId) || '其他角色';
      const typeLabel = RELATION_TYPE_META[resolved.activePhase.type]?.label || '关联';
      const tag = resolved.activePhase.label || typeLabel;
      const desc = resolved.activePhase.description ? `：${resolved.activePhase.description}` : '';
      relLines.push(`- 对 ${otherName}：${tag}${desc}`);
    }
    if (relLines.length > 0) {
      lines.push('【你当前时间点的人物关系认知】\n' + relLines.join('\n'));
    }
  }

  if (extraInstruction?.trim()) {
    lines.push(`【补充情境与要求】\n${extraInstruction.trim()}`);
  }

  return lines.join('\n\n');
}

export function buildSessionSystemPrompt(params: {
  settings: AppSettings;
  session?: Pick<
    ChatSession,
    | 'enableWorldContext'
    | 'systemPromptOverride'
    | 'storyPointEventId'
    | 'rollingSummary'
    | 'chatMode'
    | 'roleCharacterId'
    | 'userIdentity'
    | 'userRelationOverride'
  > | null;
  world?: WorldProject | null;
  characters?: Character[];
  relations?: CharacterRelation[];
  events?: TimelineEvent[];
  personas?: UserPersona[];
  recentMessages?: ChatMessage[];
  draftInput?: string;
}): ContextBuildResult {
  const {
    settings,
    session,
    world,
    characters = [],
    relations = [],
    events = [],
    personas = [],
    recentMessages = [],
    draftInput = '',
  } = params;

  const chatMode = session?.chatMode || 'assistant';
  const orderedEvents = sortEventsChronologically(events);
  const pointEventId = session?.storyPointEventId;
  const roleCharacter =
    chatMode === 'character_role' && session?.roleCharacterId
      ? characters.find((c) => c.id === session.roleCharacterId)
      : undefined;

  // 「我」只在角色对话里生效：其余模式没有选身份的入口，注入了用户也改不了。
  const isRoleMode = chatMode === 'character_role' && Boolean(roleCharacter);
  const userIdentity = isRoleMode
    ? resolveUserIdentity(session?.userIdentity, personas, characters)
    : null;
  const userRelation =
    isRoleMode && userIdentity
      ? resolveSessionUserRelation({
          roleCharacter,
          userIdentity: session?.userIdentity,
          override: session?.userRelationOverride,
          characters,
          relations,
          events: orderedEvents,
          pointEventId,
        })
      : null;
  const userAddress = isRoleMode
    ? resolveUserAddress({
        identity: userIdentity,
        roleCharacter,
        override: session?.userRelationOverride,
      })
    : '';

  let basePrompt = '';
  if (chatMode === 'custom_persona') {
    basePrompt = (session?.systemPromptOverride?.trim() || '').trim();
  } else if (chatMode === 'character_role' && roleCharacter) {
    basePrompt = buildRoleCharacterPrompt({
      character: roleCharacter,
      world,
      relations,
      characters,
      orderedEvents,
      pointEventId,
      extraInstruction: session?.systemPromptOverride,
      userIdentity,
      userRelation,
      userAddress,
    });
  } else {
    basePrompt = (session?.systemPromptOverride?.trim() || settings.globalSystemPrompt || '').trim();
  }

  const rollingSummary = session?.rollingSummary?.trim() || '';

  if (!session?.enableWorldContext || !world) {
    const parts = [basePrompt];
    if (rollingSummary) {
      parts.push(`【前情记忆摘要（早期对话已浓缩）】\n${rollingSummary}`);
    }
    const prompt = parts.filter(Boolean).join('\n\n');
    return {
      prompt,
      stats: {
        mode: 'none',
        includedSections: [],
        omittedSections: [],
        totalSections: 0,
        characterCount: roleCharacter ? 1 : 0,
        relationCount: 0,
        eventCount: 0,
        hasRollingSummary: Boolean(rollingSummary),
        charCount: prompt.length,
        estimatedTokens: estimateTokens(prompt),
        truncated: false,
      },
    };
  }

  const contextMode = world.contextMode || 'progressive';
  const allSections = parseDocumentSections(world.document);
  const pinnedSet = new Set(world.pinnedSections || []);
  const queryText = [
    ...recentMessages.slice(-4).map((m) => m.content),
    draftInput,
  ]
    .join('\n')
    .trim();

  let activeSections: DocSection[] = [];
  let omittedSections: DocSection[] = [];

  if (contextMode === 'full' || allSections.length === 0) {
    const selectedSet = new Set(world.selectedSections || []);
    const matched = selectedSet.size > 0
      ? allSections.filter((s) => selectedSet.has(s.heading))
      : [];
    const usePartial = matched.length > 0 && allSections.length > 0;
    activeSections = usePartial ? matched : allSections;
    omittedSections = usePartial
      ? allSections.filter((s) => !selectedSet.has(s.heading))
      : [];
  } else {
    // Progressive Disclosure: pinned sections + top relevant sections by local text matching
    const queryGrams = extractBigrams(queryText);
    const scored = allSections.map((sec, idx) => ({
      sec,
      idx,
      isPinned: pinnedSet.has(sec.heading),
      score: scoreSectionRelevance(sec, queryGrams, queryText),
    }));

    const selectedIndices = new Set<number>();
    scored.forEach((item) => {
      if (item.isPinned) selectedIndices.add(item.idx);
    });

    const unpinnedByScore = scored
      .filter((item) => !item.isPinned && item.score > 0)
      .sort((a, b) => b.score - a.score);

    const maxDynamic = 5;
    for (const item of unpinnedByScore.slice(0, maxDynamic)) {
      selectedIndices.add(item.idx);
    }

    // Fallback: if nothing pinned and no query hit yet, reveal the first 2 overview sections
    if (selectedIndices.size === 0) {
      allSections.slice(0, 2).forEach((_, i) => selectedIndices.add(i));
    }

    activeSections = allSections.filter((_, i) => selectedIndices.has(i));
    omittedSections = allSections.filter((_, i) => !selectedIndices.has(i));
  }

  // Timeline & Temporal Relation Resolution (Anti-Spoiler)
  const visibleEvents = getEventsUpToPoint(orderedEvents, pointEventId);
  const currentPointEvent =
    pointEventId && pointEventId !== INITIAL_STORY_POINT
      ? orderedEvents.find((e) => e.id === pointEventId)
      : undefined;

  const blocks: string[] = [];
  if (basePrompt) blocks.push(basePrompt);

  const anchorDesc =
    pointEventId === INITIAL_STORY_POINT
      ? '故事初始阶段（尚未发生时间线事件）'
      : currentPointEvent
        ? `截止至「${currentPointEvent.timeLabel ? `${currentPointEvent.timeLabel} · ` : ''}${currentPointEvent.title}」（请勿剧透后续事件）`
        : '最新故事进度';

  blocks.push(
    `【当前小说作品：《${world.name}》（题材：${world.genre || '未指定'}）】\n当前创作时间点：${anchorDesc}`
  );

  // Layer 1: Compact TOC Index when progressive disclosure omits sections
  if (allSections.length > 0 && omittedSections.length > 0) {
    const indexLines = ['【全书设定目录索引（仅展示相关章节详情，其余仅列概要以节省上下文）】'];
    for (const s of allSections) {
      const shown = activeSections.some((a) => a.heading === s.heading);
      const preview = s.body.replace(/^>\s*提示：.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 42);
      indexLines.push(`• ${s.heading}${shown ? ' [已展开]' : preview ? `：${preview}...` : ''}`);
    }
    blocks.push(indexLines.join('\n'));
  }

  // Layer 2: Active Sections Content
  const docText =
    activeSections.length > 0
      ? activeSections.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n')
      : world.document.trim();

  if (docText) {
    blocks.push(`【展开的世界观设定】\n${docText}`);
  }

  // Characters (progressive filtering when > 10 characters and query text exists)
  const charMap = new Map(characters.map((c) => [c.id, c.name]));
  let activeChars: Character[] = [];
  if (world.includeCharacters && characters.length > 0) {
    if (contextMode === 'progressive' && characters.length > 10 && queryText) {
      const qLower = queryText.toLowerCase();
      const hit = characters.filter((c) => qLower.includes(c.name.toLowerCase()));
      activeChars = hit.length > 0 ? hit : characters.slice(0, 8);
    } else {
      activeChars = characters;
    }

    const lines = ['【角色卡】'];
    for (const c of activeChars) {
      const head = `• ${c.name}${c.identity ? `（${c.identity}）` : ''}`;
      const details = [
        c.personality && `性格：${c.personality}`,
        c.status && `当前状态：${c.status}`,
        c.relationsNote && `人物关系：${c.relationsNote}`,
        c.notes && `补充：${c.notes}`,
      ]
        .filter(Boolean)
        .join('｜');
      lines.push(details ? `${head}：${details}` : head);
    }
    blocks.push(lines.join('\n'));
  }

  // Temporal Character Relations
  let includedRelations = 0;
  if (world.includeCharacters && relations.length > 0) {
    const activeCharIds = new Set(activeChars.map((c) => c.id));
    const lines: string[] = [];
    for (const rel of relations) {
      // 与【你我关系】重复的那条边在这里也跳过：
      // 只改角色提示词那一处会漏，开了世界上下文照样把旧关系塞进去。
      if (
        userIdentity?.kind === 'character' &&
        roleCharacter &&
        ((rel.sourceId === roleCharacter.id && rel.targetId === userIdentity.sourceId) ||
          (rel.targetId === roleCharacter.id && rel.sourceId === userIdentity.sourceId))
      ) {
        continue;
      }
      if (
        contextMode === 'progressive' &&
        activeCharIds.size > 0 &&
        !activeCharIds.has(rel.sourceId) &&
        !activeCharIds.has(rel.targetId)
      ) {
        continue;
      }
      const resolved = resolveRelationAtPoint(rel, orderedEvents, pointEventId);
      if (!resolved.activePhase) continue;
      includedRelations += 1;
      const src = charMap.get(rel.sourceId) || '未知角色';
      const dst = charMap.get(rel.targetId) || '未知角色';
      const arrow = rel.directed ? '→' : '↔';
      const typeLabel = RELATION_TYPE_META[resolved.activePhase.type]?.label || '关联';
      const tag = resolved.activePhase.label || typeLabel;
      const turnNote =
        resolved.changedAtCurrentEvent && resolved.previousPhase
          ? ` [刚由「${resolved.previousPhase.label}」转变]`
          : '';
      const desc = resolved.activePhase.description ? `：${resolved.activePhase.description}` : '';
      lines.push(`• ${src} —[${tag}]${arrow} ${dst}${turnNote}${desc}`);
    }
    if (lines.length > 0) {
      blocks.push(`【当前时间点人物关系网】\n${lines.join('\n')}`);
    }
  }

  // Timeline Events (filtered up to storyPointEventId)
  let includedEvents = 0;
  if (world.includeTimeline && visibleEvents.length > 0) {
    const slicedEvents =
      contextMode === 'progressive' && visibleEvents.length > 20
        ? visibleEvents.slice(-20)
        : visibleEvents;
    includedEvents = slicedEvents.length;
    const lines = ['【已发生事件时间线】'];
    for (const ev of slicedEvents) {
      const who = ev.characterIds.map((id) => charMap.get(id)).filter(Boolean).join('、');
      const parts = [
        `• ${ev.timeLabel ? `[${ev.timeLabel}] ` : ''}${ev.title}`,
        ev.details && ev.details.trim(),
        who && `涉及：${who}`,
      ].filter(Boolean);
      lines.push(parts.join(' — '));
    }
    blocks.push(lines.join('\n'));
  }

  // Layer 3: Rolling Summary
  if (rollingSummary) {
    blocks.push(`【前情记忆摘要（早期对话已浓缩）】\n${rollingSummary}`);
  }

  let combined = blocks.join('\n\n');
  const rawLimit = settings.maxWorldContextChars;
  const unlimited = rawLimit === 0;
  const effectiveLimit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.max(1000, rawLimit)
      : 100000;
  const budget = effectiveLimit + basePrompt.length;
  let truncated = false;
  if (!unlimited && combined.length > budget) {
    combined =
      combined.slice(0, budget) +
      '\n\n[...内容已按字数上限自动截断，可在设置中调高上限或设为 0（不限制），亦建议保持「渐进式披露」]';
    truncated = true;
  }

  return {
    prompt: combined,
    stats: {
      worldName: world.name,
      mode: contextMode,
      includedSections: activeSections.map((s) => s.heading),
      omittedSections: omittedSections.map((s) => s.heading),
      totalSections: allSections.length,
      characterCount: activeChars.length,
      relationCount: includedRelations,
      eventCount: includedEvents,
      hasRollingSummary: Boolean(rollingSummary),
      charCount: combined.length,
      estimatedTokens: estimateTokens(combined),
      truncated,
    },
  };
}
