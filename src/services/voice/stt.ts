import type { ProviderConfig, VoiceConfig } from '../../types';
import { crossPlatformUploadMultipart, safeJsonParse, uint8ArrayToBase64 } from '../llm';
import { isLocalEndpointUrl, resolveMediaApiKey } from '../imageGenService';
import { detectUnreachableLocalhost } from '../../utils/platform';
import { findSttPresetByBaseUrl } from './presets';

export interface VoiceCaptureHandle {
  stop: () => void;
  cancel: () => void;
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
      const finishEarly = () => {
        if (!settled) {
          settled = true;
          cleanup();
          onDone();
        }
      };
      return { stop: finishEarly, cancel: finishEarly };
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
        abort?: () => void;
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
        abort?: () => void;
      };
    };

    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      onError(
        '当前桌面环境暂不支持系统离线识别，可在「模型 → 语音 → 语音输入」切换为硅基流动 SenseVoiceSmall（含免费额度）'
      );
      onDone();
      return { stop: () => {}, cancel: () => {} };
    }

    const recognition = new SpeechRec();
    recognition.lang = config.sttLanguage === 'en' ? 'en-US' : 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    let stopped = false;

    recognition.onresult = (ev) => {
      if (stopped) return;
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
    try {
      recognition.start();
    } catch (err) {
      onError(err instanceof Error ? `无法启动语音识别: ${err.message}` : '无法启动语音识别');
      onDone();
      return { stop: () => {}, cancel: () => {} };
    }
    return {
      stop: () => {
        stopped = true;
        try {
          recognition.stop();
        } catch {
          onDone();
        }
      },
      cancel: () => {
        stopped = true;
        try {
          if (recognition.abort) recognition.abort();
          else recognition.stop();
        } catch {
          onDone();
        }
      },
    };
  }

  const cleanBase = config.sttBaseUrl.trim().replace(/\/+$/, '');
  const model = config.sttModel.trim();
  const localhostWarning = detectUnreachableLocalhost(cleanBase);
  if (localhostWarning) {
    onError(localhostWarning);
    onDone();
    return { stop: () => {}, cancel: () => {} };
  }

  const sttPid = config.sttProviderId || findSttPresetByBaseUrl(cleanBase)?.id;
  const apiKey = resolveMediaApiKey({
    providerId: sttPid,
    baseUrl: cleanBase,
    explicitKey: config.sttApiKey,
    providerConfigs: config.sttProviderConfigs,
    providers,
  });

  if (!cleanBase || !model) {
    onError('请先在「模型 → 语音 → 语音输入」填写 STT 接口地址和模型');
    onDone();
    return { stop: () => {}, cancel: () => {} };
  }
  if (!apiKey && !isLocalEndpointUrl(cleanBase)) {
    onError('请先在「模型 → 语音 → 语音输入」填写 STT API Key（同域名厂商可自动复用）');
    onDone();
    return { stop: () => {}, cancel: () => {} };
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    onError('当前环境不支持麦克风录音');
    onDone();
    return { stop: () => {}, cancel: () => {} };
  }

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let canceled = false;
  let discardOnStop = false;

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
        if (discardOnStop || chunks.length === 0) {
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
            const parsed = safeJsonParse<{ text?: string }>(
              resp.text,
              '语音转写接口返回格式异常'
            );
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
    cancel: () => {
      canceled = true;
      discardOnStop = true;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        stopTracks();
        onDone();
      }
    },
  };
}
