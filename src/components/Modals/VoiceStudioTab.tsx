import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Eye,
  EyeOff,
  Library,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Square,
  UserCheck,
  Volume2,
  Wand2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  clearTtsCache,
  deleteTtsCacheBySession,
  getTtsCacheGroups,
  getTtsCacheStats,
  type TtsCacheGroup,
} from '../../services/voice/ttsCache';
import type {
  MediaProviderCredential,
  TtsAutoPlayTarget,
  VoiceConfig,
  VoiceProfile,
} from '../../types';
import { resolveMediaApiKey } from '../../services/imageGenService';
import {
  type BreezeVoiceItem,
  type BreezeVoicePreview,
  deleteRemoteClonedVoice,
  extractSiliconFlowShortVoice,
  fetchTtsModels,
  findTtsPresetByBaseUrl,
  formatSiliconFlowSystemVoice,
  isBreezeCloudBase,
  listNativeVoices,
  pickMatchingBuiltinVoiceForGender,
  type RemoteClonedVoice,
  rewriteSiliconFlowVoiceForModel,
  speakText,
  stopSpeaking,
  TTS_BUILTIN_VOICES,
  TTS_PRESETS,
} from '../../services/voiceService';
import { createId, isProviderReady, openExternalUrl } from '../../utils/platform';
import { generateVoiceDescription } from '../../services/voicePromptService';
import { type InspirationChip, VOICE_INSPIRATION_CHIPS } from './voice/constants';
import { VoiceLibrarySubTab } from './voice/VoiceLibrarySubTab';
import { VoiceSttSubTab } from './voice/VoiceSttSubTab';
import { VoiceBreezeDesignSection } from './voice/VoiceBreezeDesignSection';
import { VoiceCloneSection } from './voice/VoiceCloneSection';

interface VoiceStudioTabProps {
  draftVoice: VoiceConfig;
  setDraftVoice: React.Dispatch<React.SetStateAction<VoiceConfig>>;
  onSaveVoice: (options?: { keepActiveProfile?: boolean }) => Promise<void>;
}

function formatCacheBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const VoiceStudioTab: React.FC<VoiceStudioTabProps> = ({
  draftVoice,
  setDraftVoice,
  onSaveVoice,
}) => {
  const {
    providers,
    characters,
    worlds,
    settings,
    sessions,
    activeSessionId,
    draftConfig,
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
  const [cacheStats, setCacheStats] = useState<{ count: number; bytes: number } | null>(null);
  const [cacheGroups, setCacheGroups] = useState<TtsCacheGroup[]>([]);
  const [cacheManagerOpen, setCacheManagerOpen] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [nativeVoices, setNativeVoices] = useState<SpeechSynthesisVoice[]>(() => listNativeVoices());
  const [styleBriefCharacterId, setStyleBriefCharacterId] = useState(() =>
    pendingVoiceBindTarget?.kind === 'character' ? pendingVoiceBindTarget.characterId : ''
  );
  const [generatingStyleDesc, setGeneratingStyleDesc] = useState(false);

  // Library audition tracking
  const [playingProfileId, setPlayingProfileId] = useState<string | null>(null);
  const [previewingDraft, setPreviewingDraft] = useState(false);
  const [previewText, setPreviewText] = useState('你好，今天想让我用怎样的声音陪你聊天？');

  const [fetchingTtsModels, setFetchingTtsModels] = useState(false);

  // Create/save voice profile form
  const [newProfileName, setNewProfileName] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);

  // Shared across Breeze Design & provider switching / inspiration chips
  const [designPrompt, setDesignPrompt] = useState('');
  const [designPreviews, setDesignPreviews] = useState<BreezeVoicePreview[]>([]);
  const [designVoiceName, setDesignVoiceName] = useState('');
  const [breezeVoices, setBreezeVoices] = useState<BreezeVoiceItem[]>([]);
  const [remoteCloned, setRemoteCloned] = useState<RemoteClonedVoice[]>([]);

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
    if (pendingVoiceBindTarget?.kind === 'character') {
      if (pendingVoiceBindTarget.characterId) {
        setStyleBriefCharacterId(pendingVoiceBindTarget.characterId);
      }
      if (pendingVoiceBindTarget.characterName) {
        setNewProfileName((prev) => prev || `${pendingVoiceBindTarget.characterName} 声线`);
        setDesignVoiceName((prev) => prev || `${pendingVoiceBindTarget.characterName} 声线`);
      }
    }
  }, [pendingVoiceBindTarget]);

  const handleGenerateStyleInstruction = async () => {
    const character = characters.find((c) => c.id === styleBriefCharacterId);
    if (!character) {
      showToast('先选一张角色卡，AI 会按它的设定写语气指令', 'info');
      return;
    }
    const activeSess = activeSessionId
      ? sessions.find((s) => s.id === activeSessionId)
      : undefined;
    const preferredProviderId = activeSess?.providerId || draftConfig.providerId;
    const preferredModel = activeSess?.model || draftConfig.model;
    const readyProviders = providers.filter((p) => p.enabled && isProviderReady(p));
    const provider =
      readyProviders.find((p) => p.id === preferredProviderId) ||
      readyProviders.find((p) => p.id === settings.defaultProviderId) ||
      readyProviders[0] ||
      providers.find((p) => isProviderReady(p));
    if (!provider) {
      showToast('没有已配置 API Key 的可用文本模型，请先在「模型」页填写密钥', 'error');
      return;
    }
    const model =
      (provider.id === preferredProviderId && preferredModel ? preferredModel : '') ||
      provider.selectedModel ||
      provider.models[0];
    setGeneratingStyleDesc(true);
    try {
      const text = await generateVoiceDescription({
        provider,
        model,
        character,
        world: worlds.find((w) => w.id === character.worldId) || null,
      });
      if (!text) {
        showToast('模型没有返回有效的语气描述，请重试', 'error');
        return;
      }
      setDraftVoice((prev) => ({ ...prev, ttsStyleInstruction: text }));
      setDesignPrompt(text);
      showToast('已根据角色卡生成语气指令，可再手动微调', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '生成语气指令失败', 'error');
    } finally {
      setGeneratingStyleDesc(false);
    }
  };

  // Clean up preview playback on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
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

  const handleQuickVoicePatch = async (patch: Partial<VoiceConfig>) => {
    setDraftVoice((prev) => ({ ...prev, ...patch }));
    const savedVoice = useAppStore.getState().settings.voice;
    await updateSettings({ voice: { ...savedVoice, ...patch } });
  };

  const handleClearTtsCache = async () => {
    await clearTtsCache();
    setCacheStats(await getTtsCacheStats());
    setCacheGroups([]);
    setCacheManagerOpen(false);
    showToast('语音缓存已清空', 'success');
  };

  const refreshTtsCache = async () => {
    const [stats, groups] = await Promise.all([getTtsCacheStats(), getTtsCacheGroups()]);
    setCacheStats(stats);
    setCacheGroups(groups);
  };

  const handleToggleCacheManager = async () => {
    if (!cacheManagerOpen) await refreshTtsCache();
    setCacheManagerOpen((v) => !v);
  };

  const handleDeleteCacheGroup = async (sessionId: string | null) => {
    await deleteTtsCacheBySession(sessionId);
    await refreshTtsCache();
    showToast('已删除该场对话的语音缓存', 'success');
  };

  useEffect(() => {
    let alive = true;
    void getTtsCacheStats()
      .then((stats) => {
        if (alive) setCacheStats(stats);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const handleToggleQuickSetting = async (field: 'ttsEnabled' | 'ttsAutoPlay', checked: boolean) => {
    await handleQuickVoicePatch({ [field]: checked } as Partial<VoiceConfig>);
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

  const handleSaveToLibrary = async (mode: 'library' | 'bind') => {
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

    if (mode === 'bind') {
      await onSaveVoice({ keepActiveProfile: true });
      await completePendingVoiceBind(profile.id);
      setEditingProfileId(null);
      setNewProfileName('');
      return;
    }

    // 只有用户勾了「同时设为全局默认」才动全局默认，保存本身不再顺手改
    if (saveAsDefault) {
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
      showToast(`已保存「${profile.name}」并设为全局默认`, 'success');
    } else {
      await onSaveVoice({ keepActiveProfile: true });
      showToast(`已将「${profile.name}」保存到我的声音库`, 'success');
    }

    setEditingProfileId(null);
    setNewProfileName('');
    setVoiceStudioSubTab('library');
  };

  const handleClearDefaultProfile = async () => {
    const nextVoice: VoiceConfig = { ...draftVoice, activeVoiceProfileId: undefined };
    setDraftVoice(nextVoice);
    await updateSettings({ voice: nextVoice });
    showToast('已取消全局默认声音', 'success');
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
            className="px-2.5 py-1 rounded-lg border border-line bg-card text-[13px] text-secondary hover:text-ink cursor-pointer"
          >
            取消绑定模式
          </button>
        </div>
      )}

      {/* Global Quick Voice Switches + Subtab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-sidebar border border-line">
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
            <span>自动朗读</span>
          </label>
          <label
            className={`flex items-center gap-2 text-secondary ${
              draftVoice.ttsAutoPlay ? '' : 'opacity-45'
            }`}
            title="选择自动朗读时读到哪些台词"
          >
            <span className="text-[13px] whitespace-nowrap">朗读范围</span>
            <select
              value={draftVoice.ttsAutoPlayTarget || 'assistant'}
              disabled={!draftVoice.ttsAutoPlay}
              onChange={(e) =>
                void handleQuickVoicePatch({
                  ttsAutoPlayTarget: e.target.value as TtsAutoPlayTarget,
                })
              }
              className="px-2 py-1 rounded-lg bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent disabled:cursor-not-allowed"
            >
              <option value="assistant">只读角色台词</option>
              <option value="user">只读我的台词</option>
              <option value="both">两边都读</option>
            </select>
          </label>
          <label
            className={`flex items-center gap-2 text-secondary ${
              draftVoice.ttsAutoPlay ? '' : 'opacity-45'
            }`}
            title="开启后，换了音色仍会重用旧音频缓存，省额度但播出的是旧音色"
          >
            <input
              type="checkbox"
              checked={Boolean(draftVoice.ttsCacheKeepOldVoice)}
              onChange={(e) =>
                void handleQuickVoicePatch({ ttsCacheKeepOldVoice: e.target.checked })
              }
              className="accent-[var(--accent)]"
            />
            <span className="text-[13px] whitespace-nowrap">换音色后沿用旧语音</span>
          </label>
          {activeDefaultProfile ? (
            <span className="text-[11.5px] px-2.5 py-0.5 rounded-full bg-accent-soft text-accent border border-accent/25">
              当前默认：{activeDefaultProfile.name}
            </span>
          ) : (
            <span
              className="text-[11.5px] px-2.5 py-0.5 rounded-full bg-canvas text-dim border border-line"
              title="未设置全局默认时，没绑定音色的角色不会自动借用别人的声音，朗读会提示先配置"
            >
              当前默认：未设置
            </span>
          )}
          {cacheStats && cacheStats.count > 0 && (
            <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
              <span>
                语音缓存 {cacheStats.count} 条 · {formatCacheBytes(cacheStats.bytes)}
              </span>
              <button
                type="button"
                onClick={() => void handleToggleCacheManager()}
                className="underline hover:text-accent cursor-pointer"
              >
                {cacheManagerOpen ? '收起' : '按对话管理'}
              </button>
              <button
                type="button"
                onClick={() => void handleClearTtsCache()}
                className="underline hover:text-accent cursor-pointer"
              >
                清空
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted border border-line">
          <button
            type="button"
            onClick={() => setVoiceStudioSubTab('library')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer transition ${
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer transition ${
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer transition ${
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

      {cacheManagerOpen && (
        <div className="p-3 rounded-xl bg-sidebar border border-line space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-secondary">
              按对话清理语音缓存
            </span>
            <span className="text-[11.5px] text-dim">
              共 {cacheStats?.count ?? 0} 条 · {formatCacheBytes(cacheStats?.bytes ?? 0)}
            </span>
          </div>
          {cacheGroups.length === 0 ? (
            <p className="text-[11.5px] text-dim">还没有可清理的缓存。</p>
          ) : (
            <div className="rounded-xl border border-line bg-canvas divide-y divide-line overflow-hidden">
              {cacheGroups.map((group) => {
                const sessionTitle = group.sessionId
                  ? sessions.find((s) => s.id === group.sessionId)?.title || '已删除的对话'
                  : '未归属对话（较早的朗读）';
                return (
                  <div
                    key={group.sessionId ?? '__none__'}
                    className="flex items-center justify-between gap-3 px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] text-ink truncate">{sessionTitle}</div>
                      <div className="text-[11.5px] text-dim truncate">
                        {group.count} 条 · {formatCacheBytes(group.bytes)}
                        {group.sample ? ` · ${group.sample.slice(0, 16)}…` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteCacheGroup(group.sessionId)}
                      className="shrink-0 text-[11.5px] text-dim hover:text-red-500 underline cursor-pointer"
                    >
                      删除
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[11.5px] text-dim">
            删除后，对应消息再点「朗读」会重新请求合成（会消耗额度）。
          </p>
        </div>
      )}

      {/* SUBTAB 1: Saved Voice Library */}
      {voiceStudioSubTab === 'library' && (
        <VoiceLibrarySubTab
          draftVoice={draftVoice}
          voiceProfiles={voiceProfiles}
          pendingVoiceBindTarget={pendingVoiceBindTarget}
          previewText={previewText}
          setPreviewText={setPreviewText}
          playingProfileId={playingProfileId}
          onCreateNew={() => {
            setEditingProfileId(null);
            setNewProfileName('');
            setVoiceStudioSubTab('create');
          }}
          onGoToCreate={() => setVoiceStudioSubTab('create')}
          onPlayProfile={handlePlayLibraryProfile}
          onBindProfile={(id) => void completePendingVoiceBind(id)}
          onSetDefaultProfile={handleSetDefaultProfile}
          onClearDefaultProfile={() => void handleClearDefaultProfile()}
          onEditProfile={handleLoadProfileIntoEditor}
          onDeleteProfile={handleDeleteProfile}
        />
      )}

      {/* SUBTAB 2: Create / Edit Voice */}
      {voiceStudioSubTab === 'create' && (
        <div className="space-y-4">
          {editingProfileId && (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[13px] text-ink">
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
          <div className="p-4 rounded-xl bg-sidebar border border-line space-y-3">
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[13px] cursor-pointer transition ${
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
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[13px] cursor-pointer transition ${
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
                    <label className="block mb-1 text-[13px] font-medium text-secondary">
                      TTS Base URL
                    </label>
                    <input
                      value={draftVoice.ttsBaseUrl}
                      onChange={(e) => updateTtsField({ ttsBaseUrl: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[13px] outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-[13px] font-medium text-secondary">
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
                        className="flex-1 py-2 bg-transparent text-ink font-mono text-[13px] outline-none"
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
                    <label className="text-[13px] font-medium text-secondary">
                      语音模型 (Model)
                    </label>
                    <button
                      type="button"
                      onClick={handleRefreshTtsModels}
                      disabled={fetchingTtsModels}
                      className="flex items-center gap-1 text-[13px] text-accent hover:underline cursor-pointer disabled:opacity-50"
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
                    className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[13px] outline-none focus:border-accent"
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
                            className={`px-2 py-0.5 rounded-lg border text-[11.5px] font-mono cursor-pointer ${
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
            <div className="p-4 rounded-xl bg-sidebar border border-line space-y-3">
              <div className="font-semibold text-ink">2. 系统原生音色与语速音调</div>
              <div>
                <label className="block mb-1 text-[13px] font-medium text-secondary">
                  本机可用声音 ({nativeVoices.length})
                </label>
                <select
                  value={draftVoice.ttsNativeVoice}
                  onChange={(e) => setDraftVoice((prev) => ({ ...prev, ttsNativeVoice: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink text-[13px] outline-none focus:border-accent"
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
                  <div className="flex justify-between text-[13px] text-secondary mb-1">
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
                  <div className="flex justify-between text-[13px] text-secondary mb-1">
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
                  <div className="flex justify-between text-[13px] text-secondary mb-1">
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
            <VoiceBreezeDesignSection
              draftVoice={draftVoice}
              setDraftVoice={setDraftVoice}
              previewText={previewText}
              newProfileName={newProfileName}
              setNewProfileName={setNewProfileName}
              designPrompt={designPrompt}
              setDesignPrompt={setDesignPrompt}
              designVoiceName={designVoiceName}
              setDesignVoiceName={setDesignVoiceName}
              designPreviews={designPreviews}
              setDesignPreviews={setDesignPreviews}
              breezeVoices={breezeVoices}
              setBreezeVoices={setBreezeVoices}
              updateTtsField={updateTtsField}
              onApplyInspirationChip={handleApplyInspirationChip}
              buildVoiceProfileFromDraft={buildVoiceProfileFromDraft}
            />
          ) : (
            <div className="p-4 rounded-xl bg-sidebar border border-line space-y-4">
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
                                className={`px-2.5 py-1.5 rounded-xl border text-[13px] cursor-pointer transition ${
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
                <div className="text-[13px] font-medium text-secondary">快捷人设声线灵感（一键同步底色与语气）</div>
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
                  <label className="block mb-1 text-[13px] font-medium text-secondary">
                    实际发送的 Voice ID / 克隆 URI
                  </label>
                  <input
                    value={draftVoice.ttsVoice}
                    onChange={(e) => updateTtsField({ ttsVoice: e.target.value })}
                    placeholder="如 FunAudioLLM/CosyVoice2-0.5B:anna 或 speech:..."
                    className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[13px] outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-[13px] font-medium text-secondary">
                    语气 / 情感指令（可选，CosyVoice2 与 gpt-4o-mini-tts 支持）
                  </label>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <select
                      value={styleBriefCharacterId}
                      onChange={(e) => setStyleBriefCharacterId(e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-canvas border border-line text-[11.5px] text-ink outline-none focus:border-accent"
                    >
                      <option value="">从角色卡生成语气：选择角色…</option>
                      {characters.map((c) => {
                        const w = worlds.find((x) => x.id === c.worldId);
                        return (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {w ? ` · ${w.name}` : ''}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      onClick={handleGenerateStyleInstruction}
                      disabled={generatingStyleDesc || !styleBriefCharacterId}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-accent/40 bg-accent-soft text-accent text-[11.5px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-40 shrink-0"
                    >
                      {generatingStyleDesc ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Wand2 className="w-3 h-3" />
                      )}
                      <span>{generatingStyleDesc ? '生成中…' : 'AI 帮我写'}</span>
                    </button>
                  </div>
                  <input
                    value={draftVoice.ttsStyleInstruction}
                    onChange={(e) =>
                      setDraftVoice((prev) => ({ ...prev, ttsStyleInstruction: e.target.value }))
                    }
                    placeholder="例如：用慵懒轻柔、略带沙哑气声的语调说"
                    className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink text-[13px] outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Rate / Volume / Gain */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="flex justify-between text-[13px] text-secondary mb-1">
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
                  <div className="flex justify-between text-[13px] text-secondary mb-1">
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
                  <div className="flex justify-between text-[13px] text-secondary mb-1">
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
                <VoiceCloneSection
                  draftVoice={draftVoice}
                  setDraftVoice={setDraftVoice}
                  activeTtsProviderId={activeTtsProviderId}
                  remoteCloned={remoteCloned}
                  setRemoteCloned={setRemoteCloned}
                  updateTtsField={updateTtsField}
                  setNewProfileName={setNewProfileName}
                  buildVoiceProfileFromDraft={buildVoiceProfileFromDraft}
                />
              )}
            </div>
          )}

          {/* Step C: Audition & Save to Voice Library */}
          <div className="p-4 rounded-xl bg-sidebar border border-line space-y-3">
            <div className="font-semibold text-ink">3. 试听与保存</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                placeholder="输入一段台词用于试听当前音色..."
                className="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handlePreviewDraft}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-line bg-canvas text-[13px] text-ink hover:border-accent cursor-pointer"
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
                className="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
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
                  <label className="flex items-center gap-1.5 text-[13px] text-secondary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={saveAsDefault}
                      onChange={(e) => setSaveAsDefault(e.target.checked)}
                      className="accent-[var(--accent)]"
                    />
                    <span>同时设为全局默认</span>
                  </label>
                </>
              )}
              <button
                type="button"
                onClick={() => onSaveVoice({ keepActiveProfile: false })}
                className="px-3 py-2 rounded-xl border border-line text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                title="仅应用下方接口/音色参数，不改动全局默认声音"
              >
                仅保存基础配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 3: Speech-to-Text (STT) */}
      {voiceStudioSubTab === 'stt' && (
        <VoiceSttSubTab
          draftVoice={draftVoice}
          setDraftVoice={setDraftVoice}
          onSaveVoice={onSaveVoice}
        />
      )}
    </div>
  );
};
