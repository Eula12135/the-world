import type { ProviderConfig, TtsAutoPlayTarget, VoiceConfig, VoiceProfile } from '../../types';
import { base64ToUint8Array, crossPlatformFetchBinary } from '../llm';
import { extractEndpointHost, isLocalEndpointUrl } from '../imageGenService';
import { createId, detectUnreachableLocalhost } from '../../utils/platform';
import { buildBreezeTtsPayload, listBreezeVoices } from './breeze';
import {
  findTtsPresetByBaseUrl,
  resolveEffectiveVoiceConfig,
  resolveVoiceServiceApiKey,
} from './presets';
import {
  formatTtsHttpError,
  isBreezeCloudBase,
  normalizeBreezeBaseUrl,
  splitSpeechChunks,
  stripMarkdownForSpeech,
} from './textUtils';
import {
  buildTtsSpeechCacheKey,
  buildTtsVoiceAgnosticKey,
  findTtsCacheByAgnosticKey,
  readTtsCache,
  writeTtsCache,
} from './ttsCache';

export function buildTtsSpeechPayload(params: {
  model: string;
  text: string;
  voice: string;
  rate: number;
  gain: number;
  styleInstruction?: string;
}): Record<string, unknown> {
  const { model, text, voice, rate, gain, styleInstruction } = params;
  const trimmedInstruction = (styleInstruction || '').trim();
  const isBreeze = /breeze/i.test(model);
  const isCosyVoice = !isBreeze && /cosyvoice/i.test(model);
  const isOpenAiMiniTts = /gpt-4o-mini-tts/i.test(model);

  const finalInput =
    isCosyVoice && trimmedInstruction
      ? `${trimmedInstruction} <|endofprompt|>${text.slice(0, 3800)}`
      : text.slice(0, 4000);

  const payload: Record<string, unknown> = {
    model,
    input: finalInput,
    response_format: isBreeze ? 'wav' : 'mp3',
    // 语速下限锁到 1.0：不少兼容网关对 speed 做 ge=1 校验，发 0.5 会直接 422。
    // 慢速改由播放端 playbackRate 实现（见 speakText），听感更自然且不改变音高。
    speed: Math.max(1, Math.min(4.0, Number(rate) || 1)),
  };

  if (voice.trim()) {
    payload.voice = voice.trim();
  } else if (!isBreeze) {
    payload.voice = 'alloy';
  }

  if (isBreeze && trimmedInstruction) {
    payload.instructions = trimmedInstruction;
    payload.extra_params = { guidance_scale: 4.0 };
  }

  if (isCosyVoice) {
    payload.gain = Math.max(-10, Math.min(10, Number(gain) || 0));
  }
  if (isOpenAiMiniTts && trimmedInstruction) {
    payload.instructions = trimmedInstruction;
  }

  return payload;
}

export function listNativeVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch {
    return [];
  }
}

let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;
let activeAudioAbort: (() => void) | null = null;
let activeNativeTtsCleanup: (() => void) | null = null;
let speechGenerationId = 0;

/**
 * 自动朗读是否需要朗读某一侧。
 * 旧数据没有 ttsAutoPlayTarget，按「只读角色」处理，与改动前行为一致。
 */
export function shouldAutoPlaySpeech(params: {
  enabled: boolean;
  target?: TtsAutoPlayTarget;
  side: 'assistant' | 'user';
}): boolean {
  if (!params.enabled) return false;
  const target = params.target || 'assistant';
  if (target === 'both') return true;
  return target === params.side;
}

