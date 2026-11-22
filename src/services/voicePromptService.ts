import type { Character, ProviderConfig, WorldProject } from '../types';
import { crossPlatformFetchJson } from './llm';

/**
 * 把角色卡与所属作品压成一段给模型看的参考文本。
 * 只取与"声音"有关的线索，避免把外貌描写也塞进去影响判断。
 */
export function buildVoiceBrief(character: Character, world?: WorldProject | null): string {
  const lines: string[] = [];
  lines.push(`角色姓名：${character.name}`);
  if (world?.name) lines.push(`所属作品：${world.name}`);
  if (world?.genre) lines.push(`作品题材：${world.genre}`);
  if (character.identity) lines.push(`身份定位：${character.identity.slice(0, 120)}`);
  if (character.personality) lines.push(`性格气质：${character.personality.slice(0, 160)}`);
  if (character.status) lines.push(`当前状态：${character.status.slice(0, 80)}`);
  if (character.notes) lines.push(`补充细节：${character.notes.slice(0, 200)}`);
  return lines.join('\n');
}

const VOICE_DESIGN_SYSTEM_PROMPT = `你是配音导演，负责为小说角色设计音色。
请根据角色资料，写一段用于「语音合成音色设计」的中文描述，严格遵守：
1) 一句话、40~80 个汉字，单行，不要换行、不要引号、不要分点、不要标题
2) 覆盖：性别与年龄段、音色质感（清亮 / 沙哑 / 磁性 / 温润 / 少年感等）、语速与节奏、情绪基调、说话习惯
3) 只写"声音听起来是什么样"，不要写外貌、服饰、剧情，也不要堆砌性格形容词
4) 不要出现"这个声音""以下""描述"之类的元话语
直接输出描述本身，不要任何解释或前后缀。`;

/** 清洗模型输出：去引号、去换行、压空格、限长 */
export function sanitizeVoiceDescription(raw: string): string {
  let text = String(raw || '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/g, '')
    .replace(/^["'“”「『]|["'“”」』]$/g, '')
    .replace(/^(音色描述|描述|答案)[:：]\s*/i, '')
    .replace(/\s*\r?\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // 过长时按句号截断，避免把整段议论文塞进 TTS 描述
  if (text.length > 120) {
    const cut = text.slice(0, 120);
    const lastPunct = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('。'), cut.lastIndexOf('、'));
    text = (lastPunct > 40 ? cut.slice(0, lastPunct) : cut).trim();
  }
  return text;
}

/**
 * 调用当前文本模型，为角色卡生成一段音色描述（用于 Voice Design 或 TTS 表演指令）。
 */
export async function generateVoiceDescription(params: {
  provider: ProviderConfig;
  model: string;
  character: Character;
  world?: WorldProject | null;
  extraHint?: string;
}): Promise<string> {
  const { provider, model, character, world, extraHint } = params;

  if (provider.requiresKey && !provider.apiKey.trim()) {
    throw new Error(`尚未填写 ${provider.name} 的 API Key，无法生成音色描述`);
  }

  const brief = buildVoiceBrief(character, world);
  const userContent = extraHint?.trim()
    ? `${brief}\n\n额外要求：${extraHint.trim()}`
    : brief;

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
        max_tokens: 300,
        temperature: 0.7,
        system: VOICE_DESIGN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!resp.ok) throw new Error(`生成音色描述失败 (HTTP ${resp.status})`);
    const parsed = JSON.parse(resp.text);
    const blocks = Array.isArray(parsed?.content) ? parsed.content : [];
    const text = blocks.map((b: { text?: string }) => b.text || '').join('');
    return sanitizeVoiceDescription(text);
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;

  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/chat/completions`,
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 300,
      messages: [
        { role: 'system', content: VOICE_DESIGN_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`生成音色描述失败 (HTTP ${resp.status})`);

  const parsed = JSON.parse(resp.text);
  const text = String(parsed?.choices?.[0]?.message?.content || '');
  return sanitizeVoiceDescription(text);
}
