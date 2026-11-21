import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  Wand2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { VoiceConfig, VoiceProfile } from '../../types';
import {
  audioBlobToDataUrl,
  type BreezeVoiceItem,
  deleteRemoteClonedVoice,
  isBreezeCloudBase,
  listBreezeVoices,
  listNativeVoices,
  listRemoteClonedVoices,
  speakText,
  stopSpeaking,
  STT_PRESETS,
  TTS_PRESETS,
  uploadClonedVoice,
} from '../../services/voiceService';
import { createId, openExternalUrl } from '../../utils/platform';

interface VoiceStudioTabProps {
  draftVoice: VoiceConfig;
  setDraftVoice: React.Dispatch<React.SetStateAction<VoiceConfig>>;
  onSaveVoice: () => Promise<void>;
}

const VOICE_INSPIRATION_CHIPS = [
  {
    label: '温柔清冷女声',
    prompt: '年轻女性，温柔清冷、声线清澈，带有一丝克制与神秘感',
  },
  {
    label: '低沉磁性男声',
    prompt: '成熟男性，声音低沉富有磁性，语速沉稳从容',
  },
  {
    label: '元气活力少女',
    prompt: '年轻活泼少女，声音清亮甜美，带有轻快笑意',
  },
  {
    label: '沉稳叙事旁白',
    prompt: '专业有声书旁白腔，沉稳有力、吐字清晰、富有画面感',
  },
  {
    label: '慵懒御姐声线',
    prompt: '成熟优雅御姐声线，语调慵懒从容，略带磁性',
  },
  {
    label: '清亮少年男声',
    prompt: '少年感青年男声，声音清朗干净，带着真诚与朝气',
  },
];

const MAX_CLONE_AUDIO_BYTES = 10 * 1024 * 1024;

