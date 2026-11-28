import { describe, expect, it } from 'vitest';
import {
  MIN_SUMMARY_CHARS,
  assertUsableSummary,
  buildMemoryRequestParams,
  isReasoningModel,
} from '../services/memoryService';

describe('记忆压缩的模型适配', () => {
  it('识别常见推理模型', () => {
    expect(isReasoningModel('o1')).toBe(true);
    expect(isReasoningModel('o3-mini')).toBe(true);
    expect(isReasoningModel('deepseek-reasoner')).toBe(true);
    expect(isReasoningModel('deepseek-r1')).toBe(true);
    expect(isReasoningModel('qwen3-thinking')).toBe(true);
  });

  it('普通模型不误判', () => {
    expect(isReasoningModel('gpt-4o')).toBe(false);
    expect(isReasoningModel('deepseek-chat')).toBe(false);
    expect(isReasoningModel('gemini-2.0-flash')).toBe(false);
    // 名字里带 r1 但不是一个词时不应命中
    expect(isReasoningModel('sunrise-model')).toBe(false);
  });

  it('推理模型不传 temperature，并把输出预算放宽', () => {
    const reasoning = buildMemoryRequestParams('deepseek-reasoner');
    expect(reasoning.temperature).toBeUndefined();
    expect(reasoning.max_tokens).toBe(4000);

    const normal = buildMemoryRequestParams('deepseek-chat');
    expect(normal.temperature).toBe(0.25);
    expect(normal.max_tokens).toBe(800);
  });

  it('兜底重试时即使普通模型也省略 temperature', () => {
    expect(buildMemoryRequestParams('deepseek-chat', true).temperature).toBeUndefined();
  });
});

describe('摘要内容校验', () => {
  it('空内容判失败，避免覆盖旧前情', () => {
    expect(() => assertUsableSummary('')).toThrow(/已保留原有前情/);
    expect(() => assertUsableSummary('   \n ')).toThrow(/已保留原有前情/);
  });

  it('过短内容同样判失败', () => {
    expect(() => assertUsableSummary('太短')).toThrow(/已保留原有前情/);
  });

  it('正常长度原样返回并去掉首尾空白', () => {
    const text = '  主角在雨夜抵达旧车站，与守夜人交换了关于失踪船员的线索。  ';
    expect(assertUsableSummary(text)).toBe(text.trim());
    expect(assertUsableSummary(text).length).toBeGreaterThanOrEqual(MIN_SUMMARY_CHARS);
  });
});
