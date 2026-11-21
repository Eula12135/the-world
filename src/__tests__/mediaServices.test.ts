import { describe, expect, it, vi } from 'vitest';
import { buildCharacterImagePrompt, resolveReusableApiKey } from '../services/imageGenService';
import {
  buildBreezeTtsPayload,
  buildTtsSpeechPayload,
  designBreezeVoice,
  formatTtsHttpError,
  isBreezeCloudBase,
  listBreezeVoices,
  normalizeBreezeBaseUrl,
  resolveEffectiveVoiceConfig,
  sanitizeCloneCustomName,
  saveBreezeVoiceDesign,
  splitSpeechChunks,
  stripMarkdownForSpeech,
  uploadClonedVoice,
} from '../services/voiceService';
import { DEFAULT_VOICE_CONFIG } from '../db/database';
import type { Character, ProviderConfig, VoiceProfile, WorldProject } from '../types';

describe('imageGenService & voiceService helpers', () => {
  it('reuses API key from matching provider hostname when explicit key is blank', () => {
    const providers: ProviderConfig[] = [
      {
        id: 'zhipu',
        name: '智谱 BigModel',
        description: '',
        protocol: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'zhipu-shared-key',
        models: ['glm-4-plus'],
        selectedModel: 'glm-4-plus',
        consoleUrl: '',
        docsUrl: '',
        websiteUrl: '',
        requiresKey: true,
        enabled: true,
        isCustom: false,
      },
    ];

    expect(
      resolveReusableApiKey('https://open.bigmodel.cn/api/paas/v4', '', providers)
    ).toBe('zhipu-shared-key');
    expect(
      resolveReusableApiKey('https://open.bigmodel.cn/api/paas/v4', 'explicit-key', providers)
    ).toBe('explicit-key');
    expect(
      resolveReusableApiKey('https://api.siliconflow.cn/v1', '', providers)
    ).toBe('');
  });

  it('builds structured character portrait prompt from world and character details', () => {
    const world: WorldProject = {
      id: 'w1',
      name: '苍穹余烬',
      genre: '奇幻',
      document: '',
      contextMode: 'progressive',
      pinnedSections: [],
      selectedSections: [],
      includeCharacters: true,
      includeTimeline: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const char: Character = {
      id: 'c1',
      worldId: 'w1',
      name: '林澈',
      identity: '游侠剑士',
      personality: '沉稳冷峻',
      status: '',
      relationsNote: '',
      notes: '玄黑披风，银色长发',
      avatarColor: '#4d6bfe',
      updatedAt: 1,
    };
    const prompt = buildCharacterImagePrompt(char, world, '厚涂插画');
    expect(prompt).toContain('厚涂插画');
    expect(prompt).toContain('奇幻题材');
    expect(prompt).toContain('林澈');
    expect(prompt).toContain('游侠剑士');
    expect(prompt).toContain('玄黑披风');
  });

  it('strips markdown syntax and splits long speech into clean sentence chunks', () => {
    const md = `<think>内部推理</think>\n## 标题\n请看[这个链接](https://example.com)与**重点**。\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    const clean = stripMarkdownForSpeech(md);
    expect(clean).not.toContain('内部推理');
    expect(clean).not.toContain('const x = 1');
    expect(clean).not.toContain('https://example.com');
    expect(clean).toContain('这个链接');
    expect(clean).toContain('重点');

    const longText = `${'这是第一句测试内容。'.repeat(30)}${'这是第二段内容！'.repeat(10)}`;
    const chunks = splitSpeechChunks(longText, 120);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
  });

  it('builds TTS payloads with CosyVoice2 endofprompt + gain clamping and OpenAI instructions', () => {
    const cosyPayload = buildTtsSpeechPayload({
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      text: '今天天气真不错。',
      voice: 'speech:custom:abc:123',
      rate: 1.2,
      gain: 25,
      styleInstruction: '温柔低沉地说',
    });
    expect(cosyPayload.input).toBe('温柔低沉地说 <|endofprompt|>今天天气真不错。');
    expect(cosyPayload.gain).toBe(10);
    expect(cosyPayload.speed).toBe(1.2);
    expect(cosyPayload.instructions).toBeUndefined();

    const openaiPayload = buildTtsSpeechPayload({
      model: 'gpt-4o-mini-tts',
      text: 'Hello world',
      voice: 'alloy',
      rate: 1.0,
      gain: 0,
      styleInstruction: 'Speak calmly',
    });
    expect(openaiPayload.input).toBe('Hello world');
    expect(openaiPayload.instructions).toBe('Speak calmly');
    expect(openaiPayload.gain).toBeUndefined();

    const breezePayload = buildTtsSpeechPayload({
      model: 'BreezeBlue/Breeze-TTS-2',
      text: '你好，欢迎使用。',
      voice: '',
      rate: 1.0,
      gain: 0,
      styleInstruction: '年轻女性，温柔清冷、声线清澈',
    });
    expect(breezePayload.voice).toBeUndefined();
    expect(breezePayload.instructions).toBe('年轻女性，温柔清冷、声线清澈');
    expect(breezePayload.extra_params).toEqual({ guidance_scale: 4.0 });
    expect(breezePayload.response_format).toBe('wav');
  });

  it('never sends a sub-1 speech speed that strict gateways reject with HTTP 422', () => {
    const slowPayload = buildTtsSpeechPayload({
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      text: '慢慢说。',
      voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
      rate: 0.5,
      gain: 0,
    });
    expect(slowPayload.speed).toBe(1);
  });

  it('turns a raw 422 validation body into an actionable message', () => {
    const raw = JSON.stringify({
      ok: false,
      code: 'VALIDATION_ERROR',
      detail: 'Input should be greater than or equal to 1',
      error: 'Input should be gre',
    });

    const msg = formatTtsHttpError(422, raw);
    expect(msg).toContain('HTTP 422');
    expect(msg).toContain('Input should be greater than or equal to 1');
    expect(msg).toContain('语速');
    expect(msg).not.toContain('{"ok"');

    expect(formatTtsHttpError(401, '{"detail":"invalid api key"}')).toContain('鉴权失败');
  });

  it('designs a voice from a description and saves it (Voice Design, not TTS instructions)', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            text: '试听台词',
            previews: [
              {
                generated_voice_id: 'gvi_abc',
                audio_base_64: 'SUQz',
                media_type: 'audio/mpeg',
                duration_secs: 3.4,
              },
              { generated_voice_id: '', audio_base_64: '' },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ voice_id: 'voc_new', name: '慵懒御姐' }), { status: 200 })
      );

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      const previews = await designBreezeVoice({
        baseUrl: 'https://api.breezeblue.ai/v1',
        apiKey: 'brz_test',
        providers: [],
        description: '慵懒御姐，语速偏慢，略带气声',
        text: '试听台词',
        previewCount: 9,
      });

      // 空 preview 被过滤，preview_count 被夹到 1..3
      expect(previews).toHaveLength(1);
      expect(previews[0]).toMatchObject({
        generatedVoiceId: 'gvi_abc',
        mediaType: 'audio/mpeg',
        durationSecs: 3.4,
      });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.breeze.blue/v1/voice-previews/design?output_format=mp3');
      const sentBody = JSON.parse(init.body);
      expect(sentBody.voice_description).toBe('慵懒御姐，语速偏慢，略带气声');
      expect(sentBody.preview_count).toBe(3);
      expect(sentBody.text).toBe('试听台词');

      const saved = await saveBreezeVoiceDesign({
        baseUrl: 'https://api.breeze.blue',
        apiKey: 'brz_test',
        providers: [],
        generatedVoiceId: 'gvi_abc',
        name: '慵懒御姐',
      });
      expect(saved).toEqual({ voiceId: 'voc_new', name: '慵懒御姐' });

      const [saveUrl, saveInit] = mockFetch.mock.calls[1];
      expect(saveUrl).toBe('https://api.breeze.blue/v1/voice-previews/gvi_abc/save');
      expect(JSON.parse(saveInit.body)).toMatchObject({
        voice_name: '慵懒御姐',
        language_code: 'zh',
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('surfaces Breeze error detail instead of a bare status code', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          code: 'VALIDATION_ERROR',
          detail: 'guidance_scale must be between 1 and 10',
          error: 'bad',
        }),
        { status: 422 }
      )
    );
    try {
      await expect(
        designBreezeVoice({
          baseUrl: 'https://api.breeze.blue',
          apiKey: 'k',
          providers: [],
          description: '温柔的少女音',
        })
      ).rejects.toThrow(/HTTP 422.*guidance_scale/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('normalizes Breeze cloud URLs and builds strict 5-key Breeze payload + lists voices with xi-api-key', async () => {
    expect(isBreezeCloudBase('https://api.breeze.blue')).toBe(true);
    expect(isBreezeCloudBase('https://api.breezeblue.ai/v1')).toBe(true);
    expect(isBreezeCloudBase('http://127.0.0.1:7860/v1')).toBe(false);

    expect(normalizeBreezeBaseUrl('https://api.breezeblue.ai/v1')).toBe('https://api.breeze.blue');
    expect(normalizeBreezeBaseUrl('https://api.breeze.blue/v1/')).toBe('https://api.breeze.blue');

    const cloudPayload = buildBreezeTtsPayload({
      text: '有一个人，决定追上太阳。',
      model: 'BreezeBlue/Breeze-TTS-2',
      instructions: '压低声音，语速慢',
    });
    expect(cloudPayload).toEqual({
      text: '有一个人，决定追上太阳。',
      model_id: 'breeze-tts-2',
      language_code: 'zh',
      instructions: '压低声音，语速慢',
      voice_settings: { guidance_scale: 1 },
    });
    expect(Object.keys(cloudPayload).sort()).toEqual([
      'instructions',
      'language_code',
      'model_id',
      'text',
      'voice_settings',
    ]);
    expect(cloudPayload.output_format).toBeUndefined();
    expect(cloudPayload.speed).toBeUndefined();
    expect(cloudPayload.input).toBeUndefined();
    expect(cloudPayload.voice).toBeUndefined();

    const noInstPayload = buildBreezeTtsPayload({ text: '测试无指令' });
    expect(Object.keys(noInstPayload).sort()).toEqual([
      'language_code',
      'model_id',
      'text',
      'voice_settings',
    ]);

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          voices: [{ voice_id: 'voc_demo_123', name: '演示女声', category: 'cloned' }],
        }),
        { status: 200 }
      )
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      const voices = await listBreezeVoices({
        baseUrl: 'https://api.breezeblue.ai/v1',
        apiKey: 'brz_test_fake_key',
        providers: [],
      });
      expect(voices).toEqual([{ voiceId: 'voc_demo_123', name: '演示女声', category: 'cloned' }]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.breeze.blue/v1/voices',
        expect.objectContaining({
          method: 'GET',
          headers: { 'xi-api-key': 'brz_test_fake_key' },
        })
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('resolves VoiceProfile overrides and uploads cloned voice reference via API', async () => {
    const profile: VoiceProfile = {
      id: 'vp1',
      name: '测试克隆音色',
      engine: 'openai_api',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      voiceId: 'speech:test:1:2',
      rate: 1.15,
      pitch: 0.9,
      volume: 0.85,
      gain: 3,
      styleInstruction: '冷淡克制地说',
      isCloned: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const merged = resolveEffectiveVoiceConfig(DEFAULT_VOICE_CONFIG, profile);
    expect(merged.ttsEngine).toBe('openai_api');
    expect(merged.ttsVoice).toBe('speech:test:1:2');
    expect(merged.ttsGain).toBe(3);
    expect(merged.ttsStyleInstruction).toBe('冷淡克制地说');

    expect(sanitizeCloneCustomName('林澈 Voice #1')).toBe('Voice_1');

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ uri: 'speech:linche:abc:xyz' }), { status: 200 })
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      const res = await uploadClonedVoice({
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-sf-test',
        providers: [],
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        customName: 'linche_voice',
        text: '夜色已深，准备出发。',
        audioDataUrl: 'data:audio/mpeg;base64,SUQz',
      });
      expect(res.uri).toBe('speech:linche:abc:xyz');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
