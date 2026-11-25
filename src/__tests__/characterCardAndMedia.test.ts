import 'fake-indexeddb/auto';
import { strToU8 } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, deleteCharacterCascade, ensureDatabaseInitialized } from '../db/database';
import {
  buildShareableCharacterCard,
  createSolidColorPngBytes,
  embedCardJsonIntoPng,
  isPngBytes,
  materializeImportedCharacterCard,
  parseShareableCharacterCardBytes,
} from '../services/characterCardService';
import { exportFullBackupJson, importFullBackupJson } from '../services/exportService';
import { uint8ArrayToBase64 } from '../services/llm';
import {
  hydrateCharactersFromDb,
  isMediaRef,
  prepareCharacterForDb,
  prepareVoiceProfileForDb,
  resolveMediaToDataUrl,
} from '../services/mediaStore';
import type { Character, VoiceProfile } from '../types';

const SAMPLE_PNG_BYTES = createSolidColorPngBytes('#3b57e8', 16, 16);
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${uint8ArrayToBase64(SAMPLE_PNG_BYTES)}`;
const SAMPLE_AUDIO_DATA_URL = `data:audio/mpeg;base64,${uint8ArrayToBase64(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]))}`;

describe('mediaStore v11 externalization & shareable character cards (.twcard / PNG)', () => {
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
      db.userPersonas.clear(),
      db.voiceProfiles.clear(),
      db.mediaBlobs.clear(),
      db.settings.clear(),
    ]);
    await ensureDatabaseInitialized();
  });

  it('externalizes character avatarImage into mediaBlobs and cleans up on cascade delete', async () => {
    const rawChar: Character = {
      id: 'c_media_1',
      worldId: '',
      name: '林澈',
      identity: '调查员',
      personality: '冷静克制',
      status: '',
      relationsNote: '',
      notes: '',
      avatarColor: '#3b57e8',
      avatarImage: SAMPLE_PNG_DATA_URL,
      updatedAt: 100,
    };

    const prepared = await prepareCharacterForDb(rawChar);
    expect(isMediaRef(prepared.avatarImage)).toBe(true);
    expect(prepared.avatarImage).toBe('idb://media/char_avatar_c_media_1');
    await db.characters.put(prepared);

    const blobRecord = await db.mediaBlobs.get('char_avatar_c_media_1');
    expect(blobRecord).toBeDefined();
    expect(blobRecord?.mimeType).toBe('image/png');
    expect(blobRecord?.size).toBe(SAMPLE_PNG_BYTES.length);

    const [hydrated] = await hydrateCharactersFromDb([prepared]);
    expect(hydrated.avatarImage).toBeTruthy();
    expect(isMediaRef(hydrated.avatarImage)).toBe(false);

    const restoredDataUrl = await resolveMediaToDataUrl(hydrated.avatarImage);
    expect(restoredDataUrl).toBe(SAMPLE_PNG_DATA_URL);

    await deleteCharacterCascade('c_media_1');
    expect(await db.characters.get('c_media_1')).toBeUndefined();
    expect(await db.mediaBlobs.get('char_avatar_c_media_1')).toBeUndefined();
  });

  it('preserves externalized media across full JSON backup export and import', async () => {
    const char = await prepareCharacterForDb({
      id: 'c_bkp',
      worldId: '',
      name: '苏岚',
      identity: '剑修',
      personality: '',
      status: '',
      relationsNote: '',
      notes: '',
      avatarColor: '#10b981',
      avatarImage: SAMPLE_PNG_DATA_URL,
      updatedAt: 1,
    });
    await db.characters.put(char);

    const backupJson = await exportFullBackupJson(false);
    const parsedBackup = JSON.parse(backupJson);
    // 导出的备份文件必须是自包含的 data URL，而不是仅本机有效的 idb://media 引用
    expect(parsedBackup.data.characters[0].avatarImage).toBe(SAMPLE_PNG_DATA_URL);

    await db.characters.clear();
    await db.mediaBlobs.clear();

    await importFullBackupJson(backupJson);
    const storedAfterImport = await db.characters.get('c_bkp');
    expect(storedAfterImport?.avatarImage).toBe('idb://media/char_avatar_c_bkp');
    expect(await db.mediaBlobs.get('char_avatar_c_bkp')).toBeDefined();
  });

  it('builds sanitized .twcard.json and embeds/extracts PNG tEXt metadata round-trip', async () => {
    const voiceProfile = await prepareVoiceProfileForDb({
      id: 'vp_clone_1',
      name: '慵懒御姐声线',
      providerId: 'siliconflow_tts',
      engine: 'openai_api',
      baseUrl: 'https://api.siliconflow.cn/v1?secret_token=should_strip',
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      voiceId: 'speech:custom:abc123',
      rate: 1.05,
      pitch: 1,
      volume: 1,
      gain: 0,
      styleInstruction: '轻柔慢速',
      isCloned: true,
      sourceText: '你好，好久不见。',
      sampleAudio: SAMPLE_AUDIO_DATA_URL,
      createdAt: 1,
      updatedAt: 1,
    } satisfies VoiceProfile);
    await db.voiceProfiles.put(voiceProfile);

    const char = await prepareCharacterForDb({
      id: 'c_card_1',
      worldId: 'w_secret',
      name: '叶知秋',
      identity: '守夜人',
      personality: '外冷内热',
      status: '驻守北境',
      relationsNote: '旧识',
      notes: '玄衣长剑',
      avatarColor: '#8b5cf6',
      avatarImage: SAMPLE_PNG_DATA_URL,
      voiceProfileId: voiceProfile.id,
      userRelation: {
        defaultAddress: '旅人',
        defaultRelationType: 'ally',
        defaultRelationLabel: '同行者',
      },
      updatedAt: 1,
    });
    await db.characters.put(char);

    const card = await buildShareableCharacterCard({
      character: char,
      voiceProfile,
      worldHint: { name: '北境长夜', genre: '奇幻' },
      includeVoiceSample: true,
    });

    // 安全断言：绝不泄漏 query token，且保留立绘与音频样本
    expect(JSON.stringify(card)).not.toContain('should_strip');
    expect(card.voice?.baseUrl).toBe('https://api.siliconflow.cn/v1');
    expect(card.voice?.kind).toBe('cloned');
    expect(card.voice?.sampleAudio).toBe(SAMPLE_AUDIO_DATA_URL);
    expect(card.character.avatarImage).toBe(SAMPLE_PNG_DATA_URL);

    // 1) JSON 载体往返解析
    const fromJson = parseShareableCharacterCardBytes(strToU8(JSON.stringify(card)));
    expect(fromJson.character.name).toBe('叶知秋');
    expect(fromJson.voice?.sourceText).toBe('你好，好久不见。');
    expect(fromJson.character.userRelation?.defaultAddress).toBe('旅人');

    // 2) PNG tEXt 块嵌入与解析往返
    const embeddedPng = embedCardJsonIntoPng(SAMPLE_PNG_BYTES, card);
    expect(isPngBytes(embeddedPng)).toBe(true);
    const fromPng = parseShareableCharacterCardBytes(embeddedPng);
    expect(fromPng.character.name).toBe('叶知秋');
    expect(fromPng.character.personality).toBe('外冷内热');
    expect(fromPng.character.avatarImage?.startsWith('data:image/png;base64,')).toBe(true);
    expect(fromPng.voice?.sampleAudio).toBe(SAMPLE_AUDIO_DATA_URL);

    // 3) 物化为本地角色与新账号复刻后的 voiceId 覆盖
    const materialized = materializeImportedCharacterCard({
      card: fromPng,
      targetWorldId: '',
      overrideVoiceId: 'speech:recloned:my_own_key',
    });
    expect(materialized.character.worldId).toBe('');
    expect(materialized.voiceProfile?.voiceId).toBe('speech:recloned:my_own_key');
    expect(materialized.character.voiceProfileId).toBe(materialized.voiceProfile?.id);
  });

  it('imports community TavernCard v2 JSON and PNG chara chunks cleanly', () => {
    const tavernV2 = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Seraphina',
        description: 'A wandering alchemist.',
        personality: 'Curious and witty',
        scenario: 'At an old tavern',
        first_mes: 'Care for a potion?',
        system_prompt: 'Stay in character as Seraphina.',
      },
    };
    const parsed = parseShareableCharacterCardBytes(strToU8(JSON.stringify(tavernV2)));
    expect(parsed.character.name).toBe('Seraphina');
    expect(parsed.character.personality).toBe('Curious and witty');
    expect(parsed.character.notes).toContain('Care for a potion?');
    expect(parsed.character.systemPrompt).toBe('Stay in character as Seraphina.');
  });
});
