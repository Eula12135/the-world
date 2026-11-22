import { describe, expect, it } from 'vitest';
import { buildVoiceBrief, sanitizeVoiceDescription } from '../services/voicePromptService';
import type { Character, WorldProject } from '../types';

const character: Character = {
  id: 'c1',
  worldId: 'w1',
  name: '林澈',
  identity: '游侠剑士，出身北境',
  personality: '表面冷静克制，实则重情',
  status: '负伤',
  relationsNote: '',
  notes: '说话简短，习惯先停顿再开口',
  avatarColor: '#4d6bfe',
  updatedAt: 1,
};

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

describe('voicePromptService', () => {
  it('builds a voice brief from the character card and its world', () => {
    const brief = buildVoiceBrief(character, world);
    expect(brief).toContain('角色姓名：林澈');
    expect(brief).toContain('所属作品：苍穹余烬');
    expect(brief).toContain('作品题材：奇幻');
    expect(brief).toContain('身份定位：游侠剑士');
    expect(brief).toContain('性格气质：');
    expect(brief).toContain('当前状态：负伤');
    expect(brief).toContain('说话简短');

    // 没有作品时也不能报错
    expect(buildVoiceBrief(character, null)).toContain('角色姓名：林澈');
    expect(
      buildVoiceBrief({ ...character, systemPrompt: '以冷淡剑客口吻对话' }, null)
    ).toContain('人设提示词：以冷淡剑客口吻对话');
  });

  it('sanitizes model output into a single clean line and strips think blocks', () => {
    expect(sanitizeVoiceDescription('“成熟慵懒的御姐女声，略带笑意。”')).toBe(
      '成熟慵懒的御姐女声，略带笑意。'
    );
    expect(sanitizeVoiceDescription('音色描述：清亮少年音\n语速偏快')).toBe('清亮少年音 语速偏快');
    expect(sanitizeVoiceDescription('```\n低沉磁性男声\n```')).toBe('低沉磁性男声');
    expect(
      sanitizeVoiceDescription('<think>用户想要一段40到80字的音色描述，我先构思一下。</think>“清冷克制的青年男声，语速偏慢。”')
    ).toBe('清冷克制的青年男声，语速偏慢。');
    expect(sanitizeVoiceDescription('  ')).toBe('');
  });

  it('caps overlong descriptions and keeps them on one line', () => {
    const long = '柔和清澈的女声，'.repeat(20);
    const out = sanitizeVoiceDescription(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.includes('\n')).toBe(false);
  });
});
