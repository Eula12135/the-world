import type { ChatMessage, ProviderConfig } from '../types';
import { detectUnreachableLocalhost } from '../utils/platform';
import { crossPlatformFetchJson, safeJsonParse } from './llm';

/** 摘要低于这个字数就视为失败：宁可报错，也不要拿空内容覆盖旧前情 */
export const MIN_SUMMARY_CHARS = 10;

/**
 * 推理模型不接受 `temperature`，且思考过程会吃掉输出预算。
 * 名单永远补不全，所以这里只是「第一层」，真正的兜底是下面的错误驱动重试。
 */
export function isReasoningModel(model: string): boolean {
  const m = String(model || '').toLowerCase();
  if (/^o[1-9](\b|[-_.])/.test(m)) return true;
  if (m.includes('reasoner')) return true;
  if (/(^|[-_/])r1([-_/]|$)/.test(m)) return true;
  if (m.includes('thinking')) return true;
  return false;
}

export interface MemoryRequestParams {
  max_tokens: number;
  temperature?: number;
}

export function buildMemoryRequestParams(model: string, omitTemperature = false): MemoryRequestParams {
  const reasoning = isReasoningModel(model);
  const params: MemoryRequestParams = { max_tokens: reasoning ? 4000 : 800 };
  // 推理模型传 temperature 会直接 400；兜底重试时也会显式省略
  if (!reasoning && !omitTemperature) params.temperature = 0.25;
  return params;
}

/** 摘要内容校验：空或过短都判失败，避免把旧前情清掉 */
export function assertUsableSummary(text: string): string {
  const summary = String(text || '').trim();
  if (summary.length < MIN_SUMMARY_CHARS) {
    throw new Error('记忆压缩失败：模型返回为空或过短，已保留原有前情');
  }
  return summary;
}

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
  const isAnthropic = provider.protocol === 'anthropic';

  const call = async (omitTemperature: boolean) => {
    const tuning = buildMemoryRequestParams(model, omitTemperature);
    if (isAnthropic) {
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
          max_tokens: tuning.max_tokens,
          ...(tuning.temperature !== undefined ? { temperature: tuning.temperature } : {}),
          system: sys,
          messages: [{ role: 'user', content: userContent }],
        }),
      });
      return resp;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
    return crossPlatformFetchJson({
      url: `${cleanBase}/chat/completions`,
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        ...tuning,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userContent },
        ],
      }),
    });
  };

  let resp = await call(false);

  // 错误驱动兜底：未知厂商/新推理模型仍可能因为 temperature 被拒，去掉它重试一次
  if (!resp.ok && (resp.status === 400 || resp.status === 422)) {
    const mentionsTemperature = /temperature/i.test(resp.text || '');
    if (mentionsTemperature) {
      resp = await call(true);
    }
  }

  if (!resp.ok) throw new Error(`记忆压缩失败 (HTTP ${resp.status})`);

  const text = isAnthropic
    ? (safeJsonParse<{ content?: Array<{ text?: string }> }>(resp.text, '记忆压缩接口')?.content ?? [])
        .map((b) => b.text || '')
        .join('')
    : String(
        safeJsonParse<{ choices?: Array<{ message?: { content?: string } }> }>(
          resp.text,
          '记忆压缩接口'
        )?.choices?.[0]?.message?.content || ''
      );

  return assertUsableSummary(text);
}
