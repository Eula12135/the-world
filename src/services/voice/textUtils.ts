export function isBreezeCloudBase(baseUrl: string): boolean {
  return /api\.breeze\.blue|breezeblue\.ai/i.test(baseUrl.trim());
}

export function normalizeBreezeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (!trimmed || /breezeblue\.ai/i.test(trimmed)) {
    return 'https://api.breeze.blue';
  }
  return trimmed;
}

export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' 代码片段已略过 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSpeechChunks(text: string, maxLen = 220): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const sentences = clean
    .split(/(?<=[。！？；.!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (s.length > maxLen) {
      if (buf) {
        chunks.push(buf);
        buf = '';
      }
      for (let i = 0; i < s.length; i += maxLen) {
        chunks.push(s.slice(i, i + maxLen));
      }
      continue;
    }
    if (buf.length + s.length > maxLen) {
      if (buf) chunks.push(buf);
      buf = s;
    } else {
      buf += (buf ? ' ' : '') + s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * 把上游返回的 JSON 错误体压成一句人话。
 * 422 通常是「参数取值越界」（例如 speed / guidance_scale 要求 >= 1），
 * 原文只是一串 JSON，直接丢给用户只会更困惑。
 */
export function formatTtsHttpError(status: number, errorText: string): string {
  const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  let detail = '';
  try {
    const parsed = JSON.parse(errorText);
    detail =
      pick(parsed?.detail) ||
      pick(parsed?.error?.message) ||
      pick(parsed?.error) ||
      pick(parsed?.message);
  } catch {
    detail = errorText.trim().slice(0, 160);
  }

  const head = `TTS 接口失败 (HTTP ${status})${detail ? `：${detail}` : ''}`;
  if (status === 422) {
    return `${head}\n\n服务端判定参数不合法。请先把语速调回 1.00x、清空音色描述再试一次；若仍然 422，说明该接口不支持当前「模型 + 参数」组合，建议换用硅基流动或 OpenAI 官方语音接口。`;
  }
  if (status === 401 || status === 403) {
    return `${head}\n\n鉴权失败：请检查「模型 → 语音」里的 TTS API Key 是否正确、是否已过期。`;
  }
  return head;
}

export function sanitizeCloneCustomName(rawName: string): string {
  const asciiOnly = rawName
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return asciiOnly || `voice_${Date.now().toString(36)}`;
}
