/**
 * 内置画风预设。
 *
 * 只收「一句话说得清、生图模型也听得懂」的几种常见画风，避免把设置页做成
 * 风格词典。选「不指定」时程序一个风格词都不塞，用户在自己的提示词里
 * 怎么写就怎么画 —— 这条是刻意保留的逃生口。
 */

export interface ImageStylePreset {
  id: string;
  /** 胶囊上显示的短名 */
  label: string;
  /** 追加到提示词最前面的风格描述 */
  prompt: string;
}

/** 「不指定」：不加任何风格词 */
export const IMAGE_STYLE_NONE_ID = 'none';

export const IMAGE_STYLE_PRESETS: readonly ImageStylePreset[] = [
  { id: 'painterly', label: '厚涂', prompt: '厚涂插画，笔触可见，电影级布光' },
  { id: 'gongbi', label: '国风工笔', prompt: '国风工笔，设色雅致，线条工整' },
  { id: 'cel', label: '日系赛璐璐', prompt: '日系动画赛璐璐上色，干净线条，清透光影' },
  { id: 'cinematic', label: '电影写实', prompt: '电影级写实摄影，浅景深，自然光质感' },
  { id: 'watercolor', label: '水彩手绘', prompt: '水彩手绘，纸张纹理，柔和晕染' },
  { id: 'lineart', label: '黑白线稿', prompt: '黑白线稿，干净轮廓线，大量留白' },
] as const;

/** 折叠状态下默认露出的前几个，其余收进「更多」 */
export const IMAGE_STYLE_QUICK_COUNT = 2;

export function findStylePreset(id?: string): ImageStylePreset | undefined {
  if (!id) return undefined;
  return IMAGE_STYLE_PRESETS.find((p) => p.id === id);
}

/**
 * 角色卡的风格选择 → 实际写进提示词的风格串。
 * - 未选（undefined）：沿用设置里的默认画风，老角色卡行为不变
 * - 选了「不指定」：返回空串，提示词完全由用户自己决定
 */
export function resolveCharacterStylePrompt(
  styleId: string | undefined,
  fallbackHint: string
): string {
  if (styleId === IMAGE_STYLE_NONE_ID) return '';
  const preset = findStylePreset(styleId);
  if (preset) return preset.prompt;
  return (fallbackHint || '').trim();
}

/** 给界面显示的风格名：预设名 / 不指定 / 跟随默认 */
export function describeStyleChoice(styleId: string | undefined, fallbackHint: string): string {
  if (styleId === IMAGE_STYLE_NONE_ID) return '不指定风格';
  const preset = findStylePreset(styleId);
  if (preset) return preset.label;
  return (fallbackHint || '').trim() ? '默认画风' : '不指定风格';
}
