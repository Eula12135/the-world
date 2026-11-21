import { unzipSync, strFromU8 } from 'fflate';
import type {
  AppSettings,
  Character,
  CharacterRelation,
  ProviderConfig,
  RelationType,
  TimelineEvent,
} from '../types';
import { WORLD_GENRES } from '../data/worldTemplates';
import { createId, detectUnreachableLocalhost } from '../utils/platform';
import { crossPlatformFetchJson, safeJsonParse } from './llm';

const MAX_WORLD_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_DOCX_DOCUMENT_XML_BYTES = 50 * 1024 * 1024;
const EXTRACTION_SNIPPET_LIMIT = 42000;

export function decodeTextBytes(bytes: Uint8Array): { text: string; encoding: string } {
  let raw = '';
  let encoding = 'UTF-8';

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    raw = new TextDecoder('utf-8').decode(bytes.subarray(3));
    encoding = 'UTF-8';
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    raw = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    encoding = 'UTF-16LE';
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    raw = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    encoding = 'UTF-16BE';
  } else {
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      encoding = 'UTF-8';
    } catch {
      try {
        raw = new TextDecoder('gb18030', { fatal: false }).decode(bytes);
        encoding = 'GB18030';
      } catch {
        raw = new TextDecoder('utf-8').decode(bytes);
        encoding = 'UTF-8';
      }
    }
  }

  const normalized = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '');

  return { text: normalized, encoding };
}

export async function readWorldSourceFile(
  file: File
): Promise<{ fileName: string; text: string; encoding: string }> {
  if (file.size > MAX_WORLD_IMPORT_BYTES) {
    throw new Error('文件超过 20MB 上限');
  }
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.docx')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = extractTextFromDocx(bytes);
    if (!text.trim()) {
      throw new Error('未在 Word 文档中读取到正文内容');
    }
    return { fileName: file.name, text, encoding: 'DOCX' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { text, encoding } = decodeTextBytes(bytes);
  if (!text.trim()) {
    throw new Error('文件内容为空');
  }
  return { fileName: file.name, text, encoding };
}

export function extractTextFromDocx(bytes: Uint8Array): string {
  const entries = unzipSync(bytes, {
    filter: (file) => {
      if (file.name !== 'word/document.xml') return false;
      if ((file.originalSize || 0) > MAX_DOCX_DOCUMENT_XML_BYTES) {
        throw new Error('Word 正文 XML 体积超过 50MB 安全上限');
      }
      return true;
    },
  });
  const docXmlBytes = entries['word/document.xml'];
  if (!docXmlBytes) {
    throw new Error('不是有效的 .docx 文件（缺少 word/document.xml）');
  }
  const xml = strFromU8(docXmlBytes);
  const paragraphs = xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [];
  const lines: string[] = [];

  for (const p of paragraphs) {
    const styleMatch = p.match(/<w:pStyle\s+w:val="([^"]+)"/);
    const styleVal = styleMatch?.[1] || '';
    const textParts: string[] = [];
    const tMatches = p.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
    for (const tm of tMatches) {
      const inner = tm
        .replace(/^<w:t(?:\s[^>]*)?>/, '')
        .replace(/<\/w:t>$/, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      textParts.push(inner);
    }
    const line = textParts.join('').trim();
    if (!line) continue;

    if (/^(?:Heading\s*[1-3]|Title|[1-3])$/i.test(styleVal.trim())) {
      lines.push(`## ${line}`);
    } else {
      lines.push(line);
    }
  }

  return lines.join('\n\n');
}

export function normalizeTextToWorldMarkdown(rawText: string): string {
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let hasAnyH2 = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^##\s+/.test(trimmed)) {
      hasAnyH2 = true;
      out.push(trimmed);
    } else if (/^#\s+(.+)$/.test(trimmed)) {
      hasAnyH2 = true;
      out.push(`## ${trimmed.replace(/^#\s+/, '').trim()}`);
    } else if (/^【([^】]{2,30})】$/.test(trimmed)) {
      hasAnyH2 = true;
      out.push(`## ${trimmed.slice(1, -1).trim()}`);
    } else if (/^(第[一二三四五六七八九十百0-9]+[章节部分篇]|[一二三四五六七八九十]+、)\s*\S{1,30}$/.test(trimmed)) {
      hasAnyH2 = true;
      out.push(`## ${trimmed}`);
    } else {
      out.push(rawLine);
    }
  }

  const joined = out.join('\n').trim();
  if (!hasAnyH2 && joined) {
    return `## 一、导入设定全文\n\n${joined}`;
  }
  return joined;
}

