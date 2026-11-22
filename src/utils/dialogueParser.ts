export type RoleplaySegmentKind = 'action' | 'tone' | 'dialogue';

export interface RoleplaySegment {
  kind: RoleplaySegmentKind;
  text: string;
}

export type RoleplayBlock =
  | { kind: 'action'; text: string }
  | { kind: 'speech'; segments: Array<{ kind: 'dialogue' | 'tone'; text: string }> };

const PHYSICAL_ACTION_RE =
  /拨弄|靠近|转身|抬头|低头|伸手|挥手|起身|坐下|走|跑|握|推|拉|抱|抚|摸|凝视|眼神|目光|笑容|嘴角|眉|长发|头发|发丝|月光|窗|剑|杯|衣|肩|背|一步|侧过|一怔|一愣|点头|摇头|耸肩|指尖|双手|手|脚|身体|露出|抬眸|垂眸|偏头|歪头|凑近|贴近|后退|上前|倚|靠|递|接|拍|敲|抓|揉|擦|拭|站起|蹲下|跪|眨|望向|看向|盯着|扫过|瞥/;

const TONE_CUE_RE =
  /叹|叹气|轻叹|叹息|叹了口气|长叹|深吸一口气|呼了口气|呵气|轻笑|低笑|冷笑|苦笑|嗤笑|笑声|噗嗤|噗|轻哼|哼|咳|轻咳|干咳|哽咽|抽泣|呜咽|咂舌|啧|低声|轻声|小声|压低声音|耳语|喃喃|呢喃|自语|自言自语|顿了顿|停顿|沉默片刻|话锋一转|语气|语调|声音|口吻|嗓音|缓了缓|认真|严肃|温柔|冷冷|淡淡|俏皮|调侃|戏谑|撒娇|委屈|试探|迟疑|犹豫|无奈|含笑|笑着说|低声道|轻声说|柔和|急切|不满|嘲讽|自嘲|欣慰|恍然/;

const CJK_CHAR_RE = /[\u4e00-\u9fff]/;

export function classifyParenthetical(inner: string): RoleplaySegmentKind {
  const clean = inner.trim();
  if (!clean) return 'dialogue';

  if (PHYSICAL_ACTION_RE.test(clean)) {
    return 'action';
  }

  if (TONE_CUE_RE.test(clean) && clean.length <= 20) {
    return 'tone';
  }

  if (/[，。；,;]/.test(clean) || (clean.length >= 10 && CJK_CHAR_RE.test(clean))) {
    return 'action';
  }

  return 'dialogue';
}

interface TokenMatch {
  index: number;
  raw: string;
  inner: string;
  kind: RoleplaySegmentKind;
}

function scanParentheticals(line: string): TokenMatch[] {
  const tokens: TokenMatch[] = [];
  const re = /（([^（）]+)）|\(([^()\n]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const raw = match[0];
    // Skip markdown link URLs like [label](https://...)
    if (raw.startsWith('(') && match.index > 0 && line[match.index - 1] === ']') {
      continue;
    }
    const inner = (match[1] ?? match[2] ?? '').trim();
    const kind = classifyParenthetical(inner);
    tokens.push({
      index: match.index,
      raw,
      inner,
      kind,
    });
  }
  return tokens;
}

function pushDialogueSegment(
  segments: Array<{ kind: 'dialogue' | 'tone'; text: string }>,
  text: string
) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.kind === 'dialogue') {
    last.text += text;
  } else {
    segments.push({ kind: 'dialogue', text });
  }
}

export function parseRoleplayContent(content: string): {
  hasActions: boolean;
  hasTones: boolean;
  blocks: RoleplayBlock[];
} {
  if (!content || content.includes('```') || /(?:^|\n)\|/.test(content)) {
    return { hasActions: false, hasTones: false, blocks: [] };
  }

  const lines = content
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const blocks: RoleplayBlock[] = [];
  let hasActions = false;
  let hasTones = false;

  for (const line of lines) {
    const tokens = scanParentheticals(line);
    if (tokens.length === 0) {
      blocks.push({ kind: 'speech', segments: [{ kind: 'dialogue', text: line }] });
      continue;
    }

    let cursor = 0;
    let speechSegments: Array<{ kind: 'dialogue' | 'tone'; text: string }> = [];
    let justFlushedAction = false;

    const flushSpeech = () => {
      if (speechSegments.length === 0) return;
      // Trim leading/trailing whitespace at speech block boundaries
      const first = speechSegments[0];
      if (first.kind === 'dialogue') first.text = first.text.replace(/^\s+/, '');
      const last = speechSegments[speechSegments.length - 1];
      if (last.kind === 'dialogue') last.text = last.text.replace(/\s+$/, '');
      const nonEmpty = speechSegments.filter((s) => s.kind === 'tone' || s.text.length > 0);
      if (nonEmpty.length > 0) {
        blocks.push({ kind: 'speech', segments: nonEmpty });
      }
      speechSegments = [];
    };

    for (const tok of tokens) {
      let before = line.slice(cursor, tok.index);
      if (justFlushedAction) {
        before = before.replace(/^\s+/, '');
      }
      if (tok.kind === 'action') {
        if (before) {
          pushDialogueSegment(speechSegments, before);
        }
        flushSpeech();
        blocks.push({ kind: 'action', text: tok.inner });
        hasActions = true;
        justFlushedAction = true;
      } else if (tok.kind === 'tone') {
        if (before) {
          pushDialogueSegment(speechSegments, before);
        }
        speechSegments.push({ kind: 'tone', text: tok.raw });
        hasTones = true;
        justFlushedAction = false;
      } else {
        pushDialogueSegment(speechSegments, before + tok.raw);
        justFlushedAction = false;
      }
      cursor = tok.index + tok.raw.length;
    }

    let tail = line.slice(cursor);
    if (justFlushedAction) {
      tail = tail.replace(/^\s+/, '');
    }
    if (tail) {
      pushDialogueSegment(speechSegments, tail);
    }
    flushSpeech();
  }

  return { hasActions, hasTones, blocks };
}

export function stripActionsForSpeech(content: string): string {
  if (!content || content.includes('```') || /(?:^|\n)\|/.test(content)) {
    return content;
  }

  const lines = content.split(/\n+/);
  const keptLines: string[] = [];

  for (const line of lines) {
    const tokens = scanParentheticals(line);
    if (tokens.length === 0) {
      if (line.trim()) keptLines.push(line.trim());
      continue;
    }

    let cursor = 0;
    let out = '';
    for (const tok of tokens) {
      out += line.slice(cursor, tok.index);
      if (tok.kind === 'dialogue') {
        out += tok.raw;
      }
      cursor = tok.index + tok.raw.length;
    }
    out += line.slice(cursor);

    const cleaned = out.replace(/\s{2,}/g, ' ').trim();
    if (cleaned) {
      keptLines.push(cleaned);
    }
  }

  const result = keptLines.join('\n').trim();
  return result || content;
}
