import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { materializeImportedSessions, parseDeepSeekArchive } from '../services/deepseekImport';

describe('parseDeepSeekArchive', () => {
  it('parses DeepSeek Export v3 ZIP with branch resolution and fragment types', async () => {
    const sessionA = {
      id: '11111111-1111-1111-1111-111111111111',
      title: '世界观设定讨论',
      pinned: true,
      current_message_id: 4,
      inserted_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:10:00Z',
      messages: [
        {
          id: 1,
          parent_id: null,
          role: 'USER',
          inserted_at: '2026-10-01T10:00:01Z',
          fragments: [{ type: 'REQUEST', content: '帮我设计历法' }],
        },
        {
          id: 2,
          parent_id: 1,
          role: 'ASSISTANT',
          inserted_at: '2026-10-01T10:00:05Z',
          fragments: [
            { type: 'THINK', content: '考虑太阳与双月周期', elapsed_secs: 3.4 },
            { type: 'RESPONSE', content: '可以用双月潮汐划分月份。' },
          ],
        },
        {
          id: 3,
          parent_id: 1,
          role: 'ASSISTANT',
          inserted_at: '2026-10-01T10:02:00Z',
          fragments: [{ type: 'RESPONSE', content: '这是一条被分支替换的旧回复' }],
        },
        {
          id: 4,
          parent_id: 2,
          role: 'USER',
          inserted_at: '2026-10-01T10:05:00Z',
          fragments: [{ type: 'REQUEST', content: '继续补充节日名称' }],
        },
      ],
    };

    const sessionB = {
      id: '22222222-2222-2222-2222-222222222222',
      title: '带搜索与风险提示的对话',
      pinned: false,
      current_message_id: 2,
      inserted_at: '2026-10-02T08:00:00Z',
      updated_at: '2026-10-02T08:01:00Z',
      messages: [
        {
          id: 1,
          parent_id: null,
          role: 'USER',
          fragments: [{ type: 'REQUEST', content: '查询天文现象' }],
        },
        {
          id: 2,
          parent_id: 1,
          role: 'ASSISTANT',
          fragments: [
            { type: 'TOOL_SEARCH', queries: ['日全食 周期'] },
            { type: 'TOOL_OPEN', url: 'https://example.com', title: '天文资料' },
            { type: 'RESPONSE', content: '沙罗周期约为18年。' },
            { type: 'CONTENT_RISK', content: '仅供参考' },
          ],
        },
      ],
    };

    const zipBytes = zipSync({
      'manifest.json': strToU8(JSON.stringify({ export_format_version: 3 })),
      'chat_session_index.json': strToU8(
        JSON.stringify([
          { id: sessionB.id, title: sessionB.title },
          { id: sessionA.id, title: sessionA.title },
        ])
      ),
      [`chat_sessions/${sessionA.id}.json`]: strToU8(JSON.stringify(sessionA)),
      [`chat_sessions/${sessionB.id}.json`]: strToU8(JSON.stringify(sessionB)),
    });

    const bundle = await parseDeepSeekArchive(
      zipBytes,
      'deepseek_data.zip',
      new Set([sessionB.id])
    );

    expect(bundle.formatVersion).toBe('DeepSeek Export v3');
    expect(bundle.sessions).toHaveLength(2);
    expect(bundle.sessions[0].sourceId).toBe(sessionB.id);
    expect(bundle.sessions[0].isDuplicate).toBe(true);
    expect(bundle.sessions[0].messages[1].searchQueries).toEqual(['日全食 周期']);
    expect(bundle.sessions[0].messages[1].warningNote).toBe('仅供参考');

    const parsedA = bundle.sessions[1];
    expect(parsedA.messages).toHaveLength(3);
    expect(parsedA.messages.map((m) => m.content)).toEqual([
      '帮我设计历法',
      '可以用双月潮汐划分月份。',
      '继续补充节日名称',
    ]);
    expect(parsedA.messages[1].reasoning).toBe('考虑太阳与双月周期');
    expect(parsedA.messages[1].thinkingDurationSec).toBe(3.4);

    const materialized = materializeImportedSessions(bundle.sessions, 'deepseek', 'deepseek-chat');
    expect(materialized.sessions).toHaveLength(2);
    expect(materialized.messages).toHaveLength(5);
    expect(materialized.sessions[0].importedFrom).toBe('deepseek');
  });

  it('prevents infinite loops on cyclic parent_id references', async () => {
    const cyclic = {
      id: 'cyclic-1',
      title: '环路测试',
      current_message_id: 2,
      messages: [
        { id: 1, parent_id: 2, role: 'USER', fragments: [{ type: 'REQUEST', content: 'A' }] },
        { id: 2, parent_id: 1, role: 'ASSISTANT', fragments: [{ type: 'RESPONSE', content: 'B' }] },
      ],
    };
    const bundle = await parseDeepSeekArchive(strToU8(JSON.stringify(cyclic)), 'cyclic.json');
    expect(bundle.sessions).toHaveLength(1);
    expect(bundle.sessions[0].messages).toHaveLength(2);
  });

  it('parses legacy conversations.json mapping tree', async () => {
    const legacy = [
      {
        id: 'legacy-1',
        title: '旧版格式',
        mapping: {
          root: { id: 'root', children: ['n1'] },
          n1: {
            id: 'n1',
            parent: 'root',
            message: { role: 'user', content: '你好' },
            children: ['n2'],
          },
          n2: {
            id: 'n2',
            parent: 'n1',
            message: { role: 'assistant', reasoning_content: '思考中', content: '你好！' },
            children: [],
          },
        },
      },
    ];
    const bytes = strToU8(JSON.stringify(legacy));
    const bundle = await parseDeepSeekArchive(bytes, 'conversations.json');
    expect(bundle.sessions).toHaveLength(1);
    expect(bundle.sessions[0].messages).toHaveLength(2);
    expect(bundle.sessions[0].messages[1].reasoning).toBe('思考中');
  });

  it('rejects empty or invalid archives', async () => {
    const emptyZip = zipSync({ 'manifest.json': strToU8('{}') });
    await expect(parseDeepSeekArchive(emptyZip, 'empty.zip')).rejects.toThrow();
  });
});
