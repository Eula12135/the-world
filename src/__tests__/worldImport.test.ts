import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  buildExtractionSnippet,
  decodeTextBytes,
  extractJsonObject,
  extractTextFromDocx,
  extractWorldWithAI,
  materializeExtractedWorldEntities,
  normalizeTextToWorldMarkdown,
} from '../services/worldImport';
import { DEFAULT_SETTINGS } from '../db/database';
import type { ProviderConfig } from '../types';

describe('worldImport service', () => {
  it('normalizes plain text headings into ## Markdown sections', () => {
    const raw = `# 世界观背景\n天穹大陆分为东西两域。\n【力量体系】\n以星辉共鸣为核心。\n一、禁忌规则\n严禁逆转因果。`;
    const md = normalizeTextToWorldMarkdown(raw);
    expect(md).toContain('## 世界观背景');
    expect(md).toContain('## 力量体系');
    expect(md).toContain('## 一、禁忌规则');
  });

  it('decodes UTF-8 and GB18030 text files and strips leading blank lines', () => {
    // Leading blank lines + GBK bytes for "中文" (D6 D0 CE C4)
    const gbkBytes = new Uint8Array([0x0d, 0x0a, 0x0a, 0xd6, 0xd0, 0xce, 0xc4]);
    const decoded = decodeTextBytes(gbkBytes);
    expect(decoded.encoding).toBe('GB18030');
    expect(decoded.text).toBe('中文');

    const utf8WithBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x0a, ...strToU8('龙枪编年史')]);
    const decodedUtf8 = decodeTextBytes(utf8WithBom);
    expect(decodedUtf8.encoding).toBe('UTF-8');
    expect(decodedUtf8.text).toBe('龙枪编年史');
  });

  it('extracts paragraphs and headings from synthetic .docx zip', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>星海编年史</w:t></w:r></w:p>
          <w:p><w:r><w:t>殖民舰队于新历元年启航。</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>核心规则</w:t></w:r></w:p>
          <w:p><w:r><w:t>航行必须休眠。</w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    const docxBytes = zipSync({
      'word/document.xml': strToU8(docXml),
    });
    const text = extractTextFromDocx(docxBytes);
    expect(text).toContain('## 星海编年史');
    expect(text).toContain('殖民舰队于新历元年启航。');
    expect(text).toContain('## 核心规则');
    expect(text).toContain('航行必须休眠。');
  });

  it('strips <think> tags and repairs truncated AI JSON responses', () => {
    const withThink =
      '<think>先分析世界观...</think>\n```json\n{"name":"风起","genre":"玄幻","worldSummary":"## 概述\\n群山",}\n```';
    const obj1 = extractJsonObject(withThink);
    expect(obj1.name).toBe('风起');

    const truncatedMidString =
      '{"name":"秋暮之巨龙","genre":"奇幻","characters":[{"name":"坦尼斯","identity":"半精灵';
    const obj2 = extractJsonObject(truncatedMidString);
    expect(obj2.name).toBe('秋暮之巨龙');
    expect((obj2.characters as Array<{ name: string; identity: string }>)[0]).toEqual({
      name: '坦尼斯',
      identity: '半精灵',
    });

    const truncatedAfterColon = '{"name":"秋暮之巨龙","characters":[{"name":"雷斯林","identity":';
    const obj3 = extractJsonObject(truncatedAfterColon);
    expect((obj3.characters as Array<{ name: string }>)[0].name).toBe('雷斯林');
  });

  it('samples head/mid/tail for long novels and invokes AI extraction with json_object fallback', async () => {
    const longNovel = `## 第一章\n${'长篇奇幻冒险正文。'.repeat(6000)}`;
    const { snippet, sampled } = buildExtractionSnippet(longNovel, 42000);
    expect(sampled).toBe(true);
    expect(snippet).toContain('中段节选');
    expect(snippet.length).toBeLessThan(42100);

    const mockFetch = vi.fn();
    mockFetch
      .mockResolvedValueOnce(new Response('json_object not supported', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    name: '秋暮之巨龙',
                    genre: '奇幻',
                    worldSummary: '## 世界概述\n克莱恩大陆灾变后的时代。',
                    characters: [
                      {
                        name: '坦尼斯',
                        identity: '半精灵领袖',
                        personality: '重情重义',
                        status: '旅途中',
                        relationsNote: '',
                        notes: '',
                      },
                    ],
                    timelineEvents: [],
                    relations: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        )
      );

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      const provider: ProviderConfig = {
        id: 'deepseek',
        name: 'DeepSeek',
        description: '',
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        consoleUrl: '',
        docsUrl: '',
        websiteUrl: '',
        requiresKey: true,
        enabled: true,
        isCustom: false,
      };
      const res = await extractWorldWithAI({
        provider,
        model: 'deepseek-chat',
        settings: DEFAULT_SETTINGS,
        rawText: longNovel,
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(res.sampled).toBe(true);
      expect(res.name).toBe('秋暮之巨龙');
      expect(res.document).toContain('克莱恩大陆');
      expect(res.originalDocument?.length).toBeGreaterThan(45000);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('materializes characters, events and temporal relations', () => {
    const res = materializeExtractedWorldEntities('w1', {
      name: '风起',
      genre: '玄幻',
      document: '## 概述\n群山之间',
      characters: [
        {
          name: '林澈',
          identity: '剑修',
          personality: '沉稳',
          status: '游历中',
          relationsNote: '',
          notes: '',
        },
        {
          name: '沈墨',
          identity: '世子',
          personality: '多疑',
          status: '守城',
          relationsNote: '',
          notes: '',
        },
      ],
      timelineEvents: [
        {
          timeLabel: '十年前',
          title: '山门结义',
          details: '立下誓言',
          characterNames: ['林澈', '沈墨'],
        },
        {
          timeLabel: '今年冬',
          title: '雪夜决裂',
          details: '道不同不相为谋',
          characterNames: ['林澈', '沈墨'],
        },
      ],
      relations: [
        {
          sourceName: '林澈',
          targetName: '沈墨',
          directed: false,
          phases: [
            { type: 'friend', label: '挚友', strength: 3, description: '患难与共' },
            {
              atEventTitle: '雪夜决裂',
              type: 'hostile',
              label: '敌对',
              strength: 3,
              description: '彻底反目',
            },
          ],
        },
      ],
    });

    expect(res.characters).toHaveLength(2);
    expect(res.events).toHaveLength(2);
    expect(res.relations).toHaveLength(1);
    expect(res.relations[0].phases[0].fromEventId).toBeUndefined();
    expect(res.relations[0].phases[1].fromEventId).toBe(res.events[1].id);
  });

  it('recognizes numeric/Title Word heading styles and preserves truncated array string items', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>大纪元总览</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>第一章 世界格局</w:t></w:r></w:p>
          <w:p><w:r><w:t>南北分治百年。</w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    const docxBytes = zipSync({ 'word/document.xml': strToU8(docXml) });
    const text = extractTextFromDocx(docxBytes);
    expect(text).toContain('## 大纪元总览');
    expect(text).toContain('## 第一章 世界格局');

    const truncatedArray = '{"name":"九州","timelineEvents":[{"timeLabel":"元年","title":"启程","details":"x","characterNames":["林澈","苏岚"';
    const parsed = extractJsonObject(truncatedArray);
    expect(parsed.name).toBe('九州');
    expect((parsed.timelineEvents as Array<{ characterNames: string[] }>)[0].characterNames).toEqual([
      '林澈',
      '苏岚',
    ]);
  });
});