export const VoiceStudioTab: React.FC<VoiceStudioTabProps> = ({
  draftVoice,
  setDraftVoice,
  onSaveVoice,
}) => {
  const {
    providers,
    voiceProfiles,
    upsertVoiceProfile,
    deleteVoiceProfile,
    updateSettings,
    showToast,
    requestConfirm,
  } = useAppStore();

  const [showVoiceKey, setShowVoiceKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sttOpen, setSttOpen] = useState(false);
  const [studioMode, setStudioMode] = useState<'design' | 'clone'>('design');

  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [previewText, setPreviewText] = useState('你好，今天想让我用怎样的声音陪你聊天？');

  // Save voice profile inline
  const [savingProfileOpen, setSavingProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  // Voice cloning state
  const [cloneName, setCloneName] = useState('');
  const [cloneText, setCloneText] = useState('');
  const [cloneAudioDataUrl, setCloneAudioDataUrl] = useState<string>('');
  const [cloneAudioPreviewUrl, setCloneAudioPreviewUrl] = useState<string>('');
  const [cloneAudioLabel, setCloneAudioLabel] = useState<string>('');
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [syncingRemote, setSyncingRemote] = useState(false);
  const [breezeVoices, setBreezeVoices] = useState<BreezeVoiceItem[]>([]);
  const [fetchingBreezeVoices, setFetchingBreezeVoices] = useState(false);

  // Import existing / local-trained voice state
  const [localImportOpen, setLocalImportOpen] = useState(false);
  const [localImportName, setLocalImportName] = useState('');
  const [localImportUrl, setLocalImportUrl] = useState('http://127.0.0.1:7860/v1');
  const [localImportModel, setLocalImportModel] = useState('BreezeBlue/Breeze-TTS-2');
  const [localImportVoiceId, setLocalImportVoiceId] = useState('');

  // Mic sample recording state
  const [recordingSample, setRecordingSample] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const sampleRecRef = useRef<MediaRecorder | null>(null);
  const sampleStreamRef = useRef<MediaStream | null>(null);
  const sampleTimerRef = useRef<number | null>(null);
  const cloneFileInputRef = useRef<HTMLInputElement>(null);

  const nativeVoices = listNativeVoices();

  const activeCloudPreset = useMemo(() => {
    if (draftVoice.ttsEngine !== 'openai_api') return null;
    const base = draftVoice.ttsBaseUrl.trim().replace(/\/+$/, '');
    if (isBreezeCloudBase(base)) {
      return TTS_PRESETS.find((p) => p.id === 'breeze') || TTS_PRESETS[0];
    }
    return TTS_PRESETS.find((p) => p.baseUrl === base) || TTS_PRESETS[0];
  }, [draftVoice.ttsEngine, draftVoice.ttsBaseUrl]);

  useEffect(() => {
    return () => {
      if (sampleTimerRef.current) window.clearInterval(sampleTimerRef.current);
      sampleStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (cloneAudioPreviewUrl) URL.revokeObjectURL(cloneAudioPreviewUrl);
    };
  }, [cloneAudioPreviewUrl]);

  const setSamplePreviewFromBlob = (blob: Blob, label: string) => {
    if (cloneAudioPreviewUrl) URL.revokeObjectURL(cloneAudioPreviewUrl);
    setCloneAudioPreviewUrl(URL.createObjectURL(blob));
    setCloneAudioLabel(label);
  };

  const handleSelectCloudPreset = (presetId: string) => {
    const preset = TTS_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setDraftVoice({
      ...draftVoice,
      ttsEngine: 'openai_api',
      ttsBaseUrl: preset.baseUrl,
      ttsModel: preset.model,
      ttsVoice: preset.defaultVoice,
    });
  };

  const handleFetchBreezeVoices = async () => {
    setFetchingBreezeVoices(true);
    try {
      const list = await listBreezeVoices({
        baseUrl: draftVoice.ttsBaseUrl,
        apiKey: draftVoice.ttsApiKey,
        providers,
      });
      setBreezeVoices(list);
      if (list.length === 0) {
        showToast('Breeze 账号下暂无音色，请先在 Breeze 控制台创建或克隆音色');
        return;
      }
      const currentVoiceId = draftVoice.ttsVoice.trim();
      const matched = list.find((v) => v.voiceId === currentVoiceId);
      if (!matched) {
        setDraftVoice((prev) => ({ ...prev, ttsVoice: list[0].voiceId }));
      }
      showToast(`已获取 ${list.length} 个 Breeze 音色`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '拉取 Breeze 音色失败', 'error');
    } finally {
      setFetchingBreezeVoices(false);
    }
  };

  const handlePreviewTts = async (overrideProfile?: VoiceProfile) => {
    if (previewingVoice && !overrideProfile) {
      stopSpeaking();
      setPreviewingVoice(false);
      return;
    }
    setPreviewingVoice(true);
    await speakText({
      text: previewText.trim() || '你好，这是一句试听台词。',
      config: draftVoice,
      providers,
      profile: overrideProfile,
      onEnd: () => setPreviewingVoice(false),
      onError: (msg) => {
        setPreviewingVoice(false);
        showToast(msg, 'error');
      },
    });
  };

  const handleSaveAsProfile = async () => {
    const name =
      newProfileName.trim() ||
      (draftVoice.ttsStyleInstruction.trim().slice(0, 10) || '我的专属音色');
    const now = Date.now();
    const voiceId =
      draftVoice.ttsEngine === 'native'
        ? draftVoice.ttsNativeVoice
        : draftVoice.ttsVoice.trim();
    const profile: VoiceProfile = {
      id: createId('vp'),
      name,
      engine: draftVoice.ttsEngine,
      baseUrl: draftVoice.ttsEngine === 'openai_api' ? draftVoice.ttsBaseUrl.trim() : undefined,
      model: draftVoice.ttsEngine === 'openai_api' ? draftVoice.ttsModel.trim() : undefined,
      voiceId,
      rate: draftVoice.ttsRate,
      pitch: draftVoice.ttsPitch,
      volume: draftVoice.ttsVolume,
      gain: draftVoice.ttsGain,
      styleInstruction: draftVoice.ttsStyleInstruction,
      createdAt: now,
      updatedAt: now,
    };
    await upsertVoiceProfile(profile);
    const nextVoice: VoiceConfig = { ...draftVoice, activeVoiceProfileId: profile.id };
    setDraftVoice(nextVoice);
    await updateSettings({ voice: nextVoice });
    setSavingProfileOpen(false);
    setNewProfileName('');
    showToast(`已保存并启用「${name}」`, 'success');
  };

  const handleImportLocalProfile = async () => {
    const name = localImportName.trim();
    const baseUrl = localImportUrl.trim();
    if (!name || !baseUrl) {
      showToast('请填写音色名称与接口地址', 'error');
      return;
    }
    const now = Date.now();
    const profile: VoiceProfile = {
      id: createId('vp'),
      name,
      engine: 'openai_api',
      baseUrl,
      model: localImportModel.trim() || 'custom-tts',
      voiceId: localImportVoiceId.trim() || name,
      rate: 1,
      pitch: 1,
      volume: 1,
      gain: 0,
      styleInstruction: '',
      createdAt: now,
      updatedAt: now,
    };
    await upsertVoiceProfile(profile);
    const nextVoice: VoiceConfig = {
      ...draftVoice,
      ttsEngine: 'openai_api',
      ttsBaseUrl: baseUrl,
      ttsModel: profile.model || draftVoice.ttsModel,
      ttsVoice: profile.voiceId,
      activeVoiceProfileId: profile.id,
    };
    setDraftVoice(nextVoice);
    await updateSettings({ voice: nextVoice });
    setLocalImportOpen(false);
    setLocalImportName('');
    setLocalImportVoiceId('');
    showToast(`已导入并启用「${name}」`, 'success');
  };

  const handleCloneAudioFilePick = async (file: File) => {
    if (file.size > MAX_CLONE_AUDIO_BYTES) {
      showToast('参考音频不能超过 10MB（建议 5~25 秒清晰人声）', 'error');
      return;
    }
    try {
      const dataUrl = await audioBlobToDataUrl(file);
      setCloneAudioDataUrl(dataUrl);
      setSamplePreviewFromBlob(file, `${file.name} (${Math.round(file.size / 1024)} KB)`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '读取参考音频失败', 'error');
    }
  };

  const handleToggleRecordSample = async () => {
    if (recordingSample) {
      if (sampleTimerRef.current) {
        window.clearInterval(sampleTimerRef.current);
        sampleTimerRef.current = null;
      }
      sampleRecRef.current?.stop();
      setRecordingSample(false);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('当前环境不支持麦克风录音，请改用「选择音频文件」上传', 'error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sampleStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        sampleStreamRef.current = null;
        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const dataUrl = await audioBlobToDataUrl(blob);
        setCloneAudioDataUrl(dataUrl);
        setSamplePreviewFromBlob(blob, `现场录制 (${Math.round(blob.size / 1024)} KB)`);
      };
      sampleRecRef.current = rec;
      setRecordSeconds(0);
      setRecordingSample(true);
      rec.start();
      sampleTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 24) {
            rec.stop();
            setRecordingSample(false);
            if (sampleTimerRef.current) {
              window.clearInterval(sampleTimerRef.current);
              sampleTimerRef.current = null;
            }
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      showToast(err instanceof Error ? `无法启动麦克风: ${err.message}` : '无法启动麦克风', 'error');
    }
  };

  const handleUploadClone = async () => {
    if (!cloneConsent) {
      showToast('请先勾选声音合法授权承诺框', 'error');
      return;
    }
    const displayName = cloneName.trim() || '我的克隆音色';
    setCloning(true);
    try {
      const res = await uploadClonedVoice({
        baseUrl: draftVoice.ttsBaseUrl,
        apiKey: draftVoice.ttsApiKey,
        providers,
        model: draftVoice.ttsModel,
        customName: displayName,
        text: cloneText,
        audioDataUrl: cloneAudioDataUrl,
      });

      const now = Date.now();
      const profile: VoiceProfile = {
        id: createId('vp'),
        name: displayName,
        engine: 'openai_api',
        baseUrl: draftVoice.ttsBaseUrl.trim(),
        model: draftVoice.ttsModel.trim(),
        voiceId: res.uri,
        rate: draftVoice.ttsRate,
        pitch: 1,
        volume: draftVoice.ttsVolume,
        gain: draftVoice.ttsGain,
        styleInstruction: draftVoice.ttsStyleInstruction,
        isCloned: true,
        sourceText: cloneText.trim(),
        createdAt: now,
        updatedAt: now,
      };
      await upsertVoiceProfile(profile);

      const nextVoice: VoiceConfig = {
        ...draftVoice,
        ttsEngine: 'openai_api',
        ttsVoice: res.uri,
        activeVoiceProfileId: profile.id,
      };
      setDraftVoice(nextVoice);
      await updateSettings({ voice: nextVoice });
      showToast(`音色克隆成功！「${displayName}」已设为默认音色`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '音色克隆失败', 'error');
    } finally {
      setCloning(false);
    }
  };

  const handleSyncRemoteVoices = async () => {
    setSyncingRemote(true);
    try {
      const list = await listRemoteClonedVoices({
        baseUrl: draftVoice.ttsBaseUrl,
        apiKey: draftVoice.ttsApiKey,
        providers,
      });
      if (list.length === 0) {
        showToast('当前账号下暂无已上传的克隆音色');
        return;
      }
      let added = 0;
      const existingUris = new Set(voiceProfiles.map((p) => p.voiceId));
      const now = Date.now();
      for (const item of list) {
        if (existingUris.has(item.uri)) continue;
        await upsertVoiceProfile({
          id: createId('vp'),
          name: item.customName || '云端克隆音色',
          engine: 'openai_api',
          baseUrl: draftVoice.ttsBaseUrl.trim(),
          model: item.model || draftVoice.ttsModel.trim(),
          voiceId: item.uri,
          rate: 1,
          pitch: 1,
          volume: 1,
          gain: 0,
          styleInstruction: '',
          isCloned: true,
          sourceText: item.text,
          createdAt: now,
          updatedAt: now,
        });
        added++;
      }
      showToast(added > 0 ? `已同步 ${added} 个云端克隆音色` : '本地音色库已与云端同步', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '同步克隆音色失败', 'error');
    } finally {
      setSyncingRemote(false);
    }
  };

  const handleApplyProfile = async (profile: VoiceProfile) => {
    const nextVoice: VoiceConfig = {
      ...draftVoice,
      ttsEngine: profile.engine,
      ttsRate: profile.rate,
      ttsPitch: profile.pitch,
      ttsVolume: profile.volume,
      ttsGain: profile.gain,
      ttsStyleInstruction: profile.styleInstruction,
      ...(profile.engine === 'native'
        ? { ttsNativeVoice: profile.voiceId }
        : {
            ttsBaseUrl: profile.baseUrl || draftVoice.ttsBaseUrl,
            ttsModel: profile.model || draftVoice.ttsModel,
            ttsVoice: profile.voiceId,
          }),
      activeVoiceProfileId: profile.id,
    };
    setDraftVoice(nextVoice);
    await updateSettings({ voice: nextVoice });
    showToast(`已切换默认音色为「${profile.name}」`, 'success');
  };

  const handleDeleteProfile = (profile: VoiceProfile) => {
    requestConfirm({
      title: '删除音色档案',
      message: profile.isCloned
        ? `确定删除「${profile.name}」吗？同时会尝试从云端移除该克隆音色。`
        : `确定删除本地音色档案「${profile.name}」吗？`,
      danger: true,
      onConfirm: async () => {
        if (profile.isCloned && profile.voiceId.startsWith('speech:')) {
          await deleteRemoteClonedVoice({
            baseUrl: profile.baseUrl || draftVoice.ttsBaseUrl,
            apiKey: draftVoice.ttsApiKey,
            providers,
            uri: profile.voiceId,
          }).catch(() => {});
        }
        await deleteVoiceProfile(profile.id);
        showToast(`已删除「${profile.name}」`);
      },
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 text-[13px]">
      {/* Quick Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-accent-soft border border-accent/25">
        <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
          <Sparkles className="w-4 h-4 text-accent shrink-0" />
          <span>2 步出声音：选好语音平台并填 Key → 一句话形容想要的音色并试听保存</span>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <label className="flex items-center gap-1.5 cursor-pointer text-secondary">
            <input
              type="checkbox"
              checked={draftVoice.ttsEnabled}
              onChange={(e) => setDraftVoice({ ...draftVoice, ttsEnabled: e.target.checked })}
            />
            <span>显示朗读按钮</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-secondary">
            <input
              type="checkbox"
              checked={draftVoice.ttsAutoPlay}
              onChange={(e) => setDraftVoice({ ...draftVoice, ttsAutoPlay: e.target.checked })}
            />
            <span>自动朗读</span>
          </label>
        </div>
      </div>

      {/* STEP 1: Choose Voice Platform + Enter Key */}
      <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-3">
        <div className="font-semibold text-ink text-[14px]">
          第一步：选择语音平台（支持 Breeze / 硅基流动 / Fish / MiniMax 等）
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setDraftVoice({ ...draftVoice, ttsEngine: 'native' })}
            className={`p-2.5 rounded-xl border text-left cursor-pointer transition ${
              draftVoice.ttsEngine === 'native'
                ? 'border-accent bg-accent-soft'
                : 'border-line bg-canvas hover:bg-hover'
            }`}
          >
            <div className="font-semibold text-ink text-[12px]">系统自带语音</div>
            <div className="text-[10.5px] text-emerald-500 mt-0.5">完全免费 · 无需 Key</div>
          </button>

          {TTS_PRESETS.map((p) => {
            const selected =
              draftVoice.ttsEngine === 'openai_api' &&
              (p.id === 'breeze'
                ? isBreezeCloudBase(draftVoice.ttsBaseUrl)
                : draftVoice.ttsBaseUrl.trim().replace(/\/+$/, '') === p.baseUrl);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectCloudPreset(p.id)}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition ${
                  selected
                    ? 'border-accent bg-accent-soft'
                    : 'border-line bg-canvas hover:bg-hover'
                }`}
              >
                <div className="font-semibold text-ink text-[12px] truncate">{p.name}</div>
                <div className="text-[10.5px] text-dim mt-0.5 truncate">
                  {p.supportsVoiceDesign ? '支持一句话捏音色' : p.model}
                </div>
              </button>
            );
          })}
        </div>

        {/* Native quick voice select */}
        {draftVoice.ttsEngine === 'native' && nativeVoices.length > 0 && (
          <div>
            <label className="block mb-1 text-[12px] text-secondary">系统内置声音选择</label>
            <select
              value={draftVoice.ttsNativeVoice}
              onChange={(e) => setDraftVoice({ ...draftVoice, ttsNativeVoice: e.target.value })}
              className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink text-[12px] outline-none"
            >
              <option value="">自动匹配中文语音</option>
              {nativeVoices.map((v) => (
                <option key={`${v.name}-${v.lang}`} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Cloud API Key Input (Super Simple) + Collapsible Advanced Settings */}
        {draftVoice.ttsEngine === 'openai_api' && (
          <div className="space-y-2.5 pt-2 border-t border-line">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-secondary">
                {activeCloudPreset?.description}
              </span>
              {activeCloudPreset?.consoleUrl && (
                <button
                  type="button"
                  onClick={() => openExternalUrl(activeCloudPreset.consoleUrl)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent text-white text-[11.5px] font-medium cursor-pointer shrink-0"
                >
                  <span>去官网拿 Key</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>

            <div>
              <label className="block mb-1 text-[12px] text-secondary">
                API Key（若在「文本模型」里填过同厂商密钥，这里留空即可自动复用）
              </label>
              <div className="flex items-center rounded-xl bg-canvas border border-line px-3 focus-within:border-accent">
                <input
                  type={showVoiceKey ? 'text' : 'password'}
                  value={draftVoice.ttsApiKey}
                  onChange={(e) => setDraftVoice({ ...draftVoice, ttsApiKey: e.target.value })}
                  placeholder={
                    activeCloudPreset?.id === 'breeze'
                      ? 'brz_...（填写 Breeze 控制台的 API Key）'
                      : 'sk-... 或留空自动复用同域名文本 Key'
                  }
                  className="flex-1 py-2 bg-transparent text-ink font-mono text-[12.5px] outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowVoiceKey((v) => !v)}
                  className="p-1 text-dim hover:text-ink cursor-pointer"
                >
                  {showVoiceKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {activeCloudPreset?.models && activeCloudPreset.models.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                <span className="text-dim">切换模型：</span>
                {activeCloudPreset.models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDraftVoice({ ...draftVoice, ttsModel: m })}
                    className={`px-2 py-0.5 rounded-lg border font-mono cursor-pointer ${
                      draftVoice.ttsModel === m
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line bg-canvas text-secondary'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex items-center gap-1 text-[11.5px] text-dim hover:text-secondary cursor-pointer"
            >
              {advancedOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <span>高级参数（Base URL / 模型 ID / 音色 ID / 增益，一般不用改）</span>
            </button>

            {advancedOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-canvas border border-line">
                <div>
                  <label className="block mb-1 text-[11.5px] text-secondary">Base URL</label>
                  <input
                    value={draftVoice.ttsBaseUrl}
                    onChange={(e) => setDraftVoice({ ...draftVoice, ttsBaseUrl: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-sidebar border border-line text-ink font-mono text-[12px] outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-[11.5px] text-secondary">模型 ID</label>
                  <input
                    value={draftVoice.ttsModel}
                    onChange={(e) => setDraftVoice({ ...draftVoice, ttsModel: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-sidebar border border-line text-ink font-mono text-[12px] outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-[11.5px] text-secondary">
                    指定音色 ID / URI（Breeze 可留空自动选首个音色，或填 voc_...）
                  </label>
                  <input
                    value={draftVoice.ttsVoice}
                    onChange={(e) => setDraftVoice({ ...draftVoice, ttsVoice: e.target.value })}
                    placeholder="留空按下方描述生成，或填指定音色 ID"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-sidebar border border-line text-ink font-mono text-[12px] outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-[11.5px] text-secondary">
                    输出增益 ({draftVoice.ttsGain >= 0 ? `+${draftVoice.ttsGain}` : draftVoice.ttsGain} dB)
                  </label>
                  <input
                    type="range"
                    min={-10}
                    max={10}
                    step={1}
                    value={draftVoice.ttsGain}
                    onChange={(e) =>
                      setDraftVoice({ ...draftVoice, ttsGain: Number(e.target.value) })
                    }
                    className="w-full accent-[#4d6bfe]"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* STEP 2: One-Click Voice Workbench (Voice Design OR Audio Clone / Local Import) */}
      <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-ink text-[14px]">第二步：定制你想要的声音</span>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-muted border border-line text-[11.5px]">
            <button
              type="button"
              onClick={() => setStudioMode('design')}
              className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer ${
                studioMode === 'design' ? 'bg-card text-accent' : 'text-secondary'
              }`}
            >
              一句话捏音色（最简单）
            </button>
            <button
              type="button"
              onClick={() => setStudioMode('clone')}
              className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer ${
                studioMode === 'clone' ? 'bg-card text-accent' : 'text-secondary'
              }`}
            >
              音频克隆 / 导入本地音色
            </button>
          </div>
        </div>

        {studioMode === 'design' ? (
          <div className="space-y-3">
            {draftVoice.ttsEngine === 'openai_api' && activeCloudPreset?.id === 'breeze' && (
              <div className="p-3 rounded-xl bg-canvas border border-line space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-ink">
                    选择 Breeze 音色（不选也能试听，将自动选用账号下首个音色）
                  </span>
                  <button
                    type="button"
                    onClick={handleFetchBreezeVoices}
                    disabled={fetchingBreezeVoices}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-accent/40 bg-accent-soft text-[11.5px] font-medium text-accent hover:opacity-90 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${fetchingBreezeVoices ? 'animate-spin' : ''}`}
                    />
                    <span>{fetchingBreezeVoices ? '拉取中...' : '拉取账号音色'}</span>
                  </button>
                </div>
                <select
                  value={draftVoice.ttsVoice}
                  onChange={(e) => setDraftVoice({ ...draftVoice, ttsVoice: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-xl bg-sidebar border border-line text-ink text-[12px] outline-none focus:border-accent"
                >
                  <option value="">自动使用账号下首个音色</option>
                  {draftVoice.ttsVoice &&
                    !breezeVoices.some((v) => v.voiceId === draftVoice.ttsVoice) && (
                      <option value={draftVoice.ttsVoice}>{draftVoice.ttsVoice}</option>
                    )}
                  {breezeVoices.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name} ({v.voiceId}){v.category ? ` · ${v.category}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block mb-1 text-[12px] text-secondary">
                说出你想要的音色、年龄、性格或情绪（Breeze TTS 2 / 硅基流动 CosyVoice2 / OpenAI 直接生效）
              </label>
              <input
                value={draftVoice.ttsStyleInstruction}
                onChange={(e) =>
                  setDraftVoice({ ...draftVoice, ttsStyleInstruction: e.target.value })
                }
                placeholder="例如：年轻女性，声音温柔自然、清澈有亲和力，带一点轻柔笑意..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-ink text-[13px] outline-none focus:border-accent"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {VOICE_INSPIRATION_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() =>
                      setDraftVoice({ ...draftVoice, ttsStyleInstruction: chip.prompt })
                    }
                    className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[11.5px] text-secondary hover:border-accent hover:text-accent cursor-pointer"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              {draftVoice.ttsEngine === 'native' && (
                <div className="text-[11px] text-amber-500 mt-1.5">
                  提示：你当前选的是「系统自带语音」，只支持语速/音调调节；如需根据文字描述凭空捏出新音色，请在第一步选 Breeze TTS 2 或硅基流动等云端模型。
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block mb-1 text-[12px] text-secondary">
                  语速 ({draftVoice.ttsRate.toFixed(2)}x)
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={draftVoice.ttsRate}
                  onChange={(e) =>
                    setDraftVoice({ ...draftVoice, ttsRate: Number(e.target.value) })
                  }
                  className="w-full accent-[#4d6bfe]"
                />
              </div>
              <div>
                <label className="block mb-1 text-[12px] text-secondary">
                  音量 ({Math.round(draftVoice.ttsVolume * 100)}%)
                </label>
                <input
                  type="range"
                  min={0.2}
                  max={1.0}
                  step={0.05}
                  value={draftVoice.ttsVolume}
                  onChange={(e) =>
                    setDraftVoice({ ...draftVoice, ttsVolume: Number(e.target.value) })
                  }
                  className="w-full accent-[#4d6bfe]"
                />
              </div>
              {draftVoice.ttsEngine === 'native' && (
                <div>
                  <label className="block mb-1 text-[12px] text-secondary">
                    音调高低 ({draftVoice.ttsPitch.toFixed(2)})
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={draftVoice.ttsPitch}
                    onChange={(e) =>
                      setDraftVoice({ ...draftVoice, ttsPitch: Number(e.target.value) })
                    }
                    className="w-full accent-[#4d6bfe]"
                  />
                </div>
              )}
            </div>

            {/* Instant Audition + Save */}
            <div className="space-y-2 pt-2 border-t border-line">
              <div className="flex flex-wrap gap-2">
                <input
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  placeholder="输入试听台词..."
                  className="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-canvas border border-line text-ink text-[12.5px] outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => handlePreviewTts()}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-white text-[12.5px] font-medium cursor-pointer shrink-0"
                >
                  {previewingVoice ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>停止试听</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>一键试听效果</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSavingProfileOpen((v) => !v)}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl border border-line bg-canvas text-ink text-[12.5px] hover:bg-hover cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5 text-accent" />
                  <span>存为常用音色</span>
                </button>
              </div>

              {savingProfileOpen && (
                <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-canvas border border-line">
                  <input
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder="起个音色名字（如：温柔清冷女声，留空自动命名）"
                    className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg bg-sidebar border border-line text-ink text-[12px] outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveAsProfile}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-[12px] font-medium cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>保存并设为当前音色</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Sub-section A: Audio Upload / Record Cloning */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink text-[12.5px]">
                  上传 / 录制 5~25 秒清晰音频进行音色克隆（兼容硅基流动等）
                </span>
                <button
                  type="button"
                  onClick={handleSyncRemoteVoices}
                  disabled={syncingRemote}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-canvas text-[11.5px] text-accent hover:bg-hover cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${syncingRemote ? 'animate-spin' : ''}`} />
                  <span>同步云端克隆音色</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="新音色名称（如：主角青年音）"
                  className="px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink text-[12.5px] outline-none focus:border-accent"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={cloneFileInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleCloneAudioFilePick(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => cloneFileInputRef.current?.click()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-line bg-canvas text-[12px] text-ink hover:bg-hover cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-accent" />
                    <span>选择音频文件</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleRecordSample}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-[12px] cursor-pointer ${
                      recordingSample
                        ? 'border-red-500 bg-red-500/12 text-red-500 font-medium animate-pulse'
                        : 'border-line bg-canvas text-ink hover:bg-hover'
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>
                      {recordingSample ? `录制中 ${recordSeconds}s · 停止` : '现场录制样音'}
                    </span>
                  </button>
                </div>
              </div>

              {cloneAudioPreviewUrl && (
                <div className="p-2 rounded-xl bg-canvas border border-line flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11.5px] text-secondary truncate">{cloneAudioLabel}</span>
                  <audio src={cloneAudioPreviewUrl} controls className="h-8 max-w-full" />
                </div>
              )}

              <input
                value={cloneText}
                onChange={(e) => setCloneText(e.target.value)}
                placeholder="填写这段参考音频里说出的原话文字（必填，决定还原度）"
                className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink text-[12.5px] outline-none focus:border-accent"
              />

              <label className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/8 border border-amber-500/25 text-[11.5px] text-amber-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cloneConsent}
                  onChange={(e) => setCloneConsent(e.target.checked)}
                  className="mt-0.5 shrink-0"
                />
                <span className="flex items-start gap-1.5 leading-relaxed">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    我确认该音频由本人录制或已获声音主人明确授权，仅用于合法合规的个人创作。
                  </span>
                </span>
              </label>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleUploadClone}
                  disabled={cloning || !cloneConsent || !cloneAudioDataUrl || !cloneText.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-accent text-white text-[12px] font-medium disabled:opacity-40 cursor-pointer"
                >
                  {cloning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="w-3.5 h-3.5" />
                  )}
                  <span>{cloning ? '正在上传克隆...' : '上传并生成克隆音色'}</span>
                </button>
              </div>
            </div>

            {/* Sub-section B: Import Own Local-Trained / Self-Hosted Voice */}
            <div className="pt-3 border-t border-line space-y-2">
              <button
                type="button"
                onClick={() => setLocalImportOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>导入你用本地模型练好的音色（GPT-SoVITS / Breeze 本地版等）</span>
              </button>

              {localImportOpen && (
                <div className="p-3 rounded-xl bg-canvas border border-line space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={localImportName}
                      onChange={(e) => setLocalImportName(e.target.value)}
                      placeholder="显示名称（如：我本地训练的男主声音）"
                      className="px-3 py-1.5 rounded-lg bg-sidebar border border-line text-ink text-[12px] outline-none"
                    />
                    <input
                      value={localImportUrl}
                      onChange={(e) => setLocalImportUrl(e.target.value)}
                      placeholder="兼容接口地址（如 http://192.168.1.10:7860/v1）"
                      className="px-3 py-1.5 rounded-lg bg-sidebar border border-line text-ink font-mono text-[12px] outline-none"
                    />
                    <input
                      value={localImportModel}
                      onChange={(e) => setLocalImportModel(e.target.value)}
                      placeholder="模型 ID（如 BreezeBlue/Breeze-TTS-2 或 gpt-sovits）"
                      className="px-3 py-1.5 rounded-lg bg-sidebar border border-line text-ink font-mono text-[12px] outline-none"
                    />
                    <input
                      value={localImportVoiceId}
                      onChange={(e) => setLocalImportVoiceId(e.target.value)}
                      placeholder="音色名 / 说话人 ID"
                      className="px-3 py-1.5 rounded-lg bg-sidebar border border-line text-ink font-mono text-[12px] outline-none"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleImportLocalProfile}
                      className="px-3 py-1.5 rounded-lg bg-accent text-white text-[12px] font-medium cursor-pointer"
                    >
                      加入我的音色库并启用
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Saved Voice Profile Library */}
      {voiceProfiles.length > 0 && (
        <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-2.5">
          <div className="font-semibold text-ink text-[14px]">
            我的音色库（点击可直接切换，也可在角色卡里给角色单独绑定）
          </div>
          <div className="space-y-1.5">
            {voiceProfiles.map((vp) => {
              const isDefault = draftVoice.activeVoiceProfileId === vp.id;
              return (
                <div
                  key={vp.id}
                  className={`flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border ${
                    isDefault ? 'border-accent bg-accent-soft/60' : 'border-line bg-canvas'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-ink truncate">{vp.name}</span>
                      <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-muted text-secondary shrink-0">
                        {vp.isCloned ? '克隆' : vp.engine === 'native' ? '原生' : '云端/导入'}
                      </span>
                      {isDefault && (
                        <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 font-medium shrink-0">
                          当前默认
                        </span>
                      )}
                    </div>
                    {vp.styleInstruction && (
                      <div className="text-[11px] text-dim truncate mt-0.5">
                        风格：{vp.styleInstruction}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePreviewTts(vp)}
                      className="px-2.5 py-1 rounded-lg border border-line text-[11.5px] text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                    >
                      试听
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => handleApplyProfile(vp)}
                        className="px-2.5 py-1 rounded-lg bg-accent text-white text-[11.5px] cursor-pointer"
                      >
                        设为当前
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteProfile(vp)}
                      className="p-1.5 text-dim hover:text-red-500 cursor-pointer"
                      title="删除音色"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Collapsible STT Settings */}
      <div className="rounded-2xl bg-sidebar border border-line overflow-hidden">
        <button
          type="button"
          onClick={() => setSttOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left font-medium text-ink cursor-pointer hover:bg-hover/40"
        >
          <span className="flex items-center gap-2 text-[13px]">
            <Mic className="w-4 h-4 text-accent" />
            <span>语音输入设置（说话转文字 STT · 默认使用免费系统识别）</span>
          </span>
          {sttOpen ? (
            <ChevronDown className="w-4 h-4 text-dim" />
          ) : (
            <ChevronRight className="w-4 h-4 text-dim" />
          )}
        </button>

        {sttOpen && (
          <div className="px-4 pb-4 pt-1 space-y-3 border-t border-line">
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDraftVoice({ ...draftVoice, sttEngine: 'native' })}
                  className={`px-3 py-1.5 rounded-xl border text-[12px] cursor-pointer ${
                    draftVoice.sttEngine === 'native'
                      ? 'border-accent bg-accent-soft text-accent font-medium'
                      : 'border-line bg-canvas text-secondary'
                  }`}
                >
                  系统原生识别（免费）
                </button>
                <button
                  type="button"
                  onClick={() => setDraftVoice({ ...draftVoice, sttEngine: 'openai_api' })}
                  className={`px-3 py-1.5 rounded-xl border text-[12px] cursor-pointer ${
                    draftVoice.sttEngine === 'openai_api'
                      ? 'border-accent bg-accent-soft text-accent font-medium'
                      : 'border-line bg-canvas text-secondary'
                  }`}
                >
                  API 识别（全平台通用）
                </button>
              </div>
              <select
                value={draftVoice.sttLanguage}
                onChange={(e) => setDraftVoice({ ...draftVoice, sttLanguage: e.target.value })}
                className="px-2.5 py-1 rounded-lg bg-canvas border border-line text-ink text-[12px] outline-none"
              >
                <option value="zh">识别语言：中文</option>
                <option value="en">识别语言：English</option>
              </select>
            </div>

            {draftVoice.sttEngine === 'openai_api' && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {STT_PRESETS.map((p) => (
                    <div key={p.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setDraftVoice({
                            ...draftVoice,
                            sttBaseUrl: p.baseUrl,
                            sttModel: p.model,
                          })
                        }
                        className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[11.5px] text-secondary hover:border-accent hover:text-accent cursor-pointer"
                      >
                        {p.name}
                      </button>
                      {p.consoleUrl && (
                        <button
                          type="button"
                          onClick={() => openExternalUrl(p.consoleUrl)}
                          className="p-1 text-dim hover:text-accent cursor-pointer"
                          title="去官网拿 Key"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    value={draftVoice.sttBaseUrl}
                    onChange={(e) => setDraftVoice({ ...draftVoice, sttBaseUrl: e.target.value })}
                    placeholder="STT Base URL"
                    className="px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none"
                  />
                  <input
                    value={draftVoice.sttModel}
                    onChange={(e) => setDraftVoice({ ...draftVoice, sttModel: e.target.value })}
                    placeholder="STT 模型 ID"
                    className="px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none"
                  />
                  <input
                    type={showVoiceKey ? 'text' : 'password'}
                    value={draftVoice.sttApiKey}
                    onChange={(e) => setDraftVoice({ ...draftVoice, sttApiKey: e.target.value })}
                    placeholder="Key（可留空自动复用）"
                    className="px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onSaveVoice}
          className="px-5 py-2 rounded-xl font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
        >
          保存语音设置
        </button>
      </div>
    </div>
  );
};