export function stopSpeaking(): void {
  speechGenerationId++;
  if (activeNativeTtsCleanup) {
    activeNativeTtsCleanup();
    activeNativeTtsCleanup = null;
  }
  if (typeof window !== 'undefined') {
    try {
      window.TheWorldAndroid?.stopSpeaking?.();
    } catch {
      // ignore
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }
  if (activeAudio) {
    try {
      activeAudio.onended = null;
      activeAudio.onerror = null;
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio.src = '';
    } catch {
      // ignore
    }
    activeAudio = null;
  }
  if (activeAudioAbort) {
    const abort = activeAudioAbort;
    activeAudioAbort = null;
    abort();
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }
}

export async function speakText(params: {
  text: string;
  config: VoiceConfig;
  providers: ProviderConfig[];
  profile?: VoiceProfile | null;
  voiceOverride?: string;
  /** 语音缓存归属的会话，用于按会话选择性清理 */
  sessionId?: string;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}): Promise<void> {
  const { text, config, providers, profile, voiceOverride, sessionId, onEnd, onError } = params;
  const effective = resolveEffectiveVoiceConfig(config, profile);
  const cleanText = stripMarkdownForSpeech(text);
  if (!cleanText) {
    onEnd?.();
    return;
  }

  stopSpeaking();
  const token = ++speechGenerationId;
  const rate = Math.max(0.5, Math.min(2.0, effective.ttsRate || 1));
  const pitch = Math.max(0.5, Math.min(2.0, effective.ttsPitch || 1));
  const volume = Math.max(0.1, Math.min(1.0, effective.ttsVolume ?? 1));

  if (effective.ttsEngine === 'native') {
    if (typeof window !== 'undefined' && window.TheWorldAndroid?.speakWithId) {
      const utteranceId = createId('tts');
      const cleanup = () => {
        window.removeEventListener('theworld-tts', onTtsEvent);
        if (activeNativeTtsCleanup === cleanup) {
          activeNativeTtsCleanup = null;
        }
      };
      const onTtsEvent = (ev: Event) => {
        const detail = (
          ev as CustomEvent<{ status?: string; utteranceId?: string; message?: string }>
        ).detail;
        if (!detail || detail.utteranceId !== utteranceId) return;
        cleanup();
        if (token !== speechGenerationId) return;
        if (detail.status === 'error') {
          onError?.(detail.message || '系统语音朗读失败');
        } else {
          onEnd?.();
        }
      };
      activeNativeTtsCleanup = cleanup;
      window.addEventListener('theworld-tts', onTtsEvent);
      window.TheWorldAndroid.speakWithId(
        cleanText.slice(0, 3800),
        rate,
        pitch,
        volume,
        utteranceId
      );
      return;
    }

    if (typeof window !== 'undefined' && window.TheWorldAndroid?.speak) {
      window.TheWorldAndroid.speak(cleanText.slice(0, 3800), rate, pitch);
      onEnd?.();
      return;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const chunks = splitSpeechChunks(cleanText, 220);
      const voices = listNativeVoices();
      const targetVoiceName = voiceOverride || effective.ttsNativeVoice;
      const chosenVoice =
        (targetVoiceName && voices.find((v) => v.name === targetVoiceName)) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('zh')) ||
        undefined;

      let idx = 0;
      const speakNext = () => {
        if (token !== speechGenerationId) return;
        if (idx >= chunks.length) {
          onEnd?.();
          return;
        }
        const utter = new SpeechSynthesisUtterance(chunks[idx++]);
        utter.lang = chosenVoice?.lang || 'zh-CN';
        utter.rate = rate;
        utter.pitch = pitch;
        utter.volume = volume;
        if (chosenVoice) utter.voice = chosenVoice;
        utter.onend = () => speakNext();
        utter.onerror = () => {
          if (token === speechGenerationId) {
            onEnd?.();
          }
        };
        window.speechSynthesis.speak(utter);
      };
      speakNext();
      return;
    }

    onError?.('当前运行环境不支持系统原生语音朗读，请切换至自定义 TTS API');
    return;
  }

  const cleanBase = effective.ttsBaseUrl.trim().replace(/\/+$/, '');
  const isBreezeCloud = isBreezeCloudBase(cleanBase);
  const model = effective.ttsModel.trim() || (isBreezeCloud ? 'breeze-tts-2' : '');
  const isBreeze = /breeze/i.test(model) || isBreezeCloud;
  if (!cleanBase || !model) {
    onError?.('请先配置 TTS API 的 Base URL 与模型名称');
    return;
  }
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) {
    onError?.(localhostWarning);
    return;
  }

  const breezeBase = isBreezeCloud ? normalizeBreezeBaseUrl(cleanBase) : cleanBase;
  const targetProviderId =
    effective.ttsProviderId || findTtsPresetByBaseUrl(cleanBase)?.id;
  const sameProviderAsConfig =
    !profile ||
    (targetProviderId && targetProviderId === config.ttsProviderId) ||
    (extractEndpointHost(cleanBase) &&
      extractEndpointHost(cleanBase) === extractEndpointHost(config.ttsBaseUrl));

  const apiKey = resolveVoiceServiceApiKey({
    providerId: targetProviderId,
    baseUrl: breezeBase,
    explicitKey: sameProviderAsConfig ? effective.ttsApiKey : '',
    providerConfigs: config.ttsProviderConfigs,
    providers,
  });
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    onError?.('请先在「模型 → 语音」为对应语音平台配置 TTS API Key');
    return;
  }

  try {
    type SynthBin = {
      ok: boolean;
      status: number;
      contentType: string;
      base64: string;
      errorText: string;
    };

    // Breeze 的 voiceId 与文本无关，先解析一次（可能触发拉取音色列表）
    let breezeVoiceId = '';
    if (isBreezeCloud) {
      breezeVoiceId = (voiceOverride || effective.ttsVoice || '').trim();
      if (!breezeVoiceId) {
        const voices = await listBreezeVoices({
          baseUrl: breezeBase,
          apiKey,
          providers,
          providerConfigs: config.ttsProviderConfigs,
        });
        if (token !== speechGenerationId) return;
        if (voices.length === 0) {
          onError?.('Breeze 账号下暂无可用音色，请先在 Breeze 控制台创建音色或使用「一句话捏音色」');
          return;
        }
        breezeVoiceId = voices[0].voiceId;
      }
    }

    const ttsVoice =
      (voiceOverride || effective.ttsVoice || '').trim() || (isBreeze ? '' : 'alloy');
    const openAiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) openAiHeaders.Authorization = `Bearer ${apiKey}`;

    const synthesizeNetwork = async (chunkText: string): Promise<SynthBin> => {
      if (isBreezeCloud) {
        return crossPlatformFetchBinary({
          url: `${breezeBase}/v1/text-to-speech/${encodeURIComponent(breezeVoiceId)}?output_format=mp3_44100_128`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify(
            buildBreezeTtsPayload({
              text: chunkText,
              model,
              instructions: effective.ttsStyleInstruction,
            })
          ),
        });
      }
      return crossPlatformFetchBinary({
        url: `${cleanBase}/audio/speech`,
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify(
          buildTtsSpeechPayload({
            model,
            text: chunkText,
            voice: ttsVoice,
            rate,
            gain: effective.ttsGain ?? 0,
            styleInstruction: effective.ttsStyleInstruction,
          })
        ),
      });
    };

    // 语速补偿：只有「非 Breeze 云端 且 rate >= 1」时服务端才真的按用户语速合成。
    // 其余情况（rate < 1 会被 ge=1 校验挡下；Breeze 云端根本没有 speed 字段）
    // 改在播放端用 playbackRate 减速/加速——它只拉伸时间轴、保持音高，更适合人声。
    const speedHandledByServer = !isBreezeCloud && rate >= 1;
    const playbackRate = !speedHandledByServer && Math.abs(rate - 1) > 0.001 ? rate : 1;

    /**
     * 带本地缓存的合成：命中直接返回字节，不再请求接口。
     * 键里带齐了音色 / 模型 / 服务端语速 / 增益 / 语气指令 / 文本，
     * 所以换音色、换模型、改语气、编辑消息都会自然变成未命中，重新合成。
     */
    const synthesize = async (chunkText: string): Promise<SynthBin> => {
      const sharedParts = {
        baseUrl: isBreezeCloud ? breezeBase : cleanBase,
        model,
        synthRate: speedHandledByServer ? rate : 1,
        gain: effective.ttsGain ?? 0,
        styleInstruction: effective.ttsStyleInstruction || '',
        text: chunkText,
      };
      const cacheKey = buildTtsSpeechCacheKey({
        ...sharedParts,
        voice: isBreezeCloud ? breezeVoiceId : ttsVoice,
      });
      const agnosticKey = buildTtsVoiceAgnosticKey(sharedParts);

      try {
        const hit = await readTtsCache(cacheKey);
        if (hit) {
          return {
            ok: true,
            status: 200,
            contentType: hit.contentType,
            base64: hit.base64,
            errorText: '',
          };
        }
        // 用户选择「换音色后沿用旧语音」时，用无音色键兜底，省一次额度
        if (config.ttsCacheKeepOldVoice) {
          const fallback = await findTtsCacheByAgnosticKey(agnosticKey);
          if (fallback) {
            return {
              ok: true,
              status: 200,
              contentType: fallback.contentType,
              base64: fallback.base64,
              errorText: '',
            };
          }
        }
      } catch {
        // 缓存读失败就当未命中，不能因为缓存问题导致读不出来
      }

      const bin = await synthesizeNetwork(chunkText);
      if (bin.ok && bin.base64) {
        void writeTtsCache({
          key: cacheKey,
          agnosticKey,
          base64: bin.base64,
          contentType: bin.contentType,
          textPreview: chunkText.slice(0, 40),
          voiceLabel: isBreezeCloud ? breezeVoiceId : ttsVoice,
          sessionId,
        }).catch(() => undefined);
      }
      return bin;
    };

    const playOne = (bin: SynthBin) =>
      new Promise<void>((resolve, reject) => {
        if (token !== speechGenerationId) {
          resolve();
          return;
        }
        const bytes = base64ToUint8Array(bin.base64);
        const mime = bin.contentType?.startsWith('audio/')
          ? bin.contentType
          : !isBreezeCloud && isBreeze
            ? 'audio/wav'
            : 'audio/mpeg';
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        let settled = false;
        const finish = (pauseAudio = false) => {
          if (settled) return;
          settled = true;
          if (pauseAudio) {
            try {
              audio.onended = null;
              audio.onerror = null;
              audio.pause();
              audio.currentTime = 0;
              audio.src = '';
            } catch {
              // ignore
            }
          }
          URL.revokeObjectURL(url);
          if (activeAudio === audio) {
            activeAudio = null;
            activeAudioUrl = null;
            activeAudioAbort = null;
          }
        };
        audio.volume = volume;
        if (playbackRate !== 1) audio.playbackRate = playbackRate;
        activeAudio = audio;
        activeAudioUrl = url;
        activeAudioAbort = () => {
          finish(true);
          resolve();
        };
        audio.onended = () => {
          finish(false);
          resolve();
        };
        audio.onerror = () => {
          finish(true);
          reject(new Error('音频播放失败'));
        };
        audio.play().catch((err) => {
          if (token !== speechGenerationId) {
            finish(true);
            resolve();
            return;
          }
          finish(true);
          reject(err instanceof Error ? err : new Error('音频播放失败'));
        });
      });

    // 长文本按句切开：播第一句的同时合成下一句，首字延迟从「整段合成」降到「一句合成」
    const chunks = cleanText.length > 260 ? splitSpeechChunks(cleanText, 220) : [cleanText];
    let prefetched: Promise<SynthBin> | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const current = prefetched ?? synthesize(chunks[i]);
      prefetched = i + 1 < chunks.length ? synthesize(chunks[i + 1]) : null;
      // 中途被停止时预取请求仍会返回，提前挂 catch 避免 unhandled rejection
      prefetched?.catch(() => undefined);

      const bin = await current;
      if (token !== speechGenerationId) return;
      if (!bin.ok || !bin.base64) {
        onError?.(formatTtsHttpError(bin.status, bin.errorText));
        return;
      }
      await playOne(bin);
      if (token !== speechGenerationId) return;
    }

    stopSpeaking();
    onEnd?.();
  } catch (err) {
    if (token === speechGenerationId) {
      onError?.(err instanceof Error ? err.message : 'TTS 合成失败');
    }
  }
}
