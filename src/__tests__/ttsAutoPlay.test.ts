import { describe, expect, it } from 'vitest';
import { isVoiceSetupMissing, shouldAutoPlaySpeech } from '../services/voice/tts';

describe('shouldAutoPlaySpeech', () => {
  it('never fires when auto play is off, regardless of scope', () => {
    const targets = ['assistant', 'user', 'both'] as const;
    for (const target of targets) {
      expect(shouldAutoPlaySpeech({ enabled: false, autoPlay: true, target, side: 'assistant' })).toBe(false);
      expect(shouldAutoPlaySpeech({ enabled: false, autoPlay: true, target, side: 'user' })).toBe(false);
    }
  });

  it('does not fire when the auto play switch is off, even with voice enabled', () => {
    const targets = ['assistant', 'user', 'both'] as const;
    for (const target of targets) {
      expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: false, target, side: 'assistant' })).toBe(false);
      expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: false, target, side: 'user' })).toBe(false);
    }
    expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: false, side: 'assistant' })).toBe(false);
  });

  it('defaults to the AI side when the target is missing (old records)', () => {
    expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: true, side: 'assistant' })).toBe(true);
    expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: true, side: 'user' })).toBe(false);
  });

  it('reads only the assistant side', () => {
    expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: true, target: 'assistant', side: 'assistant' })).toBe(true);
    expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: true, target: 'assistant', side: 'user' })).toBe(false);
  });

  it('reads only my lines', () => {
    expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: true, target: 'user', side: 'user' })).toBe(true);
    expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: true, target: 'user', side: 'assistant' })).toBe(false);
  });

  it('reads both sides', () => {
    expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: true, target: 'both', side: 'user' })).toBe(true);
    expect(shouldAutoPlaySpeech({ enabled: true, autoPlay: true, target: 'both', side: 'assistant' })).toBe(true);
  });
});

describe('isVoiceSetupMissing', () => {
  it('never blocks the native engine, which always has a system voice', () => {
    expect(isVoiceSetupMissing({ engine: 'native' })).toBe(false);
    expect(isVoiceSetupMissing({ engine: 'native', profileId: undefined })).toBe(false);
  });

  it('flags API engines that have neither a profile nor an external voice id', () => {
    expect(isVoiceSetupMissing({ engine: 'openai_api' })).toBe(true);
    expect(isVoiceSetupMissing({ engine: 'openai_api', voiceOverride: '   ' })).toBe(true);
  });

  it('is satisfied by either a bound profile or an explicit voice id', () => {
    expect(isVoiceSetupMissing({ engine: 'openai_api', profileId: 'vp_x' })).toBe(false);
    expect(isVoiceSetupMissing({ engine: 'openai_api', voiceOverride: 'FunAudioLLM:anna' })).toBe(false);
  });
});
