import type { ChatMessage, ProviderConfig } from '../types';
import { detectUnreachableLocalhost } from '../utils/platform';
import { crossPlatformFetchJson, safeJsonParse } from './llm';

export async function compressConversationMemory(params: {
  provider: ProviderConfig;
  model: string;
  existingSummary?: string;
  messagesToCompress: ChatMessage[];
}): Promise<string> {
  const { provider, model, existingSummary, messagesToCompress } = params;
  const cleanMsgs = messagesToCompress.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (cleanMsgs.length === 0) return existingSummary || '';

  if (provider.requiresKey && !provider.apiKey.trim()) {
    throw new Error(`尚未填写 ${provider.name} 的 API Key，无法压缩记忆`);
  }
  const localhostHint = detectUnreachableLocalhost(provider.baseUrl);
  if (localhostHint) {
    throw new Error(localhostHint);
  }

  const transcript = cleanMsgs
    .map((m) => `${m.role === 'user' ? '作者' : 'AI'}: ${m.content.slice(0, 4000)}`)
    .join('\n\n')
    .slice(0, 80000);

  const sys =
    '你是小说长程记忆整理助手。请将已有前情提要与新增对话浓缩成 200~450 字的结构化【前情记忆】，严格保留：1）已确立的新设定或剧情决议；2）角色关系或状态的变化；3）未回收的伏笔与当前推进到的场景。语言紧凑客观，不要寒暄。';
  const userContent = `${existingSummary?.trim() ? `【已有前情提要】\n${existingSummary.trim()}\n\n` : ''}【待归档对话】\n${transcript}`;

  const cleanBase = provider.baseUrl.replace(/\/+$/, '');
  if (provider.protocol === 'anthropic') {
    const resp = await crossPlatformFetchJson({
      url: `${cleanBase}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        temperature: 0.25,
        system: sys,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!resp.ok) throw new Error(`记忆压缩失败 (HTTP ${resp.status})`);
    const parsed = safeJsonParse<{ content?: Array<{ text?: string }> }>(resp.text, '记忆压缩接口');
    const blocks = Array.isArray(parsed?.content) ? parsed.content : [];
    return blocks
      .map((b) => b.text || '')
      .join('')
      .trim();
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/chat/completions`,
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.25,
      max_tokens: 800,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`记忆压缩失败 (HTTP ${resp.status})`);
  const parsed = safeJsonParse<{ choices?: Array<{ message?: { content?: string } }> }>(
    resp.text,
    '记忆压缩接口'
  );
  return String(parsed?.choices?.[0]?.message?.content || '').trim();
}
