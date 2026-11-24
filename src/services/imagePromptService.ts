import type { Character, ProviderConfig, WorldProject } from '../types';
import { crossPlatformFetchJson } from './llm';
import { resolveImageFraming, type ImageFraming } from '../utils/imageFraming';

/**
 * 给模型看的角色资料。
 * 字段给得比本地规则宽 —— 模型比关键词更能分辨哪句能画、哪句是剧情。
 */
export function buildImageBrief(character: Character, world?: WorldProject | null): string {
  const lines: string[] = [];
  lines.push(`角色姓名：${character.name || '未命名角色'}`);
  if (world?.name) lines.push(`所属作品：${world.name}`);
  if (world?.genre) lines.push(`作品题材：${world.genre}`);
  if (character.identity) lines.push(`身份定位：${character.identity.slice(0, 120)}`);
  if (character.personality) lines.push(`性格气质：${character.personality.slice(0, 240)}`);
  if (character.notes) lines.push(`补充细节：${character.notes.slice(0, 500)}`);
  return lines.join('\n');
}

const IMAGE_PROMPT_SYSTEM = (framing: ImageFraming) => `你是小说${framing.subject}的提示词工程师。请从角色资料中提炼一段用于「文生图」的中文提示词，严格遵守：
1) 只提取能画出来的信息：性别、年龄感、身高体型、面部五官、发型发色、瞳色、肤色、服饰配饰、气质神态
2) 绝对不要出现：台词、对话、心理活动、剧情事件、人物关系、以及「重情义」「很可靠」这类无法画出来的性格评价
3) 不要出现「这个角色」「以下」「描述」之类的元话语，也不要引号、分点、标题、换行
4) 输出 60~120 个汉字，单行，用逗号分隔的短语罗列
5) 资料里没写的外貌信息不要编造，宁可少写
6) 本图取景是「${framing.label}」：${framing.composition}。只写这个取景里看得见的部位，看不见的（比如头像看不到的裤子和鞋）一跳而过
7) 不要自己写「头像」「半身」「全身」「特写」「镜头」「构图」这类取景词，取景由程序统一追加，你只负责人物本身
直接输出提示词本身，不要任何解释或前后缀。`;

/** 取景约束由程序统一追加，保证「选了头像就不会画出全身」 */
function withFramingClause(prompt: string, framing: ImageFraming): string {
  if (!prompt) return `${framing.composition}，${framing.avoid}`;
  // 模型偶尔会自己把整句构图写回来，避免重复
  if (prompt.includes(framing.composition)) return prompt;
  return `${prompt}，${framing.composition}，${framing.avoid}`;
}

/** 清洗模型输出：去思考块、去代码围栏、去引号、压成单行、限长 */
export function sanitizeImagePrompt(raw: string): string {
  let text = String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/g, '')
    .replace(/[「」『』“”"]/g, '')
    .replace(/\s*\r?\n+\s*/g, '，')
    // 换行转成逗号后开头会残留标点，先清掉再剥「提示词：」这类前缀
    .replace(/^[,，。、\s]+/, '')
    .replace(/^(提示词|画面描述|描述|答案)[:：]\s*/i, '')
    .replace(/[,，]\s*[,，]+/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (text.length > 240) {
    const cut = text.slice(0, 240);
    const lastPunct = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('。'), cut.lastIndexOf('、'));
    text = (lastPunct > 80 ? cut.slice(0, lastPunct) : cut).trim();
  }
  return text.replace(/^[,，。、]+|[,，。、]+$/g, '');
}

function extractApiErrorDetail(rawText: string, status: number): string {
  try {
    const parsed = JSON.parse(rawText);
    const msg = parsed?.error?.message || parsed?.message || parsed?.detail;
    if (typeof msg === 'string' && msg.trim()) {
      return `AI 提炼提示词失败 (HTTP ${status}：${msg.trim().slice(0, 120)})`;
    }
  } catch {
    // ignore
  }
  return `AI 提炼提示词失败 (HTTP ${status})`;
}

/**
 * 调用当前文本模型，把角色卡提炼成一段生图提示词。
 * 比起本地关键词规则，模型能识别「这句是台词/剧情，不是外貌」。
 */
export async function generateImagePrompt(params: {
  provider: ProviderConfig;
  model: string;
  character: Character;
  world?: WorldProject | null;
  /** 生图尺寸（跟随「模型 → 生图模型 → 分辨率尺寸」），决定取景与构图 */
  size?: string;
}): Promise<string> {
  const { provider, model, character, world } = params;
  const framing = resolveImageFraming(params.size);
  const systemPrompt = IMAGE_PROMPT_SYSTEM(framing);

  if (provider.requiresKey && !provider.apiKey.trim()) {
    throw new Error(`尚未填写 ${provider.name} 的 API Key，无法提炼画面描述`);
  }

  const brief = buildImageBrief(character, world);
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
        max_tokens: 2048,
        temperature: 0.4,
        system: systemPrompt,
        messages: [{ role: 'user', content: brief }],
      }),
    });
    if (!resp.ok) throw new Error(extractApiErrorDetail(resp.text, resp.status));
    const parsed = JSON.parse(resp.text);
    const blocks = Array.isArray(parsed?.content) ? parsed.content : [];
    const text = blocks
      .filter((b: { type?: string; text?: string }) => b.type !== 'thinking' && b.text)
      .map((b: { text?: string }) => b.text || '')
      .join('');
    return withFramingClause(sanitizeImagePrompt(text), framing);
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey.trim()}`;

  const resp = await crossPlatformFetchJson({
    url: `${cleanBase}/chat/completions`,
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.4,
      // 思考模型会先花 token 想，给足额度免得 content 为空
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: brief },
      ],
    }),
  });
  if (!resp.ok) throw new Error(extractApiErrorDetail(resp.text, resp.status));

  const parsed = JSON.parse(resp.text);
  const msgObj = parsed?.choices?.[0]?.message;
  return withFramingClause(sanitizeImagePrompt(String(msgObj?.content || '')), framing);
}
