import { db } from '../../db/database';
import type { TtsCacheEntry } from '../../types';

/**
 * 容量上限。两个条件同时生效，谁先超就按 LRU 清理到不超为止。
 *
 * 30MB 是「base64 字符数」的近似口径（IndexedDB 里按 UTF-8 单字节存），
 * 换算成实际音频约 22MB —— 单声道 MP3 大概能放一小时的语音。
 * 条数上限是给大量短句兜底的：60 条够覆盖最近几场对话。
 */
export const TTS_CACHE_MAX_ENTRIES = 60;
export const TTS_CACHE_MAX_BYTES = 30 * 1024 * 1024;

function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hashKey(text: string): string {
  // 两路不同种子的 FNV-1a 拼成 16 位十六进制，碰撞概率对本地缓存足够低
  const a = fnv1a(text, 0x811c9dc5);
  const b = fnv1a(text, 0x01000193);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * 缓存键 = 所有会影响合成波形的参数 + 文本。
 *
 * 这里必须"宁多勿少"：漏掉任何一个参数，都会造成「换了音色却播了旧声音」的
 * 反向 bug，而且用户完全看不出来。反过来，多带一个不影响波形的参数只是浪费命中率。
 *
 * - `synthRate` 指真正发给服务端的语速；rate < 1 时由播放端 playbackRate 处理，
 *   服务端仍按 1 合成，所以这里要传 1，否则同一段音频会被存成两份。
 * - 音量、音高不参与：音量在播放端生效，音高不发给 API。
 */
export function buildTtsSpeechCacheKey(parts: {
  baseUrl: string;
  model: string;
  voice: string;
  synthRate: number;
  gain: number;
  styleInstruction: string;
  text: string;
}): string {
  const canonical = [
    'v1',
    parts.baseUrl.trim().toLowerCase(),
    parts.model.trim(),
    parts.voice.trim(),
    String(Math.round(parts.synthRate * 1000) / 1000),
    String(Math.round(parts.gain * 1000) / 1000),
    parts.styleInstruction.trim(),
    parts.text,
  ].join('\u0000');
  return hashKey(canonical);
}

/** 命中即刷新 LRU 时间戳；写失败不影响播放 */
export async function readTtsCache(key: string): Promise<TtsCacheEntry | null> {
  const hit = await db.ttsCache.get(key);
  if (!hit) return null;
  void db.ttsCache
    .update(key, { lastUsedAt: Date.now(), hits: (hit.hits || 0) + 1 })
    .catch(() => undefined);
  return hit;
}

export async function writeTtsCache(entry: {
  key: string;
  base64: string;
  contentType: string;
  textPreview: string;
  voiceLabel: string;
}): Promise<void> {
  const now = Date.now();
  await db.ttsCache.put({
    key: entry.key,
    base64: entry.base64,
    contentType: entry.contentType,
    bytes: entry.base64.length,
    createdAt: now,
    lastUsedAt: now,
    hits: 0,
    textPreview: entry.textPreview,
    voiceLabel: entry.voiceLabel,
  });
  await evictTtsCache();
}

/** 按 LRU 清理到容量之内，返回删掉的条数 */
export async function evictTtsCache(): Promise<number> {
  const all = await db.ttsCache.orderBy('lastUsedAt').toArray();
  let totalBytes = all.reduce((sum, item) => sum + item.bytes, 0);
  let count = all.length;

  const doomed: string[] = [];
  for (const item of all) {
    if (count <= TTS_CACHE_MAX_ENTRIES && totalBytes <= TTS_CACHE_MAX_BYTES) break;
    doomed.push(item.key);
    totalBytes -= item.bytes;
    count -= 1;
  }

  if (doomed.length > 0) {
    await db.ttsCache.bulkDelete(doomed);
  }
  return doomed.length;
}

export async function getTtsCacheStats(): Promise<{ count: number; bytes: number }> {
  const all = await db.ttsCache.toArray();
  return {
    count: all.length,
    bytes: all.reduce((sum, item) => sum + item.bytes, 0),
  };
}

export async function clearTtsCache(): Promise<void> {
  await db.ttsCache.clear();
}
