import { describe, expect, it } from 'vitest';
import { resolveImageSize } from '../services/imageGenService';

describe('resolveImageSize', () => {
  it('passes through sizes the model actually accepts', () => {
    expect(resolveImageSize('gpt-image-1', '1024x1024')).toBe('1024x1024');
    expect(resolveImageSize('gpt-image-2', '1536x1024')).toBe('1536x1024');
    expect(resolveImageSize('dall-e-3', '1792x1024')).toBe('1792x1024');
  });

  it('maps unsupported sizes to the closest allowed aspect for gpt-image', () => {
    // 1792x1024 是 dall-e-3 的合法尺寸，gpt-image 系列不接受 → 换成 1536x1024
    expect(resolveImageSize('gpt-image-1', '1792x1024')).toBe('1536x1024');
    expect(resolveImageSize('gpt-image-1', '1024x1792')).toBe('1024x1536');
    expect(resolveImageSize('gpt-image-1', '2048x2048')).toBe('1024x1024');
  });

  it('omits the size instead of sending something invalid', () => {
    expect(resolveImageSize('gpt-image-1', '')).toBeUndefined();
    expect(resolveImageSize('gpt-image-1', 'huge')).toBeUndefined();
  });

  it('leaves unknown models untouched', () => {
    expect(resolveImageSize('Kwai-Kolors/Kolors', '1024x1792')).toBe('1024x1792');
    expect(resolveImageSize('flux-schnell', '')).toBeUndefined();
  });
});
