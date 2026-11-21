import { unzipSync, strFromU8 } from 'fflate';
import type { ChatMessage, ChatSession } from '../types';
import { createId } from '../utils/platform';

const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_JSON_FILE_BYTES = 20 * 1024 * 1024;

interface DeepSeekFragment {
  type: string;
  content?: string;
  elapsed_secs?: number;
  style?: string;
  queries?: string[];
  [key: string]: unknown;
}

interface DeepSeekV3Message {
  id: number | string;
  parent_id: number | string | null;
  role: string;
  status?: string;
  inserted_at?: string;
  accumulated_token_usage?: number;
  fragments?: DeepSeekFragment[];
}

interface DeepSeekV3Session {
  id: string;
  title?: string;
  pinned?: boolean;
  current_message_id?: number | string | null;
  inserted_at?: string;
  updated_at?: string;
  messages?: DeepSeekV3Message[];
}

interface DeepSeekIndexItem {
  id: string;
  title?: string;
  pinned?: boolean;
  message_count?: number;
  inserted_at?: string;
  updated_at?: string;
}

export interface ParsedImportedSession {
  sourceId: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  messages: Omit<ChatMessage, 'sessionId'>[];
  thinkingCount: number;
  isDuplicate?: boolean;
}

export interface ParsedImportBundle {
  formatVersion: string;
  sessions: ParsedImportedSession[];
  warnings: string[];
}

function parseTimestamp(iso: unknown, fallback: number): number {
  if (typeof iso === 'number' && Number.isFinite(iso)) {
    return iso > 1e12 ? iso : iso * 1000;
  }
  if (typeof iso === 'string') {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }
  return fallback;
}

function normalizeRole(role: unknown): 'user' | 'assistant' | 'system' {
  const r = String(role || '').toLowerCase();
  if (r === 'user') return 'user';
  if (r === 'system') return 'system';
  return 'assistant';
}

function reconstructV3MainBranch(rawMessages: DeepSeekV3Message[], currentId: unknown): DeepSeekV3Message[] {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return [];
  const byId = new Map<string, DeepSeekV3Message>();
  for (const m of rawMessages) {
    if (m && m.id !== undefined && m.id !== null) {
      byId.set(String(m.id), m);
    }
  }

  if (currentId !== undefined && currentId !== null && byId.has(String(currentId))) {
    const chain: DeepSeekV3Message[] = [];
    const visited = new Set<string>();
    let cursor: string | null = String(currentId);
    while (cursor && byId.has(cursor) && !visited.has(cursor)) {
      visited.add(cursor);
      const node: DeepSeekV3Message = byId.get(cursor)!;
      chain.push(node);
      cursor = node.parent_id !== null && node.parent_id !== undefined ? String(node.parent_id) : null;
    }
    return chain.reverse();
  }

  return [...rawMessages].sort((a, b) => Number(a.id) - Number(b.id));
}

function convertV3Session(
  raw: DeepSeekV3Session,
  indexMeta?: DeepSeekIndexItem
): ParsedImportedSession {
  const now = Date.now();
  const createdAt = parseTimestamp(raw.inserted_at ?? indexMeta?.inserted_at, now);
  const updatedAt = parseTimestamp(raw.updated_at ?? indexMeta?.updated_at, createdAt);
  const branch = reconstructV3MainBranch(raw.messages || [], raw.current_message_id);

  let thinkingCount = 0;
  const messages: Omit<ChatMessage, 'sessionId'>[] = [];

  for (const m of branch) {
    const role = normalizeRole(m.role);
    const fragments = Array.isArray(m.fragments) ? m.fragments : [];

    const requestParts: string[] = [];
    const responseParts: string[] = [];
    const thinkParts: string[] = [];
    let thinkDuration = 0;
    const riskNotes: string[] = [];
    const searchQueries: string[] = [];

    for (const f of fragments) {
      if (!f || typeof f !== 'object') continue;
      const type = String(f.type || '').toUpperCase();
      if (type === 'REQUEST' && typeof f.content === 'string') {
        requestParts.push(f.content);
      } else if (type === 'THINK' && typeof f.content === 'string') {
        thinkParts.push(f.content);
        if (typeof f.elapsed_secs === 'number' && Number.isFinite(f.elapsed_secs)) {
          thinkDuration += f.elapsed_secs;
        }
      } else if (type === 'RESPONSE' && typeof f.content === 'string') {
        responseParts.push(f.content);
      } else if (type === 'CONTENT_RISK' && typeof f.content === 'string') {
        riskNotes.push(f.content);
      } else if (type === 'TOOL_SEARCH' && Array.isArray(f.queries)) {
        for (const q of f.queries) {
          if (typeof q === 'string' && q.trim()) searchQueries.push(q.trim());
        }
      }
    }

    const content =
      role === 'user'
        ? requestParts.join('\n\n')
        : responseParts.join('\n\n') || requestParts.join('\n\n');
    const reasoning = thinkParts.join('\n\n').trim() || undefined;
    if (reasoning) thinkingCount += 1;

    if (!content && !reasoning && riskNotes.length === 0) continue;

    messages.push({
      id: createId('msg'),
      role,
      content: content || (riskNotes.length > 0 ? `[提示] ${riskNotes.join(' ')}` : ''),
      reasoning,
      thinkingDurationSec: thinkDuration > 0 ? Math.round(thinkDuration * 10) / 10 : undefined,
      warningNote: riskNotes.length > 0 ? riskNotes.join('\n') : undefined,
      searchQueries: searchQueries.length > 0 ? searchQueries : undefined,
      tokenUsage:
        typeof m.accumulated_token_usage === 'number' ? m.accumulated_token_usage : undefined,
      createdAt: parseTimestamp(m.inserted_at, createdAt),
    });
  }

  return {
    sourceId: String(raw.id || indexMeta?.id || createId('ds')),
    title: String(raw.title || indexMeta?.title || '未命名 DeepSeek 对话').trim() || '未命名 DeepSeek 对话',
    pinned: Boolean(raw.pinned ?? indexMeta?.pinned),
    createdAt,
    updatedAt,
    messages,
    thinkingCount,
  };
}

