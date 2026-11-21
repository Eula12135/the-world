import type { ProviderConfig, VoiceConfig } from '../types';
import {
  base64ToUint8Array,
  crossPlatformFetchBinary,
  crossPlatformUploadMultipart,
  uint8ArrayToBase64,
} from './llm';
import { isLocalEndpointUrl, resolveReusableApiKey } from './imageGenService';

export interface TtsPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  model: string;
  defaultVoice: string;
  consoleUrl: string;
}

export interface SttPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  model: string;
  consoleUrl: string;
}

export const TTS_PRESETS: TtsPreset[] = [
  {
    id: 'siliconflow_tts',
    name: '硅基流动 CosyVoice2 / FishSpeech',
    description: '高性价比中文拟真语音合成，可留空 Key 自动复用同域名配置',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    defaultVoice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'openai_tts',
    name: 'OpenAI TTS (gpt-4o-mini-tts)',
    description: 'OpenAI 官方语音合成接口',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-tts',
    defaultVoice: 'alloy',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'local_tts',
    name: '本地自建开源 TTS（Kokoro / GPT-SoVITS / ChatTTS）',
    description: '完全离线免费运行的高拟真本地语音 API（OpenAI /v1/audio/speech 兼容）',
    baseUrl: 'http://127.0.0.1:8880/v1',
    model: 'kokoro',
    defaultVoice: 'zf_xiaoxiao',
    consoleUrl: '',
  },
];

export const STT_PRESETS: SttPreset[] = [
  {
    id: 'siliconflow_stt',
    name: '硅基流动 SenseVoiceSmall（推荐 · 含免费额度）',
    description: '阿里通义开源中文/中英混合高速语音识别，有免费体验额度',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'groq_stt',
    name: 'Groq Whisper Large v3 Turbo（免费额度高）',
    description: 'Groq 极速 Whisper 接口，提供慷慨免费层',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    consoleUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openai_stt',
    name: 'OpenAI Whisper / 本地 whisper.cpp',
    description: '标准 /v1/audio/transcriptions 接口',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
];

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
let speechGenerationId = 0;

export function stopSpeaking(): void {
  speechGenerationId++;
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
      activeAudio.pause();
      activeAudio.src = '';
    } catch {
      // ignore
    }
    activeAudio = null;
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
  voiceOverride?: string;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}): Promise<void> {
  const { text, config, providers, voiceOverride, onEnd, onError } = params;
  const cleanText = stripMarkdownForSpeech(text);
  if (!cleanText) {
    onEnd?.();
    return;
  }

  stopSpeaking();
  const token = ++speechGenerationId;
  const rate = Math.max(0.5, Math.min(2.0, config.ttsRate || 1));

  if (config.ttsEngine === 'native') {
    if (typeof window !== 'undefined' && window.TheWorldAndroid?.speak) {
      window.TheWorldAndroid.speak(cleanText.slice(0, 3800), rate);
      // Native TextToSpeech handles playback asynchronously on device
      onEnd?.();
      return;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const chunks = splitSpeechChunks(cleanText, 220);
      const voices = listNativeVoices();
      const targetVoiceName = voiceOverride || config.ttsNativeVoice;
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

  // OpenAI-compatible TTS API
  const cleanBase = config.ttsBaseUrl.trim().replace(/\/+$/, '');
  const model = config.ttsModel.trim();
  const voice = (voiceOverride || config.ttsVoice || '').trim() || 'alloy';
  if (!cleanBase || !model) {
    onError?.('请先配置 TTS API 的 Base URL 与模型名称');
    return;
  }

  const apiKey = resolveReusableApiKey(cleanBase, config.ttsApiKey, providers);
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    onError?.('请先在「模型 → 语音」配置 TTS API Key');
    return;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const bin = await crossPlatformFetchBinary({
      url: `${cleanBase}/audio/speech`,
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        input: cleanText.slice(0, 4000),
        voice,
        response_format: 'mp3',
        speed: rate,
      }),
    });

    if (token !== speechGenerationId) return;
    if (!bin.ok || !bin.base64) {
      onError?.(`TTS 接口失败 (HTTP ${bin.status})${bin.errorText ? `: ${bin.errorText.slice(0, 100)}` : ''}`);
      return;
    }

    const bytes = base64ToUint8Array(bin.base64);
    const mime = bin.contentType?.startsWith('audio/') ? bin.contentType : 'audio/mpeg';
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
    activeAudioUrl = URL.createObjectURL(blob);
    activeAudio = new Audio(activeAudioUrl);
    activeAudio.onended = () => {
      if (token === speechGenerationId) {
        stopSpeaking();
        onEnd?.();
      }
    };
    activeAudio.onerror = () => {
      if (token === speechGenerationId) {
        stopSpeaking();
        onError?.('音频播放失败');
      }
    };
    await activeAudio.play();
  } catch (err) {
    if (token === speechGenerationId) {
      onError?.(err instanceof Error ? err.message : 'TTS 合成失败');
    }
  }
}

