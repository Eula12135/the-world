import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import {
  buildTtsSpeechCacheKey,
  clearTtsCache,
  evictTtsCache,
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
