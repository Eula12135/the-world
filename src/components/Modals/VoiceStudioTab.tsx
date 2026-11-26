import React, { useEffect, useMemo, useState } from 'react';
import { Library, Mic, UserCheck, Wand2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
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
  TTS_PRESETS,
} from '../../services/voiceService';
import { createId, isProviderReady } from '../../utils/platform';
import { generateVoiceDescription } from '../../services/voicePromptService';
import { OptionPicker } from '../Common/OptionPicker';
import { type InspirationChip } from './voice/constants';
import { VoiceCreateSubTab } from './voice/VoiceCreateSubTab';
import { VoiceLibrarySubTab } from './voice/VoiceLibrarySubTab';
import { VoiceSttSubTab } from './voice/VoiceSttSubTab';

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
  } = useAppStore(
    useShallow((s) => ({
      providers: s.providers,
      characters: s.characters,
      worlds: s.worlds,
      settings: s.settings,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      draftConfig: s.draftConfig,
      voiceProfiles: s.voiceProfiles,
      voiceStudioSubTab: s.voiceStudioSubTab,
      setVoiceStudioSubTab: s.setVoiceStudioSubTab,
      pendingVoiceBindTarget: s.pendingVoiceBindTarget,
      clearPendingVoiceBind: s.clearPendingVoiceBind,
      completePendingVoiceBind: s.completePendingVoiceBind,
      upsertVoiceProfile: s.upsertVoiceProfile,
      deleteVoiceProfile: s.deleteVoiceProfile,
      updateSettings: s.updateSettings,
      showToast: s.showToast,
      requestConfirm: s.requestConfirm,
    }))
  );

  const [cacheStats, setCacheStats] = useState<{ count: number; bytes: number } | null>(null);
  const [cacheGroups, setCacheGroups] = useState<TtsCacheGroup[]>([]);
  const [cacheManagerOpen, setCacheManagerOpen] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [nativeVoices, setNativeVoices] = useState<SpeechSynthesisVoice[]>(() => listNativeVoices());
  const [styleBriefCharacterId, setStyleBriefCharacterId] = useState(() =>
    pendingVoiceBindTarget?.kind === 'character' ? pendingVoiceBindTarget.characterId : ''
  );
  const [generatingStyleDesc, setGeneratingStyleDesc] = useState(false);

  const [playingProfileId, setPlayingProfileId] = useState<string | null>(null);
  const [previewingDraft, setPreviewingDraft] = useState(false);
  const [previewText, setPreviewText] = useState('你好，今天想让我用怎样的声音陪你聊天？');

  const [fetchingTtsModels, setFetchingTtsModels] = useState(false);

  const [newProfileName, setNewProfileName] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);

  const [designPrompt, setDesignPrompt] = useState('');
  const [designPreviews, setDesignPreviews] = useState<BreezeVoicePreview[]>([]);
  const [designVoiceName, setDesignVoiceName] = useState('');
  const [breezeVoices, setBreezeVoices] = useState<BreezeVoiceItem[]>([]);
  const [remoteCloned, setRemoteCloned] = useState<RemoteClonedVoice[]>([]);

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

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

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
  }, [
    activeTtsProviderId,
    draftVoice.ttsApiKey,
    draftVoice.ttsBaseUrl,
    draftVoice.ttsProviderConfigs,
    providers,
  ]);

  const activeDefaultProfile = useMemo(
    () =>
      draftVoice.activeVoiceProfileId
        ? voiceProfiles.find((vp) => vp.id === draftVoice.activeVoiceProfileId)
        : undefined,
    [draftVoice.activeVoiceProfileId, voiceProfiles]
  );

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
    sourceText?: string;
    sampleAudio?: string;
    designPrompt?: string;
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
      model:
        draftVoice.ttsEngine === 'openai_api'
          ? opts?.overrideModel || draftVoice.ttsModel.trim()
          : undefined,
      voiceId:
        opts?.overrideVoiceId ??
        (draftVoice.ttsEngine === 'native'
          ? draftVoice.ttsNativeVoice
          : draftVoice.ttsVoice.trim()),
      isCloned:
        opts?.isCloned ?? existing?.isCloned ?? draftVoice.ttsVoice.trim().startsWith('speech:'),
      sourceText: opts?.sourceText ?? existing?.sourceText,
      sampleAudio: opts?.sampleAudio ?? existing?.sampleAudio,
      designPrompt: opts?.designPrompt ?? existing?.designPrompt,
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
      (vp.engine === 'native'
        ? 'native'
        : findTtsPresetByBaseUrl(vp.baseUrl || '')?.id || 'custom_tts');
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
        ttsNativeVoice:
          vp.engine === 'native' ? vp.voiceId || prev.ttsNativeVoice : prev.ttsNativeVoice,
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
            apiKey:
              draftVoice.ttsProviderConfigs?.[vp.providerId || 'siliconflow_tts']?.apiKey ||
              draftVoice.ttsApiKey,
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

      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-sidebar border border-line">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer text-ink font-medium">
            <input
              type="checkbox"
              checked={draftVoice.ttsEnabled}
              onChange={(e) => void handleToggleQuickSetting('ttsEnabled', e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>启用语音朗读</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-secondary">
            <input
              type="checkbox"
              checked={draftVoice.ttsAutoPlay}
              onChange={(e) => void handleToggleQuickSetting('ttsAutoPlay', e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>自动朗读</span>
          </label>
          <div
            className={`flex items-center gap-2 text-secondary ${
              draftVoice.ttsAutoPlay ? '' : 'opacity-50'
            }`}
            title="选择自动朗读时读到哪些台词"
          >
            <span className="text-[13px] whitespace-nowrap">朗读范围</span>
            <div className="w-36">
              <OptionPicker
                compact
                disabled={!draftVoice.ttsAutoPlay}
                value={draftVoice.ttsAutoPlayTarget || 'assistant'}
                items={[
                  { value: 'assistant', label: '只读角色台词' },
                  { value: 'user', label: '只读我的台词' },
                  { value: 'both', label: '两边都读' },
                ]}
                onChange={(val) =>
                  void handleQuickVoicePatch({
                    ttsAutoPlayTarget: val as TtsAutoPlayTarget,
                  })
                }
              />
            </div>
          </div>
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

        <div className="flex items-center gap-4 border-b border-line">
          <button
            type="button"
            onClick={() => setVoiceStudioSubTab('library')}
            className={`flex items-center gap-1.5 px-1.5 py-1.5 -mb-px border-b-2 text-[13px] whitespace-nowrap cursor-pointer transition ${
              voiceStudioSubTab === 'library'
                ? 'border-accent text-ink font-semibold'
                : 'border-transparent text-secondary hover:text-ink font-medium'
            }`}
          >
            <Library className="w-3.5 h-3.5 shrink-0" />
            <span>我的声音库 ({voiceProfiles.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setVoiceStudioSubTab('create')}
            className={`flex items-center gap-1.5 px-1.5 py-1.5 -mb-px border-b-2 text-[13px] whitespace-nowrap cursor-pointer transition ${
              voiceStudioSubTab === 'create'
                ? 'border-accent text-ink font-semibold'
                : 'border-transparent text-secondary hover:text-ink font-medium'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5 shrink-0" />
            <span>{editingProfileId ? '编辑声音' : '制作声音'}</span>
          </button>
          <button
            type="button"
            onClick={() => setVoiceStudioSubTab('stt')}
            className={`flex items-center gap-1.5 px-1.5 py-1.5 -mb-px border-b-2 text-[13px] whitespace-nowrap cursor-pointer transition ${
              voiceStudioSubTab === 'stt'
                ? 'border-accent text-ink font-semibold'
                : 'border-transparent text-secondary hover:text-ink font-medium'
            }`}
          >
            <Mic className="w-3.5 h-3.5 shrink-0" />
            <span>语音输入 (STT)</span>
          </button>
        </div>
      </div>

      {cacheManagerOpen && (
        <div className="p-3 rounded-xl bg-sidebar border border-line space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-secondary">按对话清理语音缓存</span>
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
                      className="shrink-0 text-[11.5px] text-dim hover:text-danger underline cursor-pointer"
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

      {voiceStudioSubTab === 'create' && (
        <VoiceCreateSubTab
          draftVoice={draftVoice}
          setDraftVoice={setDraftVoice}
          activeTtsProviderId={activeTtsProviderId}
          activeTtsPreset={activeTtsPreset}
          isBreezeActive={isBreezeActive}
          isSiliconFlowActive={isSiliconFlowActive}
          availableTtsModels={availableTtsModels}
          resolvedTtsReusableKey={resolvedTtsReusableKey}
          fetchingTtsModels={fetchingTtsModels}
          nativeVoices={nativeVoices}
          characters={characters}
          worlds={worlds}
          providers={providers}
          styleBriefCharacterId={styleBriefCharacterId}
          setStyleBriefCharacterId={setStyleBriefCharacterId}
          generatingStyleDesc={generatingStyleDesc}
          editingProfileId={editingProfileId}
          setEditingProfileId={setEditingProfileId}
          newProfileName={newProfileName}
          setNewProfileName={setNewProfileName}
          saveAsDefault={saveAsDefault}
          setSaveAsDefault={setSaveAsDefault}
          previewText={previewText}
          setPreviewText={setPreviewText}
          previewingDraft={previewingDraft}
          pendingVoiceBindTarget={pendingVoiceBindTarget}
          designPrompt={designPrompt}
          setDesignPrompt={setDesignPrompt}
          designVoiceName={designVoiceName}
          setDesignVoiceName={setDesignVoiceName}
          designPreviews={designPreviews}
          setDesignPreviews={setDesignPreviews}
          breezeVoices={breezeVoices}
          setBreezeVoices={setBreezeVoices}
          remoteCloned={remoteCloned}
          setRemoteCloned={setRemoteCloned}
          switchTtsProvider={switchTtsProvider}
          updateTtsField={updateTtsField}
          onRefreshTtsModels={() => void handleRefreshTtsModels()}
          onGenerateStyleInstruction={() => void handleGenerateStyleInstruction()}
          onApplyInspirationChip={handleApplyInspirationChip}
          onPreviewDraft={() => void handlePreviewDraft()}
          onSaveToLibrary={(mode) => void handleSaveToLibrary(mode)}
          onSaveVoice={onSaveVoice}
          buildVoiceProfileFromDraft={buildVoiceProfileFromDraft}
        />
      )}

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
