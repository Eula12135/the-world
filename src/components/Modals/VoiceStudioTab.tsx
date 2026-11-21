import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Library,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserCheck,
  Volume2,
  Wand2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { MediaProviderCredential, VoiceConfig, VoiceProfile } from '../../types';
import { resolveMediaApiKey } from '../../services/imageGenService';
import {
  audioBlobToDataUrl,
  type BreezeVoiceItem,
  type BreezeVoicePreview,
  deleteRemoteClonedVoice,
  designBreezeVoice,
  extractSiliconFlowShortVoice,
  fetchSttModels,
  fetchTtsModels,
  findSttPresetByBaseUrl,
  findTtsPresetByBaseUrl,
  formatSiliconFlowSystemVoice,
  isBreezeCloudBase,
  listBreezeVoices,
  listNativeVoices,
  listRemoteClonedVoices,
  pickMatchingBuiltinVoiceForGender,
  type RemoteClonedVoice,
  rewriteSiliconFlowVoiceForModel,
  saveBreezeVoiceDesign,
  speakText,
  stopSpeaking,
  STT_PRESETS,
  TTS_BUILTIN_VOICES,
  TTS_PRESETS,
  uploadClonedVoice,
} from '../../services/voiceService';
import { createId, openExternalUrl } from '../../utils/platform';

interface VoiceStudioTabProps {
  draftVoice: VoiceConfig;
  setDraftVoice: React.Dispatch<React.SetStateAction<VoiceConfig>>;
  onSaveVoice: (options?: { keepActiveProfile?: boolean }) => Promise<void>;
}

interface InspirationChip {
  label: string;
  gender: 'female' | 'male' | 'neutral';
  sfVoice: string;
  prompt: string;
}

const VOICE_INSPIRATION_CHIPS: InspirationChip[] = [
  {
    label: '慵懒御姐',
    gender: 'female',
    sfVoice: 'anna',
    prompt: '成熟优雅御姐女声，语调慵懒从容，略带磁性与低微气声',
  },
  {
    label: '温柔清冷女声',
    gender: 'female',
    sfVoice: 'claire',
    prompt: '年轻女性，温柔清冷、声线清澈柔和，带有一丝克制感',
  },
  {
    label: '元气活力少女',
    gender: 'female',
    sfVoice: 'diana',
    prompt: '年轻活泼少女，声音清亮甜美，带有轻快笑意',
  },
  {
    label: '御姐烈焰女声',
    gender: 'female',
    sfVoice: 'bella',
    prompt: '富有张力与戏剧表现力的女声，情绪饱满清晰',
  },
  {
    label: '低沉磁性男声',
    gender: 'male',
    sfVoice: 'benjamin',
    prompt: '成熟男性，声音低沉富有磁性，语速沉稳从容',
  },
  {
    label: '温润少年男声',
    gender: 'male',
    sfVoice: 'charles',
    prompt: '清朗温润的青年男声，语调真诚自然',
  },
  {
    label: '沉稳叙事旁白',
    gender: 'male',
    sfVoice: 'alex',
    prompt: '专业有声书旁白腔，沉稳有力、吐字清晰、富有画面感',
  },
];

const MAX_CLONE_AUDIO_BYTES = 10 * 1024 * 1024;

function getProviderDisplayName(vp: VoiceProfile): string {
  if (vp.engine === 'native') return '系统原生';
  const byId = vp.providerId ? TTS_PRESETS.find((p) => p.id === vp.providerId) : undefined;
  const preset = byId || (vp.baseUrl ? findTtsPresetByBaseUrl(vp.baseUrl) : undefined);
  if (preset) {
    return preset.name.split('（')[0].trim();
  }
  return '外部 API';
}

