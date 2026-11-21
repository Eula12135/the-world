import { describe, expect, it } from 'vitest';
import { buildCharacterImagePrompt, resolveReusableApiKey } from '../services/imageGenService';
import { splitSpeechChunks, stripMarkdownForSpeech } from '../services/voiceService';
import type { Character, ProviderConfig, WorldProject } from '../types';

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
});