export function buildExtractionSnippet(
  rawText: string,
  maxChars = EXTRACTION_SNIPPET_LIMIT
): { snippet: string; sampled: boolean } {
  const clean = rawText.trim();
  if (clean.length <= maxChars) {
    return { snippet: clean, sampled: false };
  }

  const headLen = maxChars === 42000 ? 22000 : Math.floor(maxChars * 0.52);
  const midLen = maxChars === 42000 ? 10000 : Math.floor(maxChars * 0.24);
  const tailLen = Math.max(100, maxChars - headLen - midLen);

  const midStart = Math.max(headLen, Math.floor((clean.length - midLen) / 2));
  const head = clean.slice(0, headLen);
  const mid = clean.slice(midStart, midStart + midLen);
  const tail = clean.slice(clean.length - tailLen);

  return {
    snippet: [
      head,
      '\n\n[...原文较长，以下为中段节选...]\n\n',
      mid,
      '\n\n[...原文较长，以下为尾段节选...]\n\n',
      tail,
    ].join(''),
    sampled: true,
  };
}

export interface ExtractedWorldData {
  name: string;
  genre: string;
  document: string;
  originalDocument?: string;
  sampled?: boolean;
  characters: Array<{
    name: string;
    identity: string;
    personality: string;
    status: string;
    relationsNote: string;
    notes: string;
  }>;
  timelineEvents: Array<{
    timeLabel: string;
    title: string;
    details: string;
    characterNames: string[];
  }>;
  relations: Array<{
    sourceName: string;
    targetName: string;
    directed: boolean;
    phases: Array<{
      atEventTitle?: string;
      type: RelationType;
      label: string;
      strength: 1 | 2 | 3;
      description: string;
    }>;
  }>;
}

const VALID_REL_TYPES = new Set<RelationType>([
  'friend',
  'ally',
  'family',
  'mentor',
  'romance',
  'hierarchy',
  'rival',
  'hostile',
  'secret',
  'custom',
]);

function repairTruncatedJson(input: string): string {
  let s = input.trim();
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    }
  }

  if (inString) {
    // Drop lone trailing backslash before closing quote
    let trailingBackslashes = 0;
    for (let i = s.length - 1; i >= 0 && s[i] === '\\'; i--) {
      trailingBackslashes++;
    }
    if (trailingBackslashes % 2 === 1) {
      s = s.slice(0, -1);
    }
    s += '"';
  }

  // Determine container stack before cleanup so array string elements are not stripped as keys
  const preStack: string[] = [];
  let pInStr = false;
  let pEsc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (pEsc) {
      pEsc = false;
      continue;
    }
    if (pInStr) {
      if (ch === '\\') pEsc = true;
      else if (ch === '"') pInStr = false;
    } else if (ch === '"') {
      pInStr = true;
    } else if (ch === '{') {
      preStack.push('}');
    } else if (ch === '[') {
      preStack.push(']');
    } else if ((ch === '}' || ch === ']') && preStack.length > 0 && preStack[preStack.length - 1] === ch) {
      preStack.pop();
    }
  }

  // Clean trailing dangling tokens outside strings
  s = s.replace(/,\s*$/, '');
  if (s.endsWith(':')) {
    s += '""';
  } else if (preStack[preStack.length - 1] === '}') {
    // Strip incomplete object key without ':' like , "partialKey"
    s = s.replace(/,\s*"(?:\\.|[^"\\])*"\s*$/, '');
  }

  // Remove trailing commas right before closing brackets
  s = s.replace(/,\s*([}\]])/g, '$1');

  // Re-scan bracket stack and close remaining open containers
  const stack: string[] = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if ((ch === '}' || ch === ']') && stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  s = s.replace(/,\s*$/, '');
  while (stack.length > 0) {
    s += stack.pop();
  }
  return s.replace(/,\s*([}\]])/g, '$1');
}

export function extractJsonObject(raw: string): Record<string, unknown> {
  const withoutThink = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '');

  const cleaned = withoutThink
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    if (start !== -1) {
      const fromBrace = cleaned.slice(start);
      const end = fromBrace.lastIndexOf('}');
      if (end > 0) {
        const directSlice = fromBrace.slice(0, end + 1).replace(/,\s*([}\]])/g, '$1');
        try {
          return JSON.parse(directSlice);
        } catch {
          // Continue to truncated repair over full tail from first brace
        }
      }

      try {
        const repaired = repairTruncatedJson(fromBrace);
        return JSON.parse(repaired);
      } catch {
        // Throw user-friendly guidance below
      }
    }
    throw new Error(
      '模型返回内容未能解析为有效 JSON（长篇小说或思考过程可能导致输出被截断，建议改用 DeepSeek-V3 等非思考模型重试，或先点击「直接整理为设定文档」）'
    );
  }
}

