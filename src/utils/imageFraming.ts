/**
 * 生图取景（构图）定义：尺寸决定画什么，提示词必须跟着尺寸走。
 *
 * 文生图模型只看提示词、不看我们传的 size —— 所以「选了头像尺寸却画出全身」
 * 不是模型不听话，而是提示词里当年写死了「角色立绘 / 半身」。这里把每一档
 * 尺寸对应的取景、正向构图和负向约束放一处，本地拼装、AI 提炼、设置界面
 * 三处都从这里取，避免各写一套说法。
 */

import type { ImageFramingId } from '../types';

export type { ImageFramingId };

export interface ImageFraming {
  id: ImageFramingId;
  /** 与「模型 → 生图模型 → 分辨率尺寸」的取值一一对应 */
  size: string;
  /** 给用户看的取景名 */
  label: string;
  /** 胶囊上的短名 */
  short: string;
  /** 接在题材后面充当画面主体，如「奇幻题材角色头像」 */
  subject: string;
  /** 正向构图指令 */
  composition: string;
  /** 负向约束：明确写出别画什么 */
  avoid: string;
}

export const IMAGE_FRAMINGS: readonly ImageFraming[] = [
  {
    id: 'avatar',
    size: '1024x1024',
    label: '头像特写',
    short: '头像',
    subject: '角色头像',
    composition: '头像特写构图，只画头部与肩颈，脸部占据画面主体，正面平视镜头',
    avoid: '不要画出腰部以下，不要全身像，不要多人同框',
  },
  {
    id: 'halfBody',
    size: '768x1024',
    label: '半身立绘',
    short: '半身',
    subject: '角色立绘',
    composition: '半身立绘构图，取景到膝盖以上，展示完整的上装与身形',
    avoid: '不要只切到脸部特写，不要远景全身像',
  },
  {
    id: 'scene',
    size: '1024x768',
    label: '横版场景',
    short: '场景',
    subject: '角色场景插画',
    composition: '横版场景构图，角色与所处环境同框，保留背景空间与光影层次',
    avoid: '不要纯色背景，不要只有头部特写',
  },
] as const;

const DEFAULT_FRAMING = IMAGE_FRAMINGS[0];

export function getFramingById(id?: ImageFramingId): ImageFraming {
  if (!id) return DEFAULT_FRAMING;
  return byId(id);
}

function byId(id: ImageFramingId): ImageFraming {
  return IMAGE_FRAMINGS.find((f) => f.id === id) ?? DEFAULT_FRAMING;
}

/**
 * 按尺寸反查取景。
 * 精确命中三档预设最好；用户配置了别的尺寸时退回按宽高比判断，
 * 这样 1024x1536、1792x1024 这类自定义值也不会莫名其妙画成头像。
 */
export function resolveImageFraming(size?: string | null): ImageFraming {
  const raw = (size || '').trim().toLowerCase();
  const exact = IMAGE_FRAMINGS.find((f) => f.size.toLowerCase() === raw);
  if (exact) return exact;

  const dims = /^(\d+)\s*[x×*]\s*(\d+)$/.exec(raw);
  if (dims) {
    const width = Number(dims[1]);
    const height = Number(dims[2]);
    if (width > 0 && height > 0) {
      const ratio = width / height;
      if (ratio < 0.9) return byId('halfBody');
      if (ratio > 1.1) return byId('scene');
    }
  }

  return DEFAULT_FRAMING;
}

/** 拼进提示词的取景约束：先正向、后负向，放在提示词末尾权重最高 */
export function buildFramingClause(size?: string | null): string {
  const framing = resolveImageFraming(size);
  return `${framing.composition}，${framing.avoid}`;
}
