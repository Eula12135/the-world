import { describe, expect, it } from 'vitest';
import { shouldAutoPlaySpeech } from '../services/voice/tts';

describe('shouldAutoPlaySpeech', () => {
  it('never fires when auto play is off, regardless of scope', () => {
    const targets = ['assistant', 'user', 'both'] as const;
    for (const target of targets) {
      expect(shouldAutoPlaySpeech({ enabled: false, target, side: 'assistant' })).toBe(false);
      expect(shouldAutoPlaySpeech({ enabled: false, target, side: 'user' })).toBe(false);
    }
  });

  it('defaults to the AI side when the target is missing (old records)', () => {
    expect(shouldAutoPlaySpeech({ enabled: true, side: 'assistant' })).toBe(true);
    expect(shouldAutoPlaySpeech({ enabled: true, side: 'user' })).toBe(false);
  });

  it('reads only the assistant side', () => {
    expect(shouldAutoPlaySpeech({ enabled: true, target: 'assistant', side: 'assistant' })).toBe(true);
    expect(shouldAutoPlaySpeech({ enabled: true, target: 'assistant', side: 'user' })).toBe(false);
  });

  it('reads only my lines', () => {
    expect(shouldAutoPlaySpeech({ enabled: true, target: 'user', side: 'user' })).toBe(true);
    expect(shouldAutoPlaySpeech({ enabled: true, target: 'user', side: 'assistant' })).toBe(false);
  });

  it('reads both sides', () => {
    expect(shouldAutoPlaySpeech({ enabled: true, target: 'both', side: 'user' })).toBe(true);
    expect(shouldAutoPlaySpeech({ enabled: true, target: 'both', side: 'assistant' })).toBe(true);
  });
});
