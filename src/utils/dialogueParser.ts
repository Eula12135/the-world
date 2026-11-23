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

/**
 * 旁白/动作提示词。和上面两类分开是因为它更宽：只要命中就说明这句不是台词。
 * 典型漏网案例：「（意味深长的笑）」——没有「笑容」两个字，不含标点，长度也短，
 * 旧逻辑会掉进「台词」分支，于是被 TTS 当成一句念出来。
 */
const NARRATION_CUE_RE =
  /笑|笑意|神情|神色|表情|眉|眼|目光|视线|唇角|嘴角|沉默|颔首|深吸|呼出|语气|声线|姿态|动作|表情复杂|欲言又止/;

/** 以引号开口的内容按台词处理，避免把「（"好啊"）」误判成旁白 */
const LEADING_QUOTE_RE = /^[“”"「」『』]/;

/**
 * 可发声的拟声词 / 语气词。
 *
 * 旁白要整句丢掉，但「噗的一下笑出来」这种句子里真正该被念出来的是「噗」——
 * 那是一个声音，不是一句描述。所以丢描述、留拟声。
 *
 * 单字（呵 / 嘶 / 咳 / 哼…）容易误伤「呵斥」「嘶哑」这类普通词，
 * 所以只认后面紧跟停顿、或「了/地/的/着」的单个字（见 extractVoiceableSound）。
 */
const VOICEABLE_SOUND_RE =
  /哈哈哈+|哈哈|嘿嘿|呵呵|噗嗤|噗|嘻嘻|嘻|哼哼|哼|嘁|啧啧|啧|唔|嗯+|唉|哎呀|哎哟|哇塞|哇|咳咳|咳|嗷呜|嗷|嘶|呵/g;

/** 取句子里的第一个拟声词；没有就返回空串 */
export function extractVoiceableSound(text: string): string {
  VOICEABLE_SOUND_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VOICEABLE_SOUND_RE.exec(text)) !== null) {
    const sound = match[0];
    if (sound.length === 1) {
      const next = text[match.index + 1] || '';
      // 单字后面还跟着实词，说明它只是某个词的一部分（呵斥 / 嘶哑 / 咳声）
      const isPartOfWord = Boolean(next) && /[\u4e00-\u9fff]/.test(next) && !/[了地着的]/.test(next);
      if (isPartOfWord) continue;
    }
    return sound;
  }
  return '';
}

export function classifyParenthetical(inner: string): RoleplaySegmentKind {
  const clean = inner.trim();
  if (!clean) return 'dialogue';

  if (LEADING_QUOTE_RE.test(clean)) {
    return 'dialogue';
  }

  if (PHYSICAL_ACTION_RE.test(clean)) {
    return 'action';
  }

  if (TONE_CUE_RE.test(clean) && clean.length <= 20) {
    return 'tone';
  }

  if (NARRATION_CUE_RE.test(clean)) {
    return 'action';
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

/**
 * 整行旁白判定：模型有时不加括号，直接写「特蕾娜意味深长的笑了一下。」
 * 这种行没有引号、没有冒号、含旁白词、以句号收尾且很短，朗读时应当跳过。
 * 含「你/我」的行一律保留 —— 那多半是台词（"你笑起来真好看"）。
 */
function isNarrationOnlyLine(line: string): boolean {
  if (line.length > 24) return false;
  if (/[“”"「」『』：:]/.test(line)) return false;
  if (/[你我]/.test(line)) return false;
  if (!NARRATION_CUE_RE.test(line)) return false;
  // 常见于模型把动作写成裸行：「意味深长地笑」没有句号，但要按「以动作词收尾」识别
  if ((/。$|……$/.test(line))) return true;
  return /(?:地)?(?:笑|叹气|沉默|点头|摇头|皱眉|蹙眉|垂眸|抬眼|挑眉|转身|颔首)$/.test(line);
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
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isNarrationOnlyLine(trimmed)) {
        // 整行是旁白：丢掉描述，但保住里面的笑声/拟声词
        const sound = extractVoiceableSound(trimmed);
        if (sound) keptLines.push(sound);
        continue;
      }
      keptLines.push(trimmed);
      continue;
    }

    let cursor = 0;
    let out = '';
    for (const tok of tokens) {
      out += line.slice(cursor, tok.index);
      if (tok.kind === 'dialogue') {
        out += tok.raw;
      } else {
        // 括号里的动作/语气：同样只保留可发声的拟声词，并留一个短停顿
        const sound = extractVoiceableSound(tok.inner);
        if (sound) out += `${sound}，`;
      }
      cursor = tok.index + tok.raw.length;
    }
    out += line.slice(cursor);

    const cleaned = out
      .replace(/^[，,、]+|[，,、]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (cleaned) {
      keptLines.push(cleaned);
    }
  }

  const result = keptLines.join('\n').trim();
  return result || content;
}
