import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import {
  buildTtsSpeechCacheKey,
  buildTtsVoiceAgnosticKey,
  clearTtsCache,
  deleteTtsCacheBySession,
  evictTtsCache,
  findTtsCacheByAgnosticKey,
  getTtsCacheGroups,
  getTtsCacheStats,
  readTtsCache,
  TTS_CACHE_MAX_ENTRIES,
  writeTtsCache,
} from '../services/voice/ttsCache';

const baseParts = {
  baseUrl: 'https://api.example.com/v1',
  model: 'tts-1',
  voice: 'alloy',
  synthRate: 1,
  gain: 0,
  styleInstruction: '',
  text: '你好，我是林澈。',
};

describe('buildTtsSpeechCacheKey', () => {
  it('is stable for identical inputs and normalizes the endpoint', () => {
    expect(buildTtsSpeechCacheKey(baseParts)).toBe(buildTtsSpeechCacheKey({ ...baseParts }));
    expect(buildTtsSpeechCacheKey({ ...baseParts, baseUrl: '  HTTPS://API.EXAMPLE.COM/V1  ' })).toBe(
      buildTtsSpeechCacheKey(baseParts)
    );
  });

  it('rounds the rate so inaudible float noise does not split the cache', () => {
    expect(buildTtsSpeechCacheKey({ ...baseParts, synthRate: 1.0000004 })).toBe(
      buildTtsSpeechCacheKey({ ...baseParts, synthRate: 1 })
    );
  });

  it('changes whenever anything that shapes the audio changes', () => {
    const base = buildTtsSpeechCacheKey(baseParts);
    const variants = [
      { voice: 'nova' },
      { model: 'tts-2' },
      { baseUrl: 'https://other.example.com/v1' },
      { synthRate: 1.35 },
      { gain: 4 },
      { styleInstruction: '低沉、克制' },
      { text: '你好，我是苏岚。' },
    ];
    const seen = new Set([base]);
    for (const variant of variants) {
      const key = buildTtsSpeechCacheKey({ ...baseParts, ...variant });
      expect(key).not.toBe(base);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('ttsCache storage & LRU', () => {
  beforeEach(async () => {
    await db.ttsCache.clear();
  });

  it('stores audio, hits on read, and bumps the LRU timestamp', async () => {
    const key = buildTtsSpeechCacheKey(baseParts);
    expect(await readTtsCache(key)).toBeNull();

    await writeTtsCache({
      key,
      base64: 'AAAAAAAA',
      contentType: 'audio/mpeg',
      textPreview: '你好，我是林澈。',
      voiceLabel: 'alloy',
    });

    const hit = await readTtsCache(key);
    expect(hit?.base64).toBe('AAAAAAAA');
    expect(hit?.contentType).toBe('audio/mpeg');

    // 计数是异步回写的，给它一个 tick
    await new Promise((r) => setTimeout(r, 30));
    expect((await db.ttsCache.get(key))?.hits).toBe(1);

    const stats = await getTtsCacheStats();
    expect(stats.count).toBe(1);
    expect(stats.bytes).toBe(8);
  });

  it('evicts the least recently used entries beyond the entry cap', async () => {
    const total = TTS_CACHE_MAX_ENTRIES + 5;
    for (let i = 0; i < total; i++) {
      await db.ttsCache.put({
        key: `k${i}`,
        base64: 'x'.repeat(10),
        contentType: 'audio/mpeg',
        bytes: 10,
        createdAt: i,
        lastUsedAt: i,
        hits: 0,
        textPreview: '',
        voiceLabel: '',
      });
    }

    const removed = await evictTtsCache();
    expect(removed).toBe(5);

    const stats = await getTtsCacheStats();
    expect(stats.count).toBe(TTS_CACHE_MAX_ENTRIES);
    // 最久没听过的先走
    expect(await db.ttsCache.get('k0')).toBeUndefined();
    expect(await db.ttsCache.get('k4')).toBeUndefined();
    expect(await db.ttsCache.get('k5')).toBeDefined();
    expect(await db.ttsCache.get(`k${total - 1}`)).toBeDefined();
  });

  it('clears the whole cache', async () => {
    await writeTtsCache({
      key: 'a',
      base64: 'AA',
      contentType: 'audio/mpeg',
      textPreview: '',
      voiceLabel: '',
    });
    await clearTtsCache();
    expect((await getTtsCacheStats()).count).toBe(0);
  });
});

describe('换音色沿用旧语音 / 按会话清理', () => {
  const agnosticParts = {
    baseUrl: 'https://api.example.com/v1',
    model: 'tts-1',
    synthRate: 1,
    gain: 0,
    styleInstruction: '',
    text: '你好，我是林澈。',
  };

  beforeEach(async () => {
    await db.ttsCache.clear();
  });

  it('builds the same agnostic key across voices, but a different one across text', () => {
    const a = buildTtsVoiceAgnosticKey(agnosticParts);
    expect(buildTtsVoiceAgnosticKey({ ...agnosticParts })).toBe(a);
    expect(buildTtsVoiceAgnosticKey({ ...agnosticParts, text: '再见。' })).not.toBe(a);
  });

  it('recovers the old audio through the agnostic key', async () => {
    const agnosticKey = buildTtsVoiceAgnosticKey(agnosticParts);
    await writeTtsCache({
      key: 'old-voice',
      agnosticKey,
      base64: 'OLD',
      contentType: 'audio/mpeg',
      textPreview: '你好，我是林澈。',
      voiceLabel: 'old',
    });
    expect((await findTtsCacheByAgnosticKey(agnosticKey))?.base64).toBe('OLD');
    expect(await findTtsCacheByAgnosticKey('nope')).toBeNull();
  });

  it('groups by conversation and deletes one group at a time', async () => {
    await writeTtsCache({
      key: 'a',
      base64: 'A',
      contentType: 'audio/mpeg',
      textPreview: 'a',
      voiceLabel: 'v',
      sessionId: 's1',
    });
    await writeTtsCache({
      key: 'b',
      base64: 'B',
      contentType: 'audio/mpeg',
      textPreview: 'b',
      voiceLabel: 'v',
      sessionId: 's1',
    });
    await writeTtsCache({
      key: 'c',
      base64: 'C',
      contentType: 'audio/mpeg',
      textPreview: 'c',
      voiceLabel: 'v',
      sessionId: 's2',
    });
    await writeTtsCache({
      key: 'd',
      base64: 'D',
      contentType: 'audio/mpeg',
      textPreview: 'd',
      voiceLabel: 'v',
    });

    const groups = await getTtsCacheGroups();
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.sessionId === 's1')?.count).toBe(2);
    expect(groups.find((g) => g.sessionId === null)?.count).toBe(1);

    expect(await deleteTtsCacheBySession('s1')).toBe(2);
    expect((await getTtsCacheStats()).count).toBe(2);
    expect(await db.ttsCache.get('a')).toBeUndefined();
    expect(await db.ttsCache.get('c')).toBeDefined();
  });
});