interface LegacyMappingNode {
  id: string;
  parent?: string | null;
  children?: string[];
  message?: {
    id?: string;
    role?: string;
    content?: string;
    reasoning_content?: string;
    thinking?: string;
    fragments?: DeepSeekFragment[];
    inserted_at?: string;
    created_at?: number | string;
  } | null;
}

function convertLegacyConversation(conv: Record<string, unknown>): ParsedImportedSession {
  const now = Date.now();
  const createdAt = parseTimestamp(conv.inserted_at ?? conv.created_at, now);
  const updatedAt = parseTimestamp(conv.updated_at, createdAt);
  const title = String(conv.title || 'DeepSeek 导入对话').trim() || 'DeepSeek 导入对话';
  const sourceId = String(conv.id || createId('ds'));
  const mapping = conv.mapping as Record<string, LegacyMappingNode> | undefined;

  const messages: Omit<ChatMessage, 'sessionId'>[] = [];
  let thinkingCount = 0;

  if (mapping && typeof mapping === 'object') {
    const visited = new Set<string>();
    const walk = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = mapping[nodeId];
      if (!node) return;
      if (node.message && (node.message.content || node.message.fragments || node.message.reasoning_content)) {
        const msg = node.message;
        const role = normalizeRole(msg.role);
        let content = typeof msg.content === 'string' ? msg.content : '';
        let reasoning =
          typeof msg.reasoning_content === 'string'
            ? msg.reasoning_content
            : typeof msg.thinking === 'string'
              ? msg.thinking
              : undefined;
        if (!content && Array.isArray(msg.fragments)) {
          const reqs: string[] = [];
          const resps: string[] = [];
          const thinks: string[] = [];
          for (const f of msg.fragments) {
            if (f.type === 'REQUEST' && f.content) reqs.push(f.content);
            if (f.type === 'RESPONSE' && f.content) resps.push(f.content);
            if (f.type === 'THINK' && f.content) thinks.push(f.content);
          }
          content = role === 'user' ? reqs.join('\n\n') : resps.join('\n\n');
          if (!reasoning && thinks.length > 0) reasoning = thinks.join('\n\n');
        }
        if (reasoning) thinkingCount += 1;
        if (content || reasoning) {
          messages.push({
            id: createId('msg'),
            role,
            content,
            reasoning,
            createdAt: parseTimestamp(msg.inserted_at ?? msg.created_at, createdAt),
          });
        }
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        // Follow latest branch child
        walk(node.children[node.children.length - 1]);
      }
    };
    if (mapping.root) {
      walk('root');
    } else {
      const roots = Object.values(mapping).filter((n) => !n.parent);
      for (const r of roots) walk(r.id);
    }
  } else if (Array.isArray(conv.messages)) {
    return convertV3Session(conv as unknown as DeepSeekV3Session);
  }

  return {
    sourceId,
    title,
    pinned: Boolean(conv.pinned),
    createdAt,
    updatedAt,
    messages,
    thinkingCount,
  };
}

