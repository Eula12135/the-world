import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  db,
  DEFAULT_SETTINGS,
  deleteCharacterCascade,
  deleteSessionCascade,
  deleteTimelineEventCascade,
  deleteWorldCascade,
  ensureDatabaseInitialized,
  loadSettingsDecrypted,
  saveSettingsEncrypted,
} from '../db/database';
import {
  exportFullBackupJson,
  importFullBackupJson,
  sessionToMarkdown,
  worldToMarkdown,
} from '../services/exportService';
import { isSafeHttpUrl } from '../utils/platform';

describe('database v3, cascades, backup & security checks', () => {
  beforeEach(async () => {
    await Promise.all([
      db.providers.clear(),
      db.sessions.clear(),
      db.messages.clear(),
      db.worlds.clear(),
      db.characters.clear(),
      db.relations.clear(),
      db.timelineEvents.clear(),
      db.personaPresets.clear(),
      db.voiceProfiles.clear(),
      db.settings.clear(),
    ]);
    await ensureDatabaseInitialized();
  });

  it('initializes built-in providers and v4 settings with 100k context limit', async () => {
    const providers = await db.providers.toArray();
    const settings = await db.settings.get('global');
    expect(providers.length).toBeGreaterThanOrEqual(11);
    expect(settings?.maxWorldContextChars).toBe(100000);
    expect(settings?.autoCheckUpdates).toBe(true);
  });

  it('cascades deletes across sessions, worlds, characters, relations, and timeline events', async () => {
    await db.sessions.put({
      id: 's1',
      title: '测试会话',
      pinned: false,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      worldId: 'w1',
      enableWorldContext: true,
      storyPointEventId: 'e1',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.messages.put({
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      content: 'hello',
      createdAt: 1,
    });
    await db.worlds.put({
      id: 'w1',
      name: '测试作品',
      genre: '科幻',
      document: '## 概述\n内容',
      contextMode: 'progressive',
      pinnedSections: [],
      selectedSections: [],
      includeCharacters: true,
      includeTimeline: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.characters.bulkPut([
      {
        id: 'c1',
        worldId: 'w1',
        name: '主角',
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
        name: '副官',
        identity: '大副',
        personality: '',
        status: '',
        relationsNote: '',
        notes: '',
        avatarColor: '#10b981',
        updatedAt: 1,
      },
    ]);
    await db.timelineEvents.put({
      id: 'e1',
      worldId: 'w1',
      timeLabel: '元年',
      title: '起航',
      details: '',
      characterIds: ['c1', 'c2'],
      orderIndex: 10,
      updatedAt: 1,
    });
    await db.relations.put({
      id: 'r1',
      worldId: 'w1',
      sourceId: 'c1',
      targetId: 'c2',
      directed: false,
      phases: [
        { id: 'p1', fromEventId: 'e1', type: 'ally', label: '搭档', strength: 2, description: '' },
      ],
      updatedAt: 1,
    });

    await deleteTimelineEventCascade('e1');
    expect(await db.timelineEvents.count()).toBe(0);
    expect((await db.relations.get('r1'))?.phases[0].fromEventId).toBeUndefined();
    expect((await db.sessions.get('s1'))?.storyPointEventId).toBeUndefined();

    await deleteCharacterCascade('c1');
    expect(await db.characters.count()).toBe(1);
    expect(await db.relations.count()).toBe(0);

    await deleteWorldCascade('w1');
    expect(await db.worlds.count()).toBe(0);
    expect(await db.characters.count()).toBe(0);
    expect((await db.sessions.get('s1'))?.worldId).toBeUndefined();

    await deleteSessionCascade('s1');
    expect(await db.sessions.count()).toBe(0);
    expect(await db.messages.count()).toBe(0);
  });

  it('strips provider, image and voice API keys by default on backup export and preserves local keys on import', async () => {
    const ds = await db.providers.get('deepseek');
    expect(ds).toBeDefined();
    await db.providers.put({ ...ds!, apiKey: 'sk-secret-local-key' });
    await saveSettingsEncrypted({
      ...DEFAULT_SETTINGS,
      imageGen: { ...DEFAULT_SETTINGS.imageGen, apiKey: 'img-secret-key' },
      voice: {
        ...DEFAULT_SETTINGS.voice,
        ttsApiKey: 'tts-secret-key',
        sttApiKey: 'stt-secret-key',
      },
    });
    await db.personaPresets.put({
      id: 'preset1',
      name: '冷峻剑客',
      description: '测试预设',
      systemPrompt: '你是冷峻剑客',
      avatarColor: '#4d6bfe',
      createdAt: 1,
      updatedAt: 1,
    });
    await db.voiceProfiles.put({
      id: 'vp1',
      name: '剑客声线',
      engine: 'openai_api',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      voiceId: 'speech:sword:1:2',
      rate: 0.95,
      pitch: 1,
      volume: 1,
      gain: 2,
      styleInstruction: '低沉冷静地说',
      isCloned: true,
      createdAt: 1,
      updatedAt: 1,
    });

    const safeJson = await exportFullBackupJson(false);
    expect(safeJson).not.toContain('sk-secret-local-key');
    expect(safeJson).not.toContain('img-secret-key');
    expect(safeJson).not.toContain('tts-secret-key');
    expect(safeJson).not.toContain('stt-secret-key');
    expect(safeJson).toContain('冷峻剑客');
    expect(safeJson).toContain('剑客声线');

    const withKeyJson = await exportFullBackupJson(true);
    expect(withKeyJson).toContain('sk-secret-local-key');
    expect(withKeyJson).toContain('img-secret-key');
    expect(withKeyJson).toContain('tts-secret-key');

    await importFullBackupJson(safeJson);
    expect((await db.providers.get('deepseek'))?.apiKey).toBe('sk-secret-local-key');
    const restoredSettings = await loadSettingsDecrypted();
    expect(restoredSettings.imageGen.apiKey).toBe('img-secret-key');
    expect(restoredSettings.voice.ttsApiKey).toBe('tts-secret-key');
    expect(restoredSettings.voice.sttApiKey).toBe('stt-secret-key');
    expect((await db.voiceProfiles.get('vp1'))?.voiceId).toBe('speech:sword:1:2');
  });

  it('exports Markdown for sessions and worlds including temporal relations', () => {
    const mdSession = sessionToMarkdown(
      {
        id: 's1',
        title: '灵感讨论',
        pinned: false,
        providerId: 'deepseek',
        model: 'deepseek-chat',
        rollingSummary: '早期达成协议',
        enableWorldContext: false,
        createdAt: 1,
        updatedAt: 1,
      },
      [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: '正文回复',
          reasoning: '内部思考',
          thinkingDurationSec: 2.1,
          createdAt: 1,
        },
      ]
    );
    expect(mdSession).toContain('早期达成协议');
    expect(mdSession).toContain('<details>');

    const mdWorld = worldToMarkdown({
      world: {
        id: 'w1',
        name: '山海',
        genre: '奇幻',
        document: '## 地理\n九州',
        contextMode: 'progressive',
        pinnedSections: [],
        selectedSections: [],
        includeCharacters: true,
        includeTimeline: true,
        createdAt: 1,
        updatedAt: 1,
      },
      characters: [
        {
          id: 'c1',
          worldId: 'w1',
          name: '阿青',
          identity: '游侠',
          personality: '果敢',
          status: '',
          relationsNote: '',
          notes: '',
          avatarColor: '#4d6bfe',
          updatedAt: 1,
        },
        {
          id: 'c2',
          worldId: 'w1',
          name: '墨白',
          identity: '剑客',
          personality: '',
          status: '',
          relationsNote: '',
          notes: '',
          avatarColor: '#10b981',
          updatedAt: 1,
        },
      ],
      events: [
        {
          id: 'e1',
          worldId: 'w1',
          timeLabel: '初春',
          title: '山谷决裂',
          details: '意见不合',
          characterIds: ['c1', 'c2'],
          orderIndex: 1,
          updatedAt: 1,
        },
      ],
      relations: [
        {
          id: 'r1',
          worldId: 'w1',
          sourceId: 'c1',
          targetId: 'c2',
          directed: false,
          phases: [
            { id: 'p0', type: 'friend', label: '好友', strength: 2, description: '' },
            { id: 'p1', fromEventId: 'e1', type: 'hostile', label: '敌对', strength: 3, description: '' },
          ],
          updatedAt: 1,
        },
      ],
    });
    expect(mdWorld).toContain('《山海》世界观设定集');
    expect(mdWorld).toContain('跨时间人物关系演进');
    expect(mdWorld).toContain('事件「山谷决裂」之后');
  });

  it('blocks non-http/https external URLs', () => {
    expect(isSafeHttpUrl('https://platform.deepseek.com/api_keys')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('migrates legacy media configs into per-provider maps and preserves all provider keys on backup restore', async () => {
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      imageGen: {
        ...DEFAULT_SETTINGS.imageGen,
        presetId: 'siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'img-sf-legacy',
        model: 'Kwai-Kolors/Kolors',
      },
      voice: {
        ...DEFAULT_SETTINGS.voice,
        ttsEngine: 'openai_api',
        ttsProviderId: undefined,
        ttsBaseUrl: 'https://api.breeze.blue',
        ttsApiKey: 'tts-breeze-legacy',
        ttsModel: 'breeze-tts-2',
        ttsVoice: 'voc_123',
      },
    });
    const migrated = await loadSettingsDecrypted();
    expect(migrated.imageGen.providerConfigs?.siliconflow?.apiKey).toBe('img-sf-legacy');
    expect(migrated.voice.ttsProviderConfigs?.breeze?.apiKey).toBe('tts-breeze-legacy');

    // Configure both Breeze and SiliconFlow TTS keys locally
    await saveSettingsEncrypted({
      ...migrated,
      voice: {
        ...migrated.voice,
        ttsProviderConfigs: {
          breeze: {
            baseUrl: 'https://api.breeze.blue',
            apiKey: 'local-breeze-key',
            model: 'breeze-tts-2',
            defaultVoice: 'voc_breeze',
          },
          siliconflow_tts: {
            baseUrl: 'https://api.siliconflow.cn/v1',
            apiKey: 'local-sf-tts-key',
            model: 'FunAudioLLM/CosyVoice2-0.5B',
            defaultVoice: 'FunAudioLLM/CosyVoice2-0.5B:anna',
          },
        },
        sttProviderConfigs: {
          siliconflow_stt: {
            baseUrl: 'https://api.siliconflow.cn/v1',
            apiKey: 'local-sf-stt-key',
            model: 'FunAudioLLM/SenseVoiceSmall',
          },
        },
      },
    });

    const strippedBackup = await exportFullBackupJson(false);
    const parsedBackup = JSON.parse(strippedBackup);
    expect(parsedBackup.data.settings.voice.ttsProviderConfigs.breeze.apiKey).toBe('');
    expect(parsedBackup.data.settings.voice.ttsProviderConfigs.siliconflow_tts.apiKey).toBe('');
    expect(parsedBackup.data.settings.voice.sttProviderConfigs.siliconflow_stt.apiKey).toBe('');

    await importFullBackupJson(strippedBackup);
    const restored = await loadSettingsDecrypted();
    expect(restored.imageGen.providerConfigs?.siliconflow?.apiKey).toBe('img-sf-legacy');
    expect(restored.voice.ttsProviderConfigs?.breeze?.apiKey).toBe('local-breeze-key');
    expect(restored.voice.ttsProviderConfigs?.siliconflow_tts?.apiKey).toBe('local-sf-tts-key');
    expect(restored.voice.sttProviderConfigs?.siliconflow_stt?.apiKey).toBe('local-sf-stt-key');
  });
});
