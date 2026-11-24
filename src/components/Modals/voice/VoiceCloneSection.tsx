import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  RefreshCw,
  ShieldAlert,
  Square,
  Upload,
} from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { VoiceConfig, VoiceProfile } from '../../../types';
import {
  audioBlobToDataUrl,
  listRemoteClonedVoices,
  type RemoteClonedVoice,
  uploadClonedVoice,
} from '../../../services/voiceService';
import { MAX_CLONE_AUDIO_BYTES } from './constants';

interface VoiceCloneSectionProps {
  draftVoice: VoiceConfig;
  setDraftVoice: React.Dispatch<React.SetStateAction<VoiceConfig>>;
  activeTtsProviderId: string;
  remoteCloned: RemoteClonedVoice[];
  setRemoteCloned: React.Dispatch<React.SetStateAction<RemoteClonedVoice[]>>;
  updateTtsField: (patch: Partial<VoiceConfig>) => void;
  setNewProfileName: (name: string) => void;
  buildVoiceProfileFromDraft: (opts?: {
    overrideName?: string;
    overrideVoiceId?: string;
    overrideModel?: string;
    isCloned?: boolean;
  }) => VoiceProfile;
}

export const VoiceCloneSection: React.FC<VoiceCloneSectionProps> = ({
  draftVoice,
  setDraftVoice,
  activeTtsProviderId,
  remoteCloned,
  setRemoteCloned,
  updateTtsField,
  setNewProfileName,
  buildVoiceProfileFromDraft,
}) => {
  const providers = useAppStore((s) => s.providers);
  const pendingVoiceBindTarget = useAppStore((s) => s.pendingVoiceBindTarget);
  const completePendingVoiceBind = useAppStore((s) => s.completePendingVoiceBind);
  const upsertVoiceProfile = useAppStore((s) => s.upsertVoiceProfile);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setVoiceStudioSubTab = useAppStore((s) => s.setVoiceStudioSubTab);
  const showToast = useAppStore((s) => s.showToast);

  const [cloneSectionOpen, setCloneSectionOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneText, setCloneText] = useState('');
  const [cloneAudioDataUrl, setCloneAudioDataUrl] = useState('');
  const [cloneAudioPreviewUrl, setCloneAudioPreviewUrl] = useState('');
  const [cloneAudioLabel, setCloneAudioLabel] = useState('');
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [syncingRemote, setSyncingRemote] = useState(false);

  const [recordingSample, setRecordingSample] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const sampleRecRef = useRef<MediaRecorder | null>(null);
  const sampleStreamRef = useRef<MediaStream | null>(null);
  const sampleTimerRef = useRef<number | null>(null);
  const cloneFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (sampleTimerRef.current !== null) {
        window.clearInterval(sampleTimerRef.current);
        sampleTimerRef.current = null;
      }
      if (sampleRecRef.current && sampleRecRef.current.state !== 'inactive') {
        try {
          sampleRecRef.current.stop();
        } catch {
          // ignore cleanup failure
        }
      }
      sampleStreamRef.current?.getTracks().forEach((t) => t.stop());
      sampleStreamRef.current = null;
    };
  }, []);

  const handleSelectCloneAudio = async (file: File) => {
    if (file.size > MAX_CLONE_AUDIO_BYTES) {
      showToast('参考音频不能超过 10MB', 'error');
      return;
    }
    try {
      const dataUrl = await audioBlobToDataUrl(file);
      setCloneAudioDataUrl(dataUrl);
      setCloneAudioPreviewUrl(dataUrl);
      setCloneAudioLabel(file.name);
      showToast('参考音频已载入', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '读取音频失败', 'error');
    }
  };

  const stopSampleRecording = () => {
    if (sampleTimerRef.current !== null) {
      window.clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
    if (sampleRecRef.current && sampleRecRef.current.state !== 'inactive') {
      sampleRecRef.current.stop();
    }
    setRecordingSample(false);
  };

  const startSampleRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast('当前环境不支持直接录制音频样本，请点击「上传音频文件」', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sampleStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        sampleStreamRef.current = null;
        if (sampleTimerRef.current !== null) {
          window.clearInterval(sampleTimerRef.current);
          sampleTimerRef.current = null;
        }
        setRecordingSample(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          const dataUrl = await audioBlobToDataUrl(blob);
          setCloneAudioDataUrl(dataUrl);
          setCloneAudioPreviewUrl(dataUrl);
          setCloneAudioLabel(`现场录音 (${blob.type.split(';')[0] || 'audio'})`);
          showToast('录音样本已截取完成', 'success');
        }
      };

      sampleRecRef.current = recorder;
      recorder.start();
      setRecordingSample(true);
      setRecordSeconds(0);
      if (sampleTimerRef.current !== null) {
        window.clearInterval(sampleTimerRef.current);
      }
      sampleTimerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => {
          const next = prev + 1;
          if (next >= 25) {
            if (sampleTimerRef.current !== null) {
              window.clearInterval(sampleTimerRef.current);
              sampleTimerRef.current = null;
            }
            if (sampleRecRef.current && sampleRecRef.current.state !== 'inactive') {
              sampleRecRef.current.stop();
            }
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '无法开启麦克风', 'error');
    }
  };

  const handleUploadCloneAndCreateProfile = async () => {
    if (!cloneConsent) {
      showToast('请先勾选合规确认（仅使用已获授权的声音样本）', 'error');
      return;
    }
    if (!cloneName.trim() || !cloneText.trim() || !cloneAudioDataUrl) {
      showToast('请填完整声音名称、参考音频台词并上传参考音频', 'error');
      return;
    }
    setCloning(true);
    try {
      const targetModel = draftVoice.ttsModel.trim() || 'FunAudioLLM/CosyVoice2-0.5B';
      const { uri } = await uploadClonedVoice({
        baseUrl: draftVoice.ttsBaseUrl,
        apiKey: draftVoice.ttsApiKey,
        providers,
        providerConfigs: draftVoice.ttsProviderConfigs,
        model: targetModel,
        customName: cloneName.trim(),
        text: cloneText.trim(),
        audioDataUrl: cloneAudioDataUrl,
      });

      const profile = buildVoiceProfileFromDraft({
        overrideName: cloneName.trim(),
        overrideVoiceId: uri,
        overrideModel: targetModel,
        isCloned: true,
      });
      await upsertVoiceProfile(profile);

      const nextVoice: VoiceConfig = {
        ...draftVoice,
        ttsVoice: uri,
        ttsModel: targetModel,
        ttsProviderConfigs: {
          ...(draftVoice.ttsProviderConfigs || {}),
          [activeTtsProviderId]: {
            ...(draftVoice.ttsProviderConfigs?.[activeTtsProviderId] || {}),
            baseUrl: draftVoice.ttsBaseUrl,
            apiKey: draftVoice.ttsApiKey,
            model: targetModel,
            defaultVoice: uri,
          },
        },
      };
      setDraftVoice(nextVoice);
      await updateSettings({ voice: nextVoice });

      setCloneName('');
      setCloneText('');
      setCloneAudioDataUrl('');
      setCloneAudioPreviewUrl('');
      setCloneAudioLabel('');

      if (pendingVoiceBindTarget) {
        await completePendingVoiceBind(profile.id);
      } else {
        showToast('声音克隆完成并已存入声音库', 'success');
        setVoiceStudioSubTab('library');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '声音克隆失败', 'error');
    } finally {
      setCloning(false);
    }
  };

  const handleSyncRemoteCloned = async () => {
    setSyncingRemote(true);
    try {
      const rows = await listRemoteClonedVoices({
        baseUrl: draftVoice.ttsBaseUrl,
        apiKey: draftVoice.ttsApiKey,
        providers,
        providerConfigs: draftVoice.ttsProviderConfigs,
      });
      setRemoteCloned(rows);
      showToast(
        rows.length > 0 ? `已拉取 ${rows.length} 个云端克隆音色` : '云端账号暂无克隆音色',
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : '同步云端音色失败', 'error');
    } finally {
      setSyncingRemote(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-canvas/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setCloneSectionOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-[13px] font-medium text-ink hover:bg-hover cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          {cloneSectionOpen ? (
            <ChevronDown className="w-4 h-4 text-accent" />
          ) : (
            <ChevronRight className="w-4 h-4 text-dim" />
          )}
          <span>参考音频克隆（上传/录制 5~15 秒人声定制专属音色）</span>
        </span>
        <span className="text-[11.5px] text-dim">CosyVoice2</span>
      </button>

      {cloneSectionOpen && (
        <div className="p-3 border-t border-line space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[13px] text-secondary cursor-pointer">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <input
                type="checkbox"
                checked={cloneConsent}
                onChange={(e) => setCloneConsent(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span>我确认已取得音频本人授权或使用原创配音样本</span>
            </label>
            <button
              type="button"
              onClick={handleSyncRemoteCloned}
              disabled={syncingRemote}
              className="flex items-center gap-1 text-[13px] text-accent hover:underline cursor-pointer disabled:opacity-50"
            >
              {syncingRemote ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              <span>同步云端已克隆音色</span>
            </button>
          </div>

          {remoteCloned.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {remoteCloned.map((rc) => (
                <button
                  key={rc.uri}
                  type="button"
                  onClick={() => {
                    updateTtsField({ ttsVoice: rc.uri });
                    setNewProfileName(rc.customName);
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-[13px] cursor-pointer ${
                    draftVoice.ttsVoice === rc.uri
                      ? 'border-accent bg-accent-soft text-accent font-medium'
                      : 'border-line bg-sidebar text-ink'
                  }`}
                >
                  {rc.customName}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              placeholder="克隆音色名称（支持中文，如：清冷师姐）"
              className="px-3 py-2 rounded-xl bg-sidebar border border-line text-[13px] text-ink outline-none focus:border-accent"
            />
            <input
              value={cloneText}
              onChange={(e) => setCloneText(e.target.value)}
              placeholder="参考音频里实际念的文字台词（必填）"
              className="px-3 py-2 rounded-xl bg-sidebar border border-line text-[13px] text-ink outline-none focus:border-accent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={cloneFileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleSelectCloneAudio(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => cloneFileInputRef.current?.click()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-line bg-sidebar text-[13px] text-ink hover:bg-hover cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>上传音频文件</span>
            </button>
            <button
              type="button"
              onClick={recordingSample ? stopSampleRecording : startSampleRecording}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-[13px] cursor-pointer ${
                recordingSample
                  ? 'border-red-500 bg-red-500/15 text-red-500'
                  : 'border-line bg-sidebar text-ink hover:bg-hover'
              }`}
            >
              {recordingSample ? (
                <Square className="w-3.5 h-3.5" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
              <span>{recordingSample ? `停止录音 (${recordSeconds}s)` : '现场录制样本'}</span>
            </button>
            {cloneAudioLabel && (
              <span className="text-[11.5px] text-emerald-500">{cloneAudioLabel}</span>
            )}
          </div>

          {cloneAudioPreviewUrl && (
            <audio controls src={cloneAudioPreviewUrl} className="w-full h-8" />
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleUploadCloneAndCreateProfile}
              disabled={cloning}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-accent text-white text-[13px] font-medium cursor-pointer disabled:opacity-50"
            >
              {cloning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>上传并加入声音库</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