export async function parseDeepSeekArchive(
  bytes: Uint8Array,
  fileName: string,
  existingSourceIds: Set<string> = new Set()
): Promise<ParsedImportBundle> {
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    throw new Error('文件超过 100MB 上限，请分批导入');
  }

  const warnings: string[] = [];
  const lower = fileName.toLowerCase();
  const isZip =
    lower.endsWith('.zip') || (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b);

  if (isZip) {
    const entries = unzipSync(bytes);
    let formatVersion = 'zip-unknown';
    const indexMap = new Map<string, DeepSeekIndexItem>();
    const indexOrder: string[] = [];

    const manifestRaw = entries['manifest.json'];
    if (manifestRaw) {
      try {
        const m = JSON.parse(strFromU8(manifestRaw));
        if (m.export_format_version !== undefined) {
          formatVersion = `DeepSeek Export v${m.export_format_version}`;
        }
      } catch {
        warnings.push('manifest.json 解析失败，已尝试继续读取会话文件');
      }
    }

    const indexRaw = entries['chat_session_index.json'];
    if (indexRaw) {
      try {
        const idxArr = JSON.parse(strFromU8(indexRaw));
        if (Array.isArray(idxArr)) {
          for (const item of idxArr) {
            if (item?.id) {
              indexMap.set(String(item.id), item);
              indexOrder.push(String(item.id));
            }
          }
        }
      } catch {
        warnings.push('chat_session_index.json 解析失败，将直接扫描 chat_sessions 目录');
      }
    }

    const parsedById = new Map<string, ParsedImportedSession>();

    for (const [entryPath, entryBytes] of Object.entries(entries)) {
      if (entryBytes.byteLength > MAX_JSON_FILE_BYTES) {
        warnings.push(`跳过过大文件: ${entryPath}`);
        continue;
      }
      if (entryPath.startsWith('chat_sessions/') && entryPath.endsWith('.json')) {
        try {
          const data = JSON.parse(strFromU8(entryBytes)) as DeepSeekV3Session;
          const converted = convertV3Session(data, indexMap.get(String(data.id)));
          converted.isDuplicate = existingSourceIds.has(converted.sourceId);
          parsedById.set(converted.sourceId, converted);
        } catch {
          warnings.push(`会话文件解析失败: ${entryPath}`);
        }
      } else if (entryPath === 'conversations.json') {
        formatVersion = 'DeepSeek Legacy conversations.json';
        try {
          const arr = JSON.parse(strFromU8(entryBytes));
          if (Array.isArray(arr)) {
            for (const conv of arr) {
              const converted = convertLegacyConversation(conv);
              converted.isDuplicate = existingSourceIds.has(converted.sourceId);
              parsedById.set(converted.sourceId, converted);
            }
          }
        } catch {
          warnings.push('conversations.json 解析失败');
        }
      }
    }

    const sessions: ParsedImportedSession[] = [];
    for (const id of indexOrder) {
      const s = parsedById.get(id);
      if (s) {
        sessions.push(s);
        parsedById.delete(id);
      }
    }
    for (const s of parsedById.values()) {
      sessions.push(s);
    }

    if (sessions.length === 0) {
      throw new Error('压缩包中未识别到有效的 DeepSeek 聊天记录');
    }

    return { formatVersion, sessions, warnings };
  }

  // Single JSON file
  if (bytes.byteLength > MAX_JSON_FILE_BYTES) {
    throw new Error('单个 JSON 文件超过 20MB 上限');
  }
  const parsed = JSON.parse(strFromU8(bytes));
  const sessions: ParsedImportedSession[] = [];

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const s = convertLegacyConversation(item);
      s.isDuplicate = existingSourceIds.has(s.sourceId);
      sessions.push(s);
    }
  } else if (parsed && typeof parsed === 'object') {
    const s = convertLegacyConversation(parsed);
    s.isDuplicate = existingSourceIds.has(s.sourceId);
    sessions.push(s);
  }

  if (sessions.length === 0) {
    throw new Error('JSON 中未识别到有效的 DeepSeek 会话结构');
  }

  return { formatVersion: 'DeepSeek JSON', sessions, warnings };
}

export function materializeImportedSessions(
  picked: ParsedImportedSession[],
  defaultProviderId: string,
  defaultModel: string
): { sessions: ChatSession[]; messages: ChatMessage[] } {
  const sessions: ChatSession[] = [];
  const messages: ChatMessage[] = [];

  for (const item of picked) {
    const sessionId = createId('sess');
    sessions.push({
      id: sessionId,
      title: item.title,
      pinned: item.pinned,
      providerId: defaultProviderId,
      model: defaultModel,
      enableWorldContext: false,
      importedFrom: 'deepseek',
      sourceId: item.sourceId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
    for (const m of item.messages) {
      messages.push({
        ...m,
        sessionId,
      });
    }
  }

  return { sessions, messages };
}