export interface VoiceCaptureHandle {
  stop: () => void;
}

export function startVoiceCapture(params: {
  config: VoiceConfig;
  providers: ProviderConfig[];
  onResult: (text: string) => void;
  onStatus?: (status: 'listening' | 'transcribing') => void;
  onError: (msg: string) => void;
  onDone: () => void;
}): VoiceCaptureHandle {
  const { config, providers, onResult, onStatus, onError, onDone } = params;

  if (config.sttEngine === 'native') {
    if (typeof window !== 'undefined' && window.TheWorldAndroid?.startNativeStt) {
      let settled = false;
      const cleanup = () => {
        window.removeEventListener('theworld-stt', handler);
      };
      const handler = (ev: Event) => {
        if (settled) return;
        settled = true;
        cleanup();
        const detail = (ev as CustomEvent<{ text?: string; error?: string; canceled?: boolean }>)
          .detail;
        if (detail?.error) {
          onError(detail.error);
        } else if (detail?.text) {
          onResult(detail.text);
        }
        onDone();
      };
      window.addEventListener('theworld-stt', handler);
      onStatus?.('listening');
      window.TheWorldAndroid.startNativeStt(
        config.sttLanguage === 'en' ? 'en-US' : 'zh-CN'
      );
      return {
        stop: () => {
          if (!settled) {
            settled = true;
            cleanup();
            onDone();
          }
        },
      };
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: ((ev: { error?: string }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: ((ev: { error?: string }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
    };

    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      onError(
        '当前桌面环境暂不支持系统离线识别，可在「模型 → 语音」将输入切换为硅基流动 SenseVoiceSmall（含免费额度）'
      );
      onDone();
      return { stop: () => {} };
    }

    const recognition = new SpeechRec();
    recognition.lang = config.sttLanguage === 'en' ? 'en-US' : 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    let stopped = false;

    recognition.onresult = (ev) => {
      let full = '';
      for (let i = 0; i < ev.results.length; i++) {
        full += ev.results[i][0]?.transcript || '';
      }
      if (full.trim()) onResult(full.trim());
    };
    recognition.onerror = (ev) => {
      if (!stopped) {
        onError(`语音识别失败 (${ev.error || 'unknown'})`);
      }
    };
    recognition.onend = () => {
      onDone();
    };
    onStatus?.('listening');
    recognition.start();
    return {
      stop: () => {
        stopped = true;
        try {
          recognition.stop();
        } catch {
          onDone();
        }
      },
    };
  }

  // OpenAI-compatible /audio/transcriptions via MediaRecorder
  const cleanBase = config.sttBaseUrl.trim().replace(/\/+$/, '');
  const model = config.sttModel.trim();
  const apiKey = resolveReusableApiKey(cleanBase, config.sttApiKey, providers);

  if (!cleanBase || !model) {
    onError('请先在「模型 → 语音」填写 STT 接口地址和模型');
    onDone();
    return { stop: () => {} };
  }
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    onError('请先在「模型 → 语音」填写 STT API Key（同域名厂商可自动复用）');
    onDone();
    return { stop: () => {} };
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    onError('当前环境不支持麦克风录音');
    onDone();
    return { stop: () => {} };
  }

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let canceled = false;

  const stopTracks = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((mediaStream) => {
      if (canceled) {
        mediaStream.getTracks().forEach((t) => t.stop());
        onDone();
        return;
      }
      stream = mediaStream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      recorder = mimeType
        ? new MediaRecorder(mediaStream, { mimeType })
        : new MediaRecorder(mediaStream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = async () => {
        stopTracks();
        if (chunks.length === 0) {
          onDone();
          return;
        }
        onStatus?.('transcribing');
        try {
          const finalMime = recorder?.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: finalMime });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const ext = finalMime.includes('mp4') ? 'm4a' : 'webm';
          const headers: Record<string, string> = {};
          if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

          const resp = await crossPlatformUploadMultipart({
            url: `${cleanBase}/audio/transcriptions`,
            headers,
            fields: {
              model,
              ...(config.sttLanguage ? { language: config.sttLanguage } : {}),
            },
            fileField: 'file',
            fileName: `voice.${ext}`,
            fileMime: finalMime,
            fileBase64: uint8ArrayToBase64(bytes),
          });
          if (!resp.ok) {
            onError(`语音转文字失败 (HTTP ${resp.status})`);
          } else {
            const parsed = JSON.parse(resp.text);
            const text = String(parsed?.text || '').trim();
            if (text) onResult(text);
            else onError('未识别出语音内容');
          }
        } catch (err) {
          onError(err instanceof Error ? err.message : '语音上传转写失败');
        } finally {
          onDone();
        }
      };

      onStatus?.('listening');
      recorder.start();
    })
    .catch((err) => {
      onError(err instanceof Error ? `无法访问麦克风: ${err.message}` : '无法访问麦克风');
      onDone();
    });

  return {
    stop: () => {
      canceled = true;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        stopTracks();
        onDone();
      }
    },
  };
}