export async function extractWorldWithAI(params: {
  provider: ProviderConfig;
  model: string;
  settings: AppSettings;
  rawText: string;
  hintName?: string;
}): Promise<ExtractedWorldData> {
  const { provider, model, rawText, hintName } = params;
  if (provider.requiresKey && !provider.apiKey.trim()) {
    throw new Error(`尚未填写 ${provider.name} 的 API Key，无法执行 AI 提取`);
  }
  const localhostHint = detectUnreachableLocalhost(provider.baseUrl);
  if (localhostHint) {
    throw new Error(localhostHint);
  }

  const { snippet, sampled } = buildExtractionSnippet(rawText, EXTRACTION_SNIPPET_LIMIT);
  const sys = `你是小说设定提炼助手。请根据用户提供的文本或小说节选，提炼结构化世界观 JSON 对象（严格只输出 JSON，不要输出解释文字或思考过程）：
{
  "name": "作品名称",
  "genre": "玄幻|仙侠|科幻|都市|悬疑|历史|奇幻|其他",
  "worldSummary": "用 3~6 个 Markdown 章节（## 章节名）精炼概括世界背景、力量/技术体系、核心势力、地理与主要冲突（600~1800字，请勿逐字抄写原文全文）",
  "characters": [
    { "name": "核心角色名(最多15位)", "identity": "身份定位", "personality": "性格特征", "status": "状态", "relationsNote": "关系简述", "notes": "外貌或能力亮点" }
  ],
  "timelineEvents": [
    { "timeLabel": "时间点或章节阶段", "title": "关键事件标题(最多15个)", "details": "经过与影响", "characterNames": ["角色名"] }
  ],
  "relations": [
    {
      "sourceName": "角色A",
      "targetName": "角色B",
      "directed": true,
      "phases": [
        { "atEventTitle": "", "type": "friend|ally|family|mentor|romance|hierarchy|rival|hostile|secret|custom", "label": "关系称呼", "strength": 2, "description": "初始阶段描述" },
        { "atEventTitle": "关键事件标题(匹配timelineEvents中title)", "type": "hostile", "label": "敌对", "strength": 3, "description": "事件后如何转变" }
      ]
    }
  ]
}`;

  const cleanBase = provider.baseUrl.replace(/\/+$/, '');
  const userContent = `${hintName ? `参考作品名：${hintName}\n\n` : ''}${sampled ? '以下为长篇作品前/中/后三段核心节选：\n' : '待分析文本：\n'}${snippet}`;

  let rawResponseText = '';
  if (provider.protocol === 'anthropic') {
    const resp = await crossPlatformFetchJson({
      url: `${cleanBase}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 6000,
        temperature: 0.2,
        system: sys,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!resp.ok) throw new Error(`AI 提取请求失败 (HTTP ${resp.status})`);
    const parsed = safeJsonParse<{ content?: Array<{ text?: string }> }>(resp.text, 'AI 世界观提取');
    const blocks = Array.isArray(parsed?.content) ? parsed.content : [];
    rawResponseText = blocks.map((b) => b.text || '').join('');
  } else {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;

    const isReasoningModel = /reasoner|\br1\b|^o[13]/i.test(model);
    const basePayload: Record<string, unknown> = {
      model,
      temperature: 0.2,
      max_tokens: 6000,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userContent },
      ],
    };
    if (!isReasoningModel) {
      basePayload.response_format = { type: 'json_object' };
    }

    let resp = await crossPlatformFetchJson({
      url: `${cleanBase}/chat/completions`,
      method: 'POST',
      headers,
      body: JSON.stringify(basePayload),
    });

    if (!resp.ok && (resp.status === 400 || resp.status === 422) && basePayload.response_format) {
      const retryPayload = { ...basePayload };
      delete retryPayload.response_format;
      resp = await crossPlatformFetchJson({
        url: `${cleanBase}/chat/completions`,
        method: 'POST',
        headers,
        body: JSON.stringify(retryPayload),
      });
    }

    if (!resp.ok) throw new Error(`AI 提取请求失败 (HTTP ${resp.status})`);
    const parsed = safeJsonParse<{ choices?: Array<{ message?: { content?: string } }> }>(
      resp.text,
      'AI 世界观提取'
    );
    rawResponseText = String(parsed?.choices?.[0]?.message?.content || '');
  }

  const obj = extractJsonObject(rawResponseText);
  const genreStr = String(obj.genre || '其他');
  const validGenre = (WORLD_GENRES as readonly string[]).includes(genreStr) ? genreStr : '其他';

  const characters = Array.isArray(obj.characters)
    ? obj.characters
        .filter((c): c is Record<string, unknown> => Boolean(c && c.name))
        .map((c) => ({
          name: String(c.name).trim(),
          identity: String(c.identity || ''),
          personality: String(c.personality || ''),
          status: String(c.status || ''),
          relationsNote: String(c.relationsNote || ''),
          notes: String(c.notes || ''),
        }))
    : [];

  const timelineEvents = Array.isArray(obj.timelineEvents)
    ? obj.timelineEvents
        .filter((e): e is Record<string, unknown> => Boolean(e && e.title))
        .map((e) => ({
          timeLabel: String(e.timeLabel || ''),
          title: String(e.title).trim(),
          details: String(e.details || ''),
          characterNames: Array.isArray(e.characterNames)
            ? e.characterNames.map((n) => String(n).trim()).filter(Boolean)
            : [],
        }))
    : [];

  const relations = Array.isArray(obj.relations)
    ? obj.relations
        .filter((r): r is Record<string, unknown> => Boolean(r && r.sourceName && r.targetName))
        .map((r) => ({
          sourceName: String(r.sourceName).trim(),
          targetName: String(r.targetName).trim(),
          directed: r.directed !== false,
          phases: Array.isArray(r.phases)
            ? r.phases.map((p: Record<string, unknown>) => {
                const rawType = String(p.type || 'custom') as RelationType;
                const sNum = Number(p.strength);
                const strength: 1 | 2 | 3 = sNum === 3 ? 3 : sNum === 1 ? 1 : 2;
                return {
                  atEventTitle: p.atEventTitle ? String(p.atEventTitle).trim() : undefined,
                  type: VALID_REL_TYPES.has(rawType) ? rawType : 'custom',
                  label: String(p.label || '关联').trim(),
                  strength,
                  description: String(p.description || ''),
                };
              })
            : [],
        }))
    : [];

  const originalDocument = normalizeTextToWorldMarkdown(rawText);
  const summaryDoc = String(obj.worldSummary || obj.document || '').trim();

  return {
    name: String(obj.name || hintName || '导入的作品').trim(),
    genre: validGenre,
    document: summaryDoc || originalDocument,
    originalDocument,
    sampled,
    characters,
    timelineEvents,
    relations,
  };
}

const AVATAR_COLORS = ['#4d6bfe', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444'];

export function materializeExtractedWorldEntities(
  worldId: string,
  extracted: ExtractedWorldData,
  existingCharacters: Character[] = [],
  existingEvents: TimelineEvent[] = []
): {
  characters: Character[];
  events: TimelineEvent[];
  relations: CharacterRelation[];
} {
  const now = Date.now();
  const charIdByName = new Map<string, string>(
    existingCharacters.map((c) => [c.name.trim(), c.id])
  );
  const newChars: Character[] = [];

  extracted.characters.forEach((c, idx) => {
    if (charIdByName.has(c.name)) return;
    const id = createId('char');
    charIdByName.set(c.name, id);
    newChars.push({
      id,
      worldId,
      name: c.name,
      identity: c.identity,
      personality: c.personality,
      status: c.status,
      relationsNote: c.relationsNote,
      notes: c.notes,
      avatarColor: AVATAR_COLORS[(existingCharacters.length + idx) % AVATAR_COLORS.length],
      updatedAt: now,
    });
  });

  const eventIdByTitle = new Map<string, string>(
    existingEvents.map((e) => [e.title.trim(), e.id])
  );
  const maxOrder = existingEvents.reduce((m, e) => Math.max(m, e.orderIndex), 0);
  const newEvents: TimelineEvent[] = [];

  extracted.timelineEvents.forEach((ev, idx) => {
    if (eventIdByTitle.has(ev.title)) return;
    const id = createId('ev');
    eventIdByTitle.set(ev.title, id);
    newEvents.push({
      id,
      worldId,
      timeLabel: ev.timeLabel,
      title: ev.title,
      details: ev.details,
      characterIds: ev.characterNames
        .map((n) => charIdByName.get(n))
        .filter((x): x is string => Boolean(x)),
      orderIndex: maxOrder + (idx + 1) * 10,
      updatedAt: now,
    });
  });

  const newRelations: CharacterRelation[] = [];
  for (const rel of extracted.relations) {
    const sourceId = charIdByName.get(rel.sourceName);
    const targetId = charIdByName.get(rel.targetName);
    if (!sourceId || !targetId || sourceId === targetId || rel.phases.length === 0) continue;
    newRelations.push({
      id: createId('rel'),
      worldId,
      sourceId,
      targetId,
      directed: rel.directed,
      phases: rel.phases.map((p) => ({
        id: createId('phase'),
        fromEventId: p.atEventTitle ? eventIdByTitle.get(p.atEventTitle) : undefined,
        type: p.type,
        label: p.label,
        strength: p.strength,
        description: p.description,
      })),
      updatedAt: now,
    });
  }

  return { characters: newChars, events: newEvents, relations: newRelations };
}