export const VoiceStudioTab: React.FC<VoiceStudioTabProps> = ({
  draftVoice,
  setDraftVoice,
  onSaveVoice,
}) => {
  const {
    providers,
    voiceProfiles,
    voiceStudioSubTab,
    setVoiceStudioSubTab,
    pendingVoiceBindTarget,
    clearPendingVoiceBind,
    completePendingVoiceBind,
    upsertVoiceProfile,
    deleteVoiceProfile,
    updateSettings,
    showToast,
    requestConfirm,
  } = useAppStore();

  const [showVoiceKey, setShowVoiceKey] = useState(false);
  const [showSttKey, setShowSttKey] = useState(false);
  const [nativeVoices, setNativeVoices] = useState<SpeechSynthesisVoice[]>(() => listNativeVoices());

  // Library audition tracking
  const [playingProfileId, setPlayingProfileId] = useState<string | null>(null);
  const [previewingDraft, setPreviewingDraft] = useState(false);
  const [previewText, setPreviewText] = useState('你好，今天想让我用怎样的声音陪你聊天？');

  // Model list refresh loading
  const [fetchingTtsModels, setFetchingTtsModels] = useState(false);
  const [fetchingSttModels, setFetchingSttModels] = useState(false);

  // Create/save voice profile form
  const [newProfileName, setNewProfileName] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);

  // Breeze Voice Design state
  const [designPrompt, setDesignPrompt] = useState('');
  const [designPreviews, setDesignPreviews] = useState<BreezeVoicePreview[]>([]);
  const [designing, setDesigning] = useState(false);
  const [savingDesignId, setSavingDesignId] = useState<string | null>(null);
  const [designVoiceName, setDesignVoiceName] = useState('');
  const [breezeVoices, setBreezeVoices] = useState<BreezeVoiceItem[]>([]);
  const [fetchingBreezeVoices, setFetchingBreezeVoices] = useState(false);

  // SiliconFlow / Remote Voice Cloning state
  const [cloneSectionOpen, setCloneSectionOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneText, setCloneText] = useState('');
  const [cloneAudioDataUrl, setCloneAudioDataUrl] = useState('');
  const [cloneAudioPreviewUrl, setCloneAudioPreviewUrl] = useState('');
  const [cloneAudioLabel, setCloneAudioLabel] = useState('');
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [remoteCloned, setRemoteCloned] = useState<RemoteClonedVoice[]>([]);
  const [syncingRemote, setSyncingRemote] = useState(false);

  // Mic sample recording refs & state (timers kept outside React state updaters for StrictMode safety)
  const [recordingSample, setRecordingSample] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const sampleRecRef = useRef<MediaRecorder | null>(null);
  const sampleStreamRef = useRef<MediaStream | null>(null);
  const sampleTimerRef = useRef<number | null>(null);
  const cloneFileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to browser speechSynthesis voiceschanged so native voices populate reliably
  useEffect(() => {
    const refresh = () => setNativeVoices(listNativeVoices());
    refresh();
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (synth?.addEventListener) {
      synth.addEventListener('voiceschanged', refresh);
    }
    const timer = window.setTimeout(refresh, 400);
    return () => {
      window.clearTimeout(timer);
      if (synth?.removeEventListener) {
        synth.removeEventListener('voiceschanged', refresh);
      }
    };
  }, []);

  // Pre-fill profile name when triggered from Character Card "+ 新建声音"
  useEffect(() => {
    if (pendingVoiceBindTarget?.kind === 'character' && pendingVoiceBindTarget.characterName) {
      setNewProfileName((prev) => prev || `${pendingVoiceBindTarget.characterName} 声线`);
      setDesignVoiceName((prev) => prev || `${pendingVoiceBindTarget.characterName} 声线`);
    }
  }, [pendingVoiceBindTarget]);

  // Clean up preview playback and active recording streams on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
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

  // Active TTS Provider ID
  const activeTtsProviderId = useMemo(() => {
    if (draftVoice.ttsEngine === 'native') return 'native';
    if (draftVoice.ttsProviderId && draftVoice.ttsProviderId !== 'native') {
      return draftVoice.ttsProviderId;
    }
    return findTtsPresetByBaseUrl(draftVoice.ttsBaseUrl)?.id || 'custom_tts';
  }, [draftVoice.ttsEngine, draftVoice.ttsProviderId, draftVoice.ttsBaseUrl]);

  const activeTtsPreset = useMemo(
    () =>
      activeTtsProviderId === 'native'
        ? null
        : TTS_PRESETS.find((p) => p.id === activeTtsProviderId) || null,
    [activeTtsProviderId]
  );

  const isBreezeActive = activeTtsProviderId === 'breeze' || isBreezeCloudBase(draftVoice.ttsBaseUrl);
  const isSiliconFlowActive =
    activeTtsProviderId === 'siliconflow_tts' ||
    draftVoice.ttsBaseUrl.toLowerCase().includes('siliconflow');

  const availableTtsModels = useMemo(() => {
    const savedModels = draftVoice.ttsProviderConfigs?.[activeTtsProviderId]?.models || [];
    const presetModels = activeTtsPreset?.models || [];
    return Array.from(new Set([...savedModels, ...presetModels].filter(Boolean)));
  }, [draftVoice.ttsProviderConfigs, activeTtsProviderId, activeTtsPreset]);

  const resolvedTtsReusableKey = useMemo(() => {
    if (activeTtsProviderId === 'native' || draftVoice.ttsApiKey.trim()) return '';
    return resolveMediaApiKey({
      providerId: activeTtsProviderId,
      baseUrl: draftVoice.ttsBaseUrl,
      explicitKey: '',
      providerConfigs: draftVoice.ttsProviderConfigs,
      providers,
    });
  }, [activeTtsProviderId, draftVoice.ttsApiKey, draftVoice.ttsBaseUrl, draftVoice.ttsProviderConfigs, providers]);

  // Active STT Provider ID
  const activeSttProviderId = useMemo(() => {
    if (draftVoice.sttEngine === 'native') return 'native';
    if (draftVoice.sttProviderId && draftVoice.sttProviderId !== 'native') {
      return draftVoice.sttProviderId;
    }
    return findSttPresetByBaseUrl(draftVoice.sttBaseUrl)?.id || 'custom_stt';
  }, [draftVoice.sttEngine, draftVoice.sttProviderId, draftVoice.sttBaseUrl]);

  const activeSttPreset = useMemo(
    () =>
      activeSttProviderId === 'native'
        ? null
        : STT_PRESETS.find((p) => p.id === activeSttProviderId) || null,
    [activeSttProviderId]
  );

  const availableSttModels = useMemo(() => {
    const savedModels = draftVoice.sttProviderConfigs?.[activeSttProviderId]?.models || [];
    const presetModels = activeSttPreset?.models || [];
    return Array.from(new Set([...savedModels, ...presetModels].filter(Boolean)));
  }, [draftVoice.sttProviderConfigs, activeSttProviderId, activeSttPreset]);

  const resolvedSttReusableKey = useMemo(() => {
    if (activeSttProviderId === 'native' || draftVoice.sttApiKey.trim()) return '';
    return resolveMediaApiKey({
      providerId: activeSttProviderId,
      baseUrl: draftVoice.sttBaseUrl,
      explicitKey: '',
      providerConfigs: draftVoice.sttProviderConfigs,
      providers,
    });
  }, [activeSttProviderId, draftVoice.sttApiKey, draftVoice.sttBaseUrl, draftVoice.sttProviderConfigs, providers]);

  const activeDefaultProfile = useMemo(
    () =>
      draftVoice.activeVoiceProfileId
        ? voiceProfiles.find((vp) => vp.id === draftVoice.activeVoiceProfileId)
        : undefined,
    [draftVoice.activeVoiceProfileId, voiceProfiles]
  );

  // Persist current active TTS provider fields into draftVoice.ttsProviderConfigs seamlessly
  const updateTtsField = (patch: Partial<VoiceConfig>) => {
    setDraftVoice((prev) => {
      const pid =
        prev.ttsEngine === 'native'
          ? 'native'
          : prev.ttsProviderId && prev.ttsProviderId !== 'native'
            ? prev.ttsProviderId
            : findTtsPresetByBaseUrl(prev.ttsBaseUrl)?.id || 'custom_tts';
      const next = { ...prev, ...patch };
      if (pid === 'native') return next;
      const existingCred = prev.ttsProviderConfigs?.[pid] || {};
      return {
        ...next,
        ttsProviderConfigs: {
          ...(prev.ttsProviderConfigs || {}),
          [pid]: {
            ...existingCred,
            baseUrl: next.ttsBaseUrl,
            apiKey: next.ttsApiKey,
            model: next.ttsModel,
            defaultVoice: next.ttsVoice,
          },
        },
      };
    });
  };

  const switchTtsProvider = (nextId: string) => {
    setDraftVoice((prev) => {
      const curId =
        prev.ttsEngine === 'native'
          ? 'native'
          : prev.ttsProviderId && prev.ttsProviderId !== 'native'
            ? prev.ttsProviderId
            : findTtsPresetByBaseUrl(prev.ttsBaseUrl)?.id || 'custom_tts';
      const nextConfigs: Record<string, MediaProviderCredential> = {
        ...(prev.ttsProviderConfigs || {}),
      };
      if (curId !== 'native') {
        nextConfigs[curId] = {
          ...(nextConfigs[curId] || {}),
          baseUrl: prev.ttsBaseUrl,
          apiKey: prev.ttsApiKey,
          model: prev.ttsModel,
          defaultVoice: prev.ttsVoice,
        };
      }

      if (nextId === 'native') {
        return {
          ...prev,
          ttsProviderId: 'native',
          ttsEngine: 'native',
          ttsProviderConfigs: nextConfigs,
        };
      }

      const preset = TTS_PRESETS.find((p) => p.id === nextId);
      const saved = nextConfigs[nextId];
      const nextBaseUrl = saved?.baseUrl ?? preset?.baseUrl ?? prev.ttsBaseUrl;
      const nextApiKey = saved?.apiKey ?? '';
      const nextModel = saved?.model ?? preset?.model ?? '';
      const nextVoice =
        saved?.defaultVoice !== undefined ? saved.defaultVoice : preset?.defaultVoice ?? '';
      return {
        ...prev,
        ttsProviderId: nextId,
        ttsEngine: 'openai_api',
        ttsProviderConfigs: {
          ...nextConfigs,
          [nextId]: {
            ...(saved || {}),
            baseUrl: nextBaseUrl,
            apiKey: nextApiKey,
            model: nextModel,
            defaultVoice: nextVoice,
          },
        },
        ttsBaseUrl: nextBaseUrl,
        ttsApiKey: nextApiKey,
        ttsModel: nextModel,
        ttsVoice: nextVoice,
      };
    });
    setDesignPreviews([]);
    setBreezeVoices([]);
    setRemoteCloned([]);
  };

  const updateSttField = (patch: Partial<VoiceConfig>) => {
    setDraftVoice((prev) => {
      const pid =
        prev.sttEngine === 'native'
          ? 'native'
          : prev.sttProviderId && prev.sttProviderId !== 'native'
            ? prev.sttProviderId
            : findSttPresetByBaseUrl(prev.sttBaseUrl)?.id || 'custom_stt';
      const next = { ...prev, ...patch };
      if (pid === 'native') return next;
      const existingCred = prev.sttProviderConfigs?.[pid] || {};
      return {
        ...next,
        sttProviderConfigs: {
          ...(prev.sttProviderConfigs || {}),
          [pid]: {
            ...existingCred,
            baseUrl: next.sttBaseUrl,
            apiKey: next.sttApiKey,
            model: next.sttModel,
          },
        },
      };
    });
  };

  const switchSttProvider = (nextId: string) => {
    setDraftVoice((prev) => {
      const curId =
        prev.sttEngine === 'native'
          ? 'native'
          : prev.sttProviderId && prev.sttProviderId !== 'native'
            ? prev.sttProviderId
            : findSttPresetByBaseUrl(prev.sttBaseUrl)?.id || 'custom_stt';
      const nextConfigs: Record<string, MediaProviderCredential> = {
        ...(prev.sttProviderConfigs || {}),
      };
      if (curId !== 'native') {
        nextConfigs[curId] = {
          ...(nextConfigs[curId] || {}),
          baseUrl: prev.sttBaseUrl,
          apiKey: prev.sttApiKey,
          model: prev.sttModel,
        };
      }

      if (nextId === 'native') {
        return {
          ...prev,
          sttProviderId: 'native',
          sttEngine: 'native',
          sttProviderConfigs: nextConfigs,
        };
      }

      const preset = STT_PRESETS.find((p) => p.id === nextId);
      const saved = nextConfigs[nextId];
      const nextBaseUrl = saved?.baseUrl ?? preset?.baseUrl ?? prev.sttBaseUrl;
      const nextApiKey = saved?.apiKey ?? '';
      const nextModel = saved?.model ?? preset?.model ?? '';
      return {
        ...prev,
        sttProviderId: nextId,
        sttEngine: 'openai_api',
        sttProviderConfigs: {
          ...nextConfigs,
          [nextId]: {
            ...(saved || {}),
            baseUrl: nextBaseUrl,
            apiKey: nextApiKey,
            model: nextModel,
          },
        },
        sttBaseUrl: nextBaseUrl,
        sttApiKey: nextApiKey,
        sttModel: nextModel,
      };
    });
  };

  const handleToggleQuickSetting = async (field: 'ttsEnabled' | 'ttsAutoPlay', checked: boolean) => {
    setDraftVoice((prev) => ({ ...prev, [field]: checked }));
    const savedVoice = useAppStore.getState().settings.voice;
    await updateSettings({ voice: { ...savedVoice, [field]: checked } });
  };

  const handleRefreshTtsModels = async () => {
    setFetchingTtsModels(true);
    try {
      const list = await fetchTtsModels({
        providerId: activeTtsProviderId,
        baseUrl: draftVoice.ttsBaseUrl,
        apiKey: draftVoice.ttsApiKey,
        providerConfigs: draftVoice.ttsProviderConfigs,
        providers,
      });
      const currentModel = draftVoice.ttsModel.trim();
      const nextModel = list.includes(currentModel) ? currentModel : list[0] || currentModel;
      setDraftVoice((prev) => {
        const nextVoice =
          activeTtsProviderId === 'siliconflow_tts' ||
          prev.ttsBaseUrl.toLowerCase().includes('siliconflow')
            ? rewriteSiliconFlowVoiceForModel(prev.ttsVoice, nextModel)
            : prev.ttsVoice;
        const curCred = prev.ttsProviderConfigs?.[activeTtsProviderId] || {};
        return {
          ...prev,
          ttsModel: nextModel,
          ttsVoice: nextVoice,
          ttsProviderConfigs: {
            ...(prev.ttsProviderConfigs || {}),
            [activeTtsProviderId]: {
              ...curCred,
              baseUrl: prev.ttsBaseUrl,
              apiKey: prev.ttsApiKey,
              model: nextModel,
              defaultVoice: nextVoice,
              models: list,
            },
          },
        };
      });
      showToast(`已刷新 ${list.length} 个可用语音模型`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '拉取语音模型失败', 'error');
    } finally {
      setFetchingTtsModels(false);
    }
  };

  const handleRefreshSttModels = async () => {
    setFetchingSttModels(true);
    try {
      const list = await fetchSttModels({
        providerId: activeSttProviderId,
        baseUrl: draftVoice.sttBaseUrl,
        apiKey: draftVoice.sttApiKey,
        providerConfigs: draftVoice.sttProviderConfigs,
        providers,
      });
      const currentModel = draftVoice.sttModel.trim();
      const nextModel = list.includes(currentModel) ? currentModel : list[0] || currentModel;
      setDraftVoice((prev) => {
        const curCred = prev.sttProviderConfigs?.[activeSttProviderId] || {};
        return {
          ...prev,
          sttModel: nextModel,
          sttProviderConfigs: {
            ...(prev.sttProviderConfigs || {}),
            [activeSttProviderId]: {
              ...curCred,
              baseUrl: prev.sttBaseUrl,
              apiKey: prev.sttApiKey,
              model: nextModel,
              models: list,
            },
          },
        };
      });
      showToast(`已刷新 ${list.length} 个识别模型`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '拉取识别模型失败', 'error');
    } finally {
      setFetchingSttModels(false);
    }
  };

  const handlePreviewDraft = async () => {
    if (previewingDraft) {
      stopSpeaking();
      setPreviewingDraft(false);
      return;
    }
    setPlayingProfileId(null);
    setPreviewingDraft(true);
    await speakText({
      text: previewText.trim() || '你好，今天想让我用怎样的声音陪你聊天？',
      config: draftVoice,
      providers,
      onEnd: () => setPreviewingDraft(false),
      onError: (msg) => {
        setPreviewingDraft(false);
        showToast(msg, 'error');
      },
    });
  };

  const handlePlayLibraryProfile = async (vp: VoiceProfile) => {
    if (playingProfileId === vp.id) {
      stopSpeaking();
      setPlayingProfileId(null);
      return;
    }
    setPreviewingDraft(false);
    setPlayingProfileId(vp.id);
    await speakText({
      text: previewText.trim() || `你好，我是${vp.name}的声音。`,
      config: draftVoice,
      providers,
      profile: vp,
      onEnd: () => setPlayingProfileId((cur) => (cur === vp.id ? null : cur)),
      onError: (msg) => {
        setPlayingProfileId((cur) => (cur === vp.id ? null : cur));
        showToast(msg, 'error');
      },
    });
  };

  const handleApplyInspirationChip = (chip: InspirationChip) => {
    setDraftVoice((prev) => {
      const pid =
        prev.ttsEngine === 'native'
          ? 'native'
          : prev.ttsProviderId && prev.ttsProviderId !== 'native'
            ? prev.ttsProviderId
            : findTtsPresetByBaseUrl(prev.ttsBaseUrl)?.id || 'custom_tts';
      let nextVoice = prev.ttsVoice;
      const isCustomCloned = prev.ttsVoice.trim().startsWith('speech:');
      if (!isCustomCloned && prev.ttsEngine === 'openai_api') {
        if (pid === 'siliconflow_tts' || prev.ttsBaseUrl.toLowerCase().includes('siliconflow')) {
          nextVoice = formatSiliconFlowSystemVoice(prev.ttsModel, chip.sfVoice);
        } else {
          const matched = pickMatchingBuiltinVoiceForGender(pid, prev.ttsModel, chip.gender);
          if (matched) nextVoice = matched;
        }
      }
      const next = {
        ...prev,
        ttsStyleInstruction: chip.prompt,
        ttsVoice: nextVoice,
      };
      if (pid !== 'native') {
        const cred = prev.ttsProviderConfigs?.[pid] || {};
        next.ttsProviderConfigs = {
          ...(prev.ttsProviderConfigs || {}),
          [pid]: {
            ...cred,
            baseUrl: prev.ttsBaseUrl,
            apiKey: prev.ttsApiKey,
            model: prev.ttsModel,
            defaultVoice: nextVoice,
          },
        };
      }
      return next;
    });
    if (isBreezeActive) {
      setDesignPrompt(chip.prompt);
    }
    if (!newProfileName.trim()) {
      setNewProfileName(chip.label);
    }
    if (isBreezeActive && !designVoiceName.trim()) {
      setDesignVoiceName(chip.label);
    }
  };

  const buildVoiceProfileFromDraft = (opts?: {
    overrideName?: string;
    overrideVoiceId?: string;
    overrideModel?: string;
    isCloned?: boolean;
  }): VoiceProfile => {
    const now = Date.now();
    const isUpdate = Boolean(editingProfileId);
    const existing = isUpdate ? voiceProfiles.find((p) => p.id === editingProfileId) : undefined;
    const presetName =
      activeTtsProviderId === 'native'
        ? '系统原生声音'
        : activeTtsPreset?.name.split('（')[0].trim() || '自定义声音';
    const voiceShort = extractSiliconFlowShortVoice(draftVoice.ttsVoice);
    const autoName =
      newProfileName.trim() ||
      (voiceShort ? `${presetName} · ${voiceShort}` : '') ||
      existing?.name ||
      `${presetName} · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;

    return {
      id: existing?.id || createId('voice'),
      name: (opts?.overrideName || autoName).trim(),
      providerId: activeTtsProviderId,
      engine: draftVoice.ttsEngine,
      rate: draftVoice.ttsRate,
      pitch: draftVoice.ttsPitch,
      volume: draftVoice.ttsVolume,
      gain: draftVoice.ttsGain,
      styleInstruction: draftVoice.ttsStyleInstruction.trim(),
      baseUrl: draftVoice.ttsEngine === 'openai_api' ? draftVoice.ttsBaseUrl.trim() : undefined,
      model: draftVoice.ttsEngine === 'openai_api' ? opts?.overrideModel || draftVoice.ttsModel.trim() : undefined,
      voiceId:
        opts?.overrideVoiceId ??
        (draftVoice.ttsEngine === 'native'
          ? draftVoice.ttsNativeVoice
          : draftVoice.ttsVoice.trim()),
      isCloned: opts?.isCloned ?? existing?.isCloned ?? draftVoice.ttsVoice.trim().startsWith('speech:'),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  };

  const handleSaveToLibrary = async (mode: 'library' | 'default' | 'bind') => {
    if (
      draftVoice.ttsEngine === 'openai_api' &&
      isBreezeActive &&
      !draftVoice.ttsVoice.trim()
    ) {
      showToast('Breeze 请先用上方「AI 生成音色预览」并保存声线，或填入/同步一个 Breeze voice_id', 'error');
      return;
    }

    const profile = buildVoiceProfileFromDraft();
    await upsertVoiceProfile(profile);

    if (mode === 'default') {
      const nextVoice: VoiceConfig = {
        ...draftVoice,
        activeVoiceProfileId: profile.id,
        ttsProviderConfigs: {
          ...(draftVoice.ttsProviderConfigs || {}),
          ...(activeTtsProviderId !== 'native'
            ? {
                [activeTtsProviderId]: {
                  ...(draftVoice.ttsProviderConfigs?.[activeTtsProviderId] || {}),
                  baseUrl: draftVoice.ttsBaseUrl.trim(),
                  apiKey: draftVoice.ttsApiKey.trim(),
                  model: draftVoice.ttsModel.trim(),
                  defaultVoice: draftVoice.ttsVoice.trim(),
                },
              }
            : {}),
        },
      };
      setDraftVoice(nextVoice);
      await updateSettings({ voice: nextVoice });
      showToast(`已保存「${profile.name}」并设为全局默认声音`, 'success');
    } else {
      await onSaveVoice({ keepActiveProfile: true });
      if (mode === 'bind') {
        await completePendingVoiceBind(profile.id);
        setEditingProfileId(null);
        setNewProfileName('');
        return;
      }
      showToast(`已将「${profile.name}」保存到我的声音库`, 'success');
    }

    setEditingProfileId(null);
    setNewProfileName('');
    setVoiceStudioSubTab('library');
  };

  const handleLoadProfileIntoEditor = (vp: VoiceProfile) => {
    const pid =
      vp.providerId ||
      (vp.engine === 'native' ? 'native' : findTtsPresetByBaseUrl(vp.baseUrl || '')?.id || 'custom_tts');
    setEditingProfileId(vp.id);
    setNewProfileName(vp.name);
    setDraftVoice((prev) => {
      const savedCred = pid !== 'native' ? prev.ttsProviderConfigs?.[pid] : undefined;
      const nextBaseUrl = vp.baseUrl || savedCred?.baseUrl || prev.ttsBaseUrl;
      const nextApiKey = savedCred?.apiKey ?? prev.ttsApiKey;
      const nextModel = vp.model || savedCred?.model || prev.ttsModel;
      const nextVoiceId = vp.voiceId || savedCred?.defaultVoice || prev.ttsVoice;
      return {
        ...prev,
        ttsProviderId: pid,
        ttsEngine: vp.engine,
        ttsRate: vp.rate,
        ttsPitch: vp.pitch,
        ttsVolume: vp.volume,
        ttsGain: vp.gain,
        ttsStyleInstruction: vp.styleInstruction || '',
        ttsNativeVoice: vp.engine === 'native' ? vp.voiceId || prev.ttsNativeVoice : prev.ttsNativeVoice,
        ttsBaseUrl: vp.engine === 'openai_api' ? nextBaseUrl : prev.ttsBaseUrl,
        ttsApiKey: vp.engine === 'openai_api' ? nextApiKey : prev.ttsApiKey,
        ttsModel: vp.engine === 'openai_api' ? nextModel : prev.ttsModel,
        ttsVoice: vp.engine === 'openai_api' ? nextVoiceId : prev.ttsVoice,
        ttsProviderConfigs:
          pid !== 'native'
            ? {
                ...(prev.ttsProviderConfigs || {}),
                [pid]: {
                  ...(savedCred || {}),
                  baseUrl: nextBaseUrl,
                  apiKey: nextApiKey,
                  model: nextModel,
                  defaultVoice: nextVoiceId,
                },
              }
            : prev.ttsProviderConfigs,
      };
    });
    setVoiceStudioSubTab('create');
  };

  const handleSetDefaultProfile = async (vp: VoiceProfile) => {
    const nextVoice: VoiceConfig = {
      ...draftVoice,
      activeVoiceProfileId: vp.id,
    };
    setDraftVoice(nextVoice);
    await updateSettings({ voice: nextVoice });
    showToast(`已将「${vp.name}」设为全局默认声音`, 'success');
  };

  const handleDeleteProfile = (vp: VoiceProfile) => {
    requestConfirm({
      title: '删除声音档案',
      message: `确定从「我的声音库」移除「${vp.name}」吗？引用它的角色卡也会自动恢复为默认声音。`,
      danger: true,
      onConfirm: async () => {
        if (playingProfileId === vp.id) {
          stopSpeaking();
          setPlayingProfileId(null);
        }
        if (vp.isCloned && vp.voiceId?.startsWith('speech:') && vp.baseUrl) {
          await deleteRemoteClonedVoice({
            baseUrl: vp.baseUrl,
            apiKey: draftVoice.ttsProviderConfigs?.[vp.providerId || 'siliconflow_tts']?.apiKey || draftVoice.ttsApiKey,
            providers,
            providerConfigs: draftVoice.ttsProviderConfigs,
            uri: vp.voiceId,
          }).catch(() => {});
        }
        await deleteVoiceProfile(vp.id);
        if (draftVoice.activeVoiceProfileId === vp.id) {
          setDraftVoice((prev) => ({ ...prev, activeVoiceProfileId: undefined }));
        }
        showToast('声音档案已删除');
      },
    });
  };

  // Breeze Voice Design handlers
  const handleDesignBreezeVoice = async () => {
    const desc = designPrompt.trim() || draftVoice.ttsStyleInstruction.trim();
    if (!desc) {
      showToast('请先描述想要的音色（例如：慵懒御姐，慢速，略带沙哑气声）', 'error');
      return;
    }
    setDesigning(true);
    setDesignPreviews([]);
    try {
      const previews = await designBreezeVoice({
        baseUrl: draftVoice.ttsBaseUrl,
        apiKey: draftVoice.ttsApiKey,
        providers,
        providerConfigs: draftVoice.ttsProviderConfigs,
        description: desc,
        text: previewText.trim() || '你好，这就是我为你捏好的新声线，听起来还满意吗？',
        model: draftVoice.ttsModel,
        previewCount: 2,
      });
      if (previews.length === 0) {
        showToast('接口未返回音频预览，请调整描述后重试', 'error');
      } else {
        setDesignPreviews(previews);
        if (!designVoiceName.trim()) {
          setDesignVoiceName(newProfileName.trim() || desc.slice(0, 12));
        }
        showToast(`已生成 ${previews.length} 条音色预览`, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '音色预览失败', 'error');
    } finally {
      setDesigning(false);
    }
  };

  const handleSaveBreezeDesignPreview = async (preview: BreezeVoicePreview) => {
    const label = designVoiceName.trim() || newProfileName.trim() || 'Breeze 捏制声线';
    setSavingDesignId(preview.generatedVoiceId);
    try {
      const saved = await saveBreezeVoiceDesign({
        baseUrl: draftVoice.ttsBaseUrl,
        apiKey: draftVoice.ttsApiKey,
        providers,
        providerConfigs: draftVoice.ttsProviderConfigs,
        generatedVoiceId: preview.generatedVoiceId,
        name: label,
        description: designPrompt.trim() || draftVoice.ttsStyleInstruction,
      });
      const profile = buildVoiceProfileFromDraft({
        overrideName: saved.name || label,
        overrideVoiceId: saved.voiceId,
        overrideModel: draftVoice.ttsModel.trim() || 'breeze-tts-2',
      });
      await upsertVoiceProfile(profile);

      const nextCreds: Record<string, MediaProviderCredential> = {
        ...(draftVoice.ttsProviderConfigs || {}),
        breeze: {
          ...(draftVoice.ttsProviderConfigs?.breeze || {}),
          baseUrl: draftVoice.ttsBaseUrl.trim() || 'https://api.breeze.blue',
          apiKey: draftVoice.ttsApiKey.trim(),
          model: draftVoice.ttsModel.trim() || 'breeze-tts-2',
          defaultVoice: saved.voiceId,
        },
      };
      const nextVoice: VoiceConfig = {
        ...draftVoice,
        ttsProviderId: 'breeze',
        ttsEngine: 'openai_api',
        ttsVoice: saved.voiceId,
        ttsProviderConfigs: nextCreds,
        activeVoiceProfileId: pendingVoiceBindTarget ? draftVoice.activeVoiceProfileId : profile.id,
      };
      setDraftVoice(nextVoice);
      await updateSettings({ voice: nextVoice });
      setDesignPreviews([]);
      setDesignVoiceName('');

      if (pendingVoiceBindTarget) {
        await completePendingVoiceBind(profile.id);
      } else {
        showToast(`已保存并启用「${profile.name}」`, 'success');
        setVoiceStudioSubTab('library');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存音色失败', 'error');
    } finally {
      setSavingDesignId(null);
    }
  };

  const handleFetchBreezeVoices = async () => {
    setFetchingBreezeVoices(true);
    try {
      const list = await listBreezeVoices({
        baseUrl: draftVoice.ttsBaseUrl,
        apiKey: draftVoice.ttsApiKey,
        providers,
        providerConfigs: draftVoice.ttsProviderConfigs,
      });
      setBreezeVoices(list);
      showToast(list.length > 0 ? `已获取 ${list.length} 个 Breeze 音色` : '账号下暂无已保存音色', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '获取 Breeze 音色列表失败', 'error');
    } finally {
      setFetchingBreezeVoices(false);
    }
  };

  // Cloning handlers (audio file or microphone)
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
        showToast(`声音克隆完成并已存入声音库`, 'success');
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
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 text-[13px]">
      {/* Pending character / persona bind banner */}
      {pendingVoiceBindTarget && (
        <div className="p-3 rounded-xl bg-accent-soft border border-accent/40 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink">
            <UserCheck className="w-4 h-4 text-accent shrink-0" />
            <span>
              正在为「
              <strong>
                {pendingVoiceBindTarget.kind === 'character'
                  ? pendingVoiceBindTarget.characterName || '当前角色'
                  : '新常用人设'}
              </strong>
              」新建或挑选专属声音 · 选择/保存后将自动绑定并返回
            </span>
          </div>
          <button
            type="button"
            onClick={clearPendingVoiceBind}
            className="px-2.5 py-1 rounded-lg border border-line bg-card text-[12px] text-secondary hover:text-ink cursor-pointer"
          >
            取消绑定模式
          </button>
        </div>
      )}

      {/* Global Quick Voice Switches + Subtab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-sidebar border border-line">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer text-ink font-medium">
            <input
              type="checkbox"
              checked={draftVoice.ttsEnabled}
              onChange={(e) => handleToggleQuickSetting('ttsEnabled', e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>启用语音朗读</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-secondary">
            <input
              type="checkbox"
              checked={draftVoice.ttsAutoPlay}
              onChange={(e) => handleToggleQuickSetting('ttsAutoPlay', e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>AI 回复后自动朗读</span>
          </label>
          {activeDefaultProfile && (
            <span className="text-[11.5px] px-2.5 py-0.5 rounded-full bg-accent-soft text-accent border border-accent/25">
              当前默认：{activeDefaultProfile.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted border border-line">
          <button
            type="button"
            onClick={() => setVoiceStudioSubTab('library')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition ${
              voiceStudioSubTab === 'library'
                ? 'bg-card text-accent shadow-xs'
                : 'text-secondary hover:text-ink'
            }`}
          >
            <Library className="w-3.5 h-3.5" />
            <span>我的声音库 ({voiceProfiles.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setVoiceStudioSubTab('create')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition ${
              voiceStudioSubTab === 'create'
                ? 'bg-card text-accent shadow-xs'
                : 'text-secondary hover:text-ink'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>{editingProfileId ? '编辑声音' : '制作声音'}</span>
          </button>
          <button
            type="button"
            onClick={() => setVoiceStudioSubTab('stt')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition ${
              voiceStudioSubTab === 'stt'
                ? 'bg-card text-accent shadow-xs'
                : 'text-secondary hover:text-ink'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>语音输入 (STT)</span>
          </button>
        </div>
      </div>

      {/* SUBTAB 1: Saved Voice Library */}
      {voiceStudioSubTab === 'library' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[14px] font-semibold text-ink">已保存的声音档案</h3>
              <p className="text-[12px] text-dim">
                切换厂商或调整参数后可保存为独立声音档案；在角色卡或人设里可直接下拉选用。
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingProfileId(null);
                setNewProfileName('');
                setVoiceStudioSubTab('create');
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-white text-[12.5px] font-medium hover:opacity-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>新建声音</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-canvas border border-line">
            <span className="text-[12px] text-dim shrink-0">试听台词：</span>
            <input
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              className="flex-1 min-w-[180px] bg-transparent text-[12.5px] text-ink outline-none"
              placeholder="输入试听语句..."
            />
          </div>

          {voiceProfiles.length === 0 ? (
            <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-line space-y-3">
              <Volume2 className="w-9 h-9 mx-auto text-dim" />
              <div className="text-[14px] font-medium text-ink">还没有保存任何声音档案</div>
              <p className="text-[12px] text-dim max-w-md mx-auto">
                去「制作声音」选择硅基流动、Breeze、OpenAI 或系统原生语音，选好女声/男声底色并保存，就能在所有角色和会话里一键切换了。
              </p>
              <button
                type="button"
                onClick={() => setVoiceStudioSubTab('create')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white text-[12.5px] font-medium cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>立即制作第一个声音</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {voiceProfiles.map((vp) => {
                const isDefault = draftVoice.activeVoiceProfileId === vp.id;
                const isPlaying = playingProfileId === vp.id;
                const providerLabel = getProviderDisplayName(vp);
                const shortSf = extractSiliconFlowShortVoice(vp.voiceId || '');
                const voiceSummary = vp.isCloned
                  ? '克隆音色'
                  : shortSf
                    ? `底色 ${shortSf}`
                    : vp.voiceId || '默认音色';
                return (
                  <div
                    key={vp.id}
                    className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 transition ${
                      isDefault ? 'border-accent bg-accent-soft/40' : 'border-line bg-sidebar'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-ink text-[14px] truncate">
                              {vp.name}
                            </span>
                            {isDefault && (
                              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-accent text-white">
                                全局默认
                              </span>
                            )}
                            {vp.isCloned && (
                              <span className="px-2 py-0.5 rounded-full text-[10.5px] bg-purple-500/15 text-purple-400">
                                克隆
                              </span>
                            )}
                          </div>
                          <div className="text-[11.5px] text-dim mt-1 truncate">
                            {providerLabel}
                            {vp.model ? ` · ${vp.model}` : ''} · {voiceSummary}
                          </div>
                        </div>
                      </div>
                      {vp.styleInstruction && (
                        <div className="text-[11.5px] text-secondary line-clamp-2 bg-canvas/80 px-2.5 py-1.5 rounded-lg border border-line/60">
                          语气：{vp.styleInstruction}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line/70">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handlePlayLibraryProfile(vp)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-canvas text-[12px] text-ink hover:border-accent cursor-pointer"
                        >
                          {isPlaying ? (
                            <Square className="w-3 h-3 text-accent" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5 text-accent" />
                          )}
                          <span>{isPlaying ? '停止' : '试听'}</span>
                        </button>

                        {pendingVoiceBindTarget ? (
                          <button
                            type="button"
                            onClick={() => completePendingVoiceBind(vp.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent text-white text-[12px] font-medium hover:opacity-95 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>选用并绑定</span>
                          </button>
                        ) : (
                          !isDefault && (
                            <button
                              type="button"
                              onClick={() => handleSetDefaultProfile(vp)}
                              className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[12px] text-secondary hover:text-accent hover:border-accent cursor-pointer"
                            >
                              设为默认
                            </button>
                          )
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleLoadProfileIntoEditor(vp)}
                          className="p-1.5 rounded-lg text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                          title="加载参数并编辑"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProfile(vp)}
                          className="p-1.5 rounded-lg text-dim hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
                          title="删除此声音"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: Create / Edit Voice */}
      {voiceStudioSubTab === 'create' && (
        <div className="space-y-4">
          {editingProfileId && (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[12px] text-ink">
              <span>
                正在编辑声音档案：<strong>{newProfileName || editingProfileId}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditingProfileId(null);
                  setNewProfileName('');
                }}
                className="underline text-secondary hover:text-ink cursor-pointer"
              >
                改为新建声音
              </button>
            </div>
          )}

          {/* Step A: Platform Selection (per-provider isolated credentials) */}
          <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-ink">1. 选择语音服务厂商（各家 Key 独立保存，切换互不覆盖）</div>
                <div className="text-[11.5px] text-dim mt-0.5">
                  填过硅基流动和 Breeze 后可随时来回切换，不会覆盖任何一方的 API Key。
                </div>
              </div>
              {activeTtsPreset?.consoleUrl && (
                <button
                  type="button"
                  onClick={() => openExternalUrl(activeTtsPreset.consoleUrl).catch(() => {})}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-soft text-accent text-[11.5px] font-medium hover:underline cursor-pointer"
                >
                  <span>去官网拿 Key</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => switchTtsProvider('native')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12px] cursor-pointer transition ${
                  activeTtsProviderId === 'native'
                    ? 'border-accent bg-accent-soft text-accent font-medium'
                    : 'border-line bg-canvas text-secondary hover:text-ink hover:bg-hover'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>系统原生 TTS（免费）</span>
              </button>
              {TTS_PRESETS.map((preset) => {
                const selected = activeTtsProviderId === preset.id;
                const cred = draftVoice.ttsProviderConfigs?.[preset.id];
                const hasCredential = Boolean(
                  cred?.apiKey?.trim() ||
                    resolveMediaApiKey({
                      providerId: preset.id,
                      baseUrl: cred?.baseUrl || preset.baseUrl,
                      explicitKey: cred?.apiKey || '',
                      providerConfigs: draftVoice.ttsProviderConfigs,
                      providers,
                    })
                );
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => switchTtsProvider(preset.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12px] cursor-pointer transition ${
                      selected
                        ? 'border-accent bg-accent-soft text-accent font-medium'
                        : 'border-line bg-canvas text-secondary hover:text-ink hover:bg-hover'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        hasCredential ? 'bg-emerald-500' : 'bg-line'
                      }`}
                    />
                    <span>{preset.name.split('（')[0]}</span>
                  </button>
                );
              })}
            </div>

            {activeTtsPreset && (
              <p className="text-[11.5px] text-dim">{activeTtsPreset.description}</p>
            )}

            {draftVoice.ttsEngine === 'openai_api' && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 text-[12px] font-medium text-secondary">
                      TTS Base URL
                    </label>
                    <input
                      value={draftVoice.ttsBaseUrl}
                      onChange={(e) => updateTtsField({ ttsBaseUrl: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-[12px] font-medium text-secondary">
                      API Key（{resolvedTtsReusableKey ? '留空将自动复用同域名 Key' : '仅保存在当前厂商下'}）
                    </label>
                    <div className="flex items-center rounded-xl bg-canvas border border-line px-3 focus-within:border-accent">
                      <input
                        type={showVoiceKey ? 'text' : 'password'}
                        value={draftVoice.ttsApiKey}
                        onChange={(e) => updateTtsField({ ttsApiKey: e.target.value })}
                        placeholder={
                          resolvedTtsReusableKey
                            ? '已自动检测到同域名文本 Key（也可在此覆盖）'
                            : '填写该厂商专用 API Key...'
                        }
                        className="flex-1 py-2 bg-transparent text-ink font-mono text-[12px] outline-none"
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
                </div>

                {/* Model ID + Refresh Available Models */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[12px] font-medium text-secondary">
                      语音模型 (Model)
                    </label>
                    <button
                      type="button"
                      onClick={handleRefreshTtsModels}
                      disabled={fetchingTtsModels}
                      className="flex items-center gap-1 text-[12px] text-accent hover:underline cursor-pointer disabled:opacity-50"
                    >
                      {fetchingTtsModels ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>刷新可用模型</span>
                    </button>
                  </div>
                  <input
                    value={draftVoice.ttsModel}
                    onChange={(e) => {
                      const nextModel = e.target.value;
                      const rewrittenVoice = isSiliconFlowActive
                        ? rewriteSiliconFlowVoiceForModel(draftVoice.ttsVoice, nextModel)
                        : draftVoice.ttsVoice;
                      updateTtsField({ ttsModel: nextModel, ttsVoice: rewrittenVoice });
                    }}
                    placeholder="输入或点击下方可选模型..."
                    className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none focus:border-accent"
                  />
                  {availableTtsModels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {availableTtsModels.map((m) => {
                        const selected = draftVoice.ttsModel === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              const rewrittenVoice = isSiliconFlowActive
                                ? rewriteSiliconFlowVoiceForModel(draftVoice.ttsVoice, m)
                                : draftVoice.ttsVoice;
                              updateTtsField({ ttsModel: m, ttsVoice: rewrittenVoice });
                            }}
                            className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono cursor-pointer ${
                              selected
                                ? 'border-accent bg-accent-soft text-accent font-medium'
                                : 'border-line bg-canvas text-secondary hover:bg-hover'
                            }`}
                          >
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Step B: Native vs Breeze vs SiliconFlow vs Standard OpenAI Voice Config */}
          {draftVoice.ttsEngine === 'native' ? (
            <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-3">
              <div className="font-semibold text-ink">2. 系统原生音色与语速音调</div>
              <div>
                <label className="block mb-1 text-[12px] font-medium text-secondary">
                  本机可用声音 ({nativeVoices.length})
                </label>
                <select
                  value={draftVoice.ttsNativeVoice}
                  onChange={(e) => setDraftVoice((prev) => ({ ...prev, ttsNativeVoice: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink text-[12.5px] outline-none focus:border-accent"
                >
                  <option value="">跟随系统默认语音</option>
                  {nativeVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="flex justify-between text-[12px] text-secondary mb-1">
                    <span>语速</span>
                    <span className="font-mono">{draftVoice.ttsRate.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={draftVoice.ttsRate}
                    onChange={(e) =>
                      setDraftVoice((prev) => ({ ...prev, ttsRate: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[12px] text-secondary mb-1">
                    <span>音高</span>
                    <span className="font-mono">{draftVoice.ttsPitch.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={draftVoice.ttsPitch}
                    onChange={(e) =>
                      setDraftVoice((prev) => ({ ...prev, ttsPitch: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[12px] text-secondary mb-1">
                    <span>音量</span>
                    <span className="font-mono">{Math.round((draftVoice.ttsVolume ?? 1) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={draftVoice.ttsVolume ?? 1}
                    onChange={(e) =>
                      setDraftVoice((prev) => ({ ...prev, ttsVolume: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
              </div>
            </div>
          ) : isBreezeActive ? (
            <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-ink">2. Breeze 一句话 AI 捏音色</div>
                  <div className="text-[11.5px] text-dim mt-0.5">
                    输入外貌/声线描述即可凭空生成候选声线；满意后点击保存，将直接存入云端并加入「我的声音库」。
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleFetchBreezeVoices}
                  disabled={fetchingBreezeVoices}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-line bg-canvas text-[12px] text-secondary hover:text-ink cursor-pointer disabled:opacity-50"
                >
                  {fetchingBreezeVoices ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>同步账号已保存音色</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {VOICE_INSPIRATION_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => handleApplyInspirationChip(chip)}
                    className="px-2.5 py-1 rounded-full bg-canvas border border-line text-[11.5px] text-secondary hover:border-accent hover:text-accent cursor-pointer"
                  >
                    + {chip.label}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <textarea
                  rows={2}
                  value={designPrompt}
                  onChange={(e) => setDesignPrompt(e.target.value)}
                  placeholder="描述音色、性别、气质、语速（例如：成熟慵懒的御姐女声，略带笑意与沙哑质感）"
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <input
                    value={designVoiceName}
                    onChange={(e) => setDesignVoiceName(e.target.value)}
                    placeholder="保存后的声音名称（如：慵懒御姐）"
                    className="flex-1 min-w-[180px] px-3 py-1.5 rounded-xl bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={handleDesignBreezeVoice}
                    disabled={designing}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-accent text-white text-[12.5px] font-medium hover:opacity-95 cursor-pointer disabled:opacity-50"
                  >
                    {designing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>生成音色预览</span>
                  </button>
                </div>
              </div>

              {designPreviews.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-line">
                  <div className="text-[12px] font-medium text-secondary">候选预览（听感满意后点击保存）：</div>
                  {designPreviews.map((pv, i) => (
                    <div
                      key={pv.generatedVoiceId}
                      className="flex flex-wrap items-center gap-3 p-2.5 rounded-xl bg-canvas border border-line"
                    >
                      <span className="text-[12px] font-medium text-ink">方案 {i + 1}</span>
                      <audio
                        controls
                        src={`data:${pv.mediaType};base64,${pv.audioBase64}`}
                        className="h-8 flex-1 min-w-[180px]"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveBreezeDesignPreview(pv)}
                        disabled={savingDesignId === pv.generatedVoiceId}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-[12px] font-medium cursor-pointer disabled:opacity-50"
                      >
                        {savingDesignId === pv.generatedVoiceId ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>{pendingVoiceBindTarget ? '保存并绑定' : '保存到声音库'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {breezeVoices.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-line">
                  <div className="text-[12px] font-medium text-secondary">账号内已有的 Breeze 音色：</div>
                  <div className="flex flex-wrap gap-1.5">
                    {breezeVoices.map((bv) => (
                      <button
                        key={bv.voiceId}
                        type="button"
                        onClick={() => {
                          updateTtsField({ ttsVoice: bv.voiceId });
                          setNewProfileName(bv.name);
                        }}
                        className={`px-2.5 py-1 rounded-lg border text-[12px] cursor-pointer ${
                          draftVoice.ttsVoice === bv.voiceId
                            ? 'border-accent bg-accent-soft text-accent font-medium'
                            : 'border-line bg-canvas text-ink hover:bg-hover'
                        }`}
                      >
                        {bv.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block mb-1 text-[12px] font-medium text-secondary">
                  Breeze Voice ID（直接填入已有音色 ID，或由上方生成后自动填入）
                </label>
                <input
                  value={draftVoice.ttsVoice}
                  onChange={(e) => updateTtsField({ ttsVoice: e.target.value })}
                  placeholder="voice_id..."
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none focus:border-accent"
                />
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-4">
              <div>
                <div className="font-semibold text-ink">
                  2. 选择底色音色与语气表达
                </div>
                {isSiliconFlowActive && (
                  <p className="text-[11.5px] text-amber-500 mt-1">
                    提示：硅基流动的性别与基础音色由「底色音色」决定，「语气指令」仅控制说话情绪（如慵懒/耳语）；点击下方“慵懒御姐”等灵感标签时会自动为您切到对应的女声底色（如 Anna）。
                  </p>
                )}
              </div>

              {/* Builtin Gendered Voices */}
              {TTS_BUILTIN_VOICES[activeTtsProviderId] && (
                <div className="space-y-2.5">
                  {(['female', 'male', 'neutral'] as const).map((gender) => {
                    const group = TTS_BUILTIN_VOICES[activeTtsProviderId].filter(
                      (o) => o.gender === gender
                    );
                    if (group.length === 0) return null;
                    const title =
                      gender === 'female' ? '女声底色' : gender === 'male' ? '男声底色' : '中性底色';
                    return (
                      <div key={gender} className="space-y-1">
                        <div className="text-[11.5px] font-medium text-dim">{title}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.map((opt) => {
                            const fullValue = isSiliconFlowActive
                              ? formatSiliconFlowSystemVoice(draftVoice.ttsModel, opt.id)
                              : opt.id;
                            const isSelected = isSiliconFlowActive
                              ? extractSiliconFlowShortVoice(draftVoice.ttsVoice) === opt.id
                              : draftVoice.ttsVoice.trim() === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => updateTtsField({ ttsVoice: fullValue })}
                                className={`px-2.5 py-1.5 rounded-xl border text-[12px] cursor-pointer transition ${
                                  isSelected
                                    ? 'border-accent bg-accent-soft text-accent font-medium'
                                    : 'border-line bg-canvas text-ink hover:bg-hover'
                                }`}
                                title={opt.styleHint}
                              >
                                {opt.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Inspiration Chips */}
              <div className="space-y-1.5">
                <div className="text-[12px] font-medium text-secondary">快捷人设声线灵感（一键同步底色与语气）</div>
                <div className="flex flex-wrap gap-1.5">
                  {VOICE_INSPIRATION_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => handleApplyInspirationChip(chip)}
                      className="px-2.5 py-1 rounded-full bg-canvas border border-line text-[11.5px] text-secondary hover:border-accent hover:text-accent cursor-pointer"
                    >
                      + {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice ID & Style Instruction */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 text-[12px] font-medium text-secondary">
                    实际发送的 Voice ID / 克隆 URI
                  </label>
                  <input
                    value={draftVoice.ttsVoice}
                    onChange={(e) => updateTtsField({ ttsVoice: e.target.value })}
                    placeholder="如 FunAudioLLM/CosyVoice2-0.5B:anna 或 speech:..."
                    className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-[12px] font-medium text-secondary">
                    语气 / 情感指令（可选，CosyVoice2 与 gpt-4o-mini-tts 支持）
                  </label>
                  <input
                    value={draftVoice.ttsStyleInstruction}
                    onChange={(e) =>
                      setDraftVoice((prev) => ({ ...prev, ttsStyleInstruction: e.target.value }))
                    }
                    placeholder="例如：用慵懒轻柔、略带沙哑气声的语调说"
                    className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink text-[12.5px] outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Rate / Volume / Gain */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="flex justify-between text-[12px] text-secondary mb-1">
                    <span>播放语速</span>
                    <span className="font-mono">{draftVoice.ttsRate.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={draftVoice.ttsRate}
                    onChange={(e) =>
                      setDraftVoice((prev) => ({ ...prev, ttsRate: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[12px] text-secondary mb-1">
                    <span>播放音量</span>
                    <span className="font-mono">{Math.round((draftVoice.ttsVolume ?? 1) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={draftVoice.ttsVolume ?? 1}
                    onChange={(e) =>
                      setDraftVoice((prev) => ({ ...prev, ttsVolume: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[12px] text-secondary mb-1">
                    <span>增益 (dB)</span>
                    <span className="font-mono">{draftVoice.ttsGain}</span>
                  </div>
                  <input
                    type="range"
                    min={-10}
                    max={10}
                    step={1}
                    value={draftVoice.ttsGain}
                    onChange={(e) =>
                      setDraftVoice((prev) => ({ ...prev, ttsGain: parseInt(e.target.value, 10) }))
                    }
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
              </div>

              {/* SiliconFlow Voice Cloning Collapsible */}
              {isSiliconFlowActive && (
                <div className="rounded-xl border border-line bg-canvas/60 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCloneSectionOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-[12.5px] font-medium text-ink hover:bg-hover cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      {cloneSectionOpen ? (
                        <ChevronDown className="w-4 h-4 text-accent" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-dim" />
                      )}
                      <span>参考音频克隆（上传/录制 5~15 秒人声定制专属音色）</span>
                    </span>
                    <span className="text-[11px] text-dim">CosyVoice2</span>
                  </button>

                  {cloneSectionOpen && (
                    <div className="p-3 border-t border-line space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-[12px] text-secondary cursor-pointer">
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
                          className="flex items-center gap-1 text-[12px] text-accent hover:underline cursor-pointer disabled:opacity-50"
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
                              className={`px-2.5 py-1 rounded-lg border text-[12px] cursor-pointer ${
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
                          className="px-3 py-2 rounded-xl bg-sidebar border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                        />
                        <input
                          value={cloneText}
                          onChange={(e) => setCloneText(e.target.value)}
                          placeholder="参考音频里实际念的文字台词（必填）"
                          className="px-3 py-2 rounded-xl bg-sidebar border border-line text-[12.5px] text-ink outline-none focus:border-accent"
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
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-line bg-sidebar text-[12px] text-ink hover:bg-hover cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>上传音频文件</span>
                        </button>
                        <button
                          type="button"
                          onClick={recordingSample ? stopSampleRecording : startSampleRecording}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-[12px] cursor-pointer ${
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
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-accent text-white text-[12.5px] font-medium cursor-pointer disabled:opacity-50"
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
              )}
            </div>
          )}

          {/* Step C: Audition & Save to Voice Library */}
          <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-3">
            <div className="font-semibold text-ink">3. 试听与保存</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                placeholder="输入一段台词用于试听当前音色..."
                className="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handlePreviewDraft}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-line bg-canvas text-[12.5px] text-ink hover:border-accent cursor-pointer"
              >
                {previewingDraft ? (
                  <Square className="w-3.5 h-3.5 text-accent" />
                ) : (
                  <Volume2 className="w-4 h-4 text-accent" />
                )}
                <span>{previewingDraft ? '停止试听' : '试听当前设置'}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line">
              <input
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="给这个声音起个名字（如：慵懒御姐、沉稳旁白...）"
                className="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
              />
              {pendingVoiceBindTarget ? (
                <button
                  type="button"
                  onClick={() => handleSaveToLibrary('bind')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white font-medium hover:opacity-95 cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>保存声音并绑定返回</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleSaveToLibrary('library')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white font-medium hover:opacity-95 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{editingProfileId ? '更新声音库档案' : '保存到我的声音库'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveToLibrary('default')}
                    className="px-3.5 py-2 rounded-xl border border-accent/50 bg-accent-soft text-accent font-medium hover:opacity-90 cursor-pointer"
                  >
                    保存并设为默认
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onSaveVoice({ keepActiveProfile: false })}
                className="px-3 py-2 rounded-xl border border-line text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                title="仅应用下方接口/音色参数作为全局默认（不新增声音库条目）"
              >
                仅保存基础配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 3: Speech-to-Text (STT) */}
      {voiceStudioSubTab === 'stt' && (
        <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-ink">语音输入 (Speech-to-Text / 语音转文字)</div>
              <p className="text-[11.5px] text-dim mt-0.5">
                在聊天输入框点击麦克风即可说话转文字；各语音识别厂商的 API Key 同样独立保存。
              </p>
            </div>
            {activeSttPreset?.consoleUrl && (
              <button
                type="button"
                onClick={() => openExternalUrl(activeSttPreset.consoleUrl).catch(() => {})}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-soft text-accent text-[11.5px] font-medium hover:underline cursor-pointer"
              >
                <span>去官网拿 Key</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => switchSttProvider('native')}
              className={`px-3 py-1.5 rounded-xl border text-[12px] cursor-pointer ${
                activeSttProviderId === 'native'
                  ? 'border-accent bg-accent-soft text-accent font-medium'
                  : 'border-line bg-canvas text-secondary hover:bg-hover'
              }`}
            >
              浏览器原生语音识别
            </button>
            {STT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => switchSttProvider(preset.id)}
                className={`px-3 py-1.5 rounded-xl border text-[12px] cursor-pointer ${
                  activeSttProviderId === preset.id
                    ? 'border-accent bg-accent-soft text-accent font-medium'
                    : 'border-line bg-canvas text-secondary hover:bg-hover'
                }`}
              >
                {preset.name.split('（')[0]}
              </button>
            ))}
          </div>

          {activeSttPreset && <p className="text-[11.5px] text-dim">{activeSttPreset.description}</p>}

          {draftVoice.sttEngine === 'openai_api' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 text-[12px] font-medium text-secondary">
                    STT Base URL
                  </label>
                  <input
                    value={draftVoice.sttBaseUrl}
                    onChange={(e) => updateSttField({ sttBaseUrl: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-[12px] font-medium text-secondary">
                    API Key（{resolvedSttReusableKey ? '留空自动复用同域名 Key' : '当前厂商独立保存'}）
                  </label>
                  <div className="flex items-center rounded-xl bg-canvas border border-line px-3 focus-within:border-accent">
                    <input
                      type={showSttKey ? 'text' : 'password'}
                      value={draftVoice.sttApiKey}
                      onChange={(e) => updateSttField({ sttApiKey: e.target.value })}
                      placeholder={resolvedSttReusableKey ? '已检测到同域名 Key' : 'sk-...'}
                      className="flex-1 py-2 bg-transparent text-ink font-mono text-[12px] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSttKey((v) => !v)}
                      className="p-1 text-dim hover:text-ink cursor-pointer"
                    >
                      {showSttKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[12px] font-medium text-secondary">识别模型 ID</label>
                  <button
                    type="button"
                    onClick={handleRefreshSttModels}
                    disabled={fetchingSttModels}
                    className="flex items-center gap-1 text-[12px] text-accent hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {fetchingSttModels ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>刷新可用模型</span>
                  </button>
                </div>
                <input
                  value={draftVoice.sttModel}
                  onChange={(e) => updateSttField({ sttModel: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none focus:border-accent"
                />
                {availableSttModels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {availableSttModels.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateSttField({ sttModel: m })}
                        className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono cursor-pointer ${
                          draftVoice.sttModel === m
                            ? 'border-accent bg-accent-soft text-accent font-medium'
                            : 'border-line bg-canvas text-secondary hover:bg-hover'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label className="block mb-1 text-[12px] font-medium text-secondary">识别语言</label>
              <select
                value={draftVoice.sttLanguage}
                onChange={(e) => setDraftVoice((prev) => ({ ...prev, sttLanguage: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink text-[12.5px] outline-none focus:border-accent"
              >
                <option value="zh">中文 (zh)</option>
                <option value="en">英文 (en)</option>
                <option value="ja">日文 (ja)</option>
                <option value="">自动识别</option>
              </select>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onSaveVoice({ keepActiveProfile: true })}
                className="px-4 py-2 rounded-xl bg-accent text-white font-medium hover:opacity-95 cursor-pointer"
              >
                保存语音输入配置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
