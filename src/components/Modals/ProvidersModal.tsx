import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import { BUILTIN_PROVIDERS } from '../../data/providers';
import { IMAGE_FRAMINGS } from '../../utils/imageFraming';
import { useAppStore } from '../../store/useAppStore';
import type {
  ImageGenConfig,
  MediaProviderCredential,
  ProviderConfig,
  VoiceConfig,
} from '../../types';
import { fetchProviderModels, testProviderConnection } from '../../services/llm';
import {
  fetchImageGenModels,
  IMAGE_GEN_PRESETS,
  resolveMediaApiKey,
} from '../../services/imageGenService';
import { findSttPresetByBaseUrl, findTtsPresetByBaseUrl } from '../../services/voiceService';
import { VoiceStudioTab } from './VoiceStudioTab';
import { createId, isImeComposing, openExternalUrl } from '../../utils/platform';

export const ProvidersModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    providersModalTab,
    setProvidersModalTab,
    providers,
    settings,
    saveProvider,
    deleteProvider,
    updateSettings,
    requestConfirm,
    showToast,
  } = useAppStore();

  const [selectedId, setSelectedId] = useState<string>('deepseek');
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchingImgModels, setFetchingImgModels] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showLlmAdvanced, setShowLlmAdvanced] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchedModelQuery, setFetchedModelQuery] = useState('');

  const [draftImg, setDraftImg] = useState<ImageGenConfig>(settings.imageGen);
  const [showImgKey, setShowImgKey] = useState(false);

  const [draftVoice, setDraftVoice] = useState<VoiceConfig>(settings.voice);

  const hasReadyKeyProvider = providers.some(
    (p) => p.enabled && p.requiresKey && p.apiKey.trim().length > 0
  );

  useEffect(() => {
    if (activeModal !== 'providers') return;
    const found = providers.find((p) => p.id === selectedId) || providers[0];
    if (found) {
      setSelectedId(found.id);
      setDraft({ ...found, models: [...found.models] });
    }
  }, [activeModal, selectedId, providers]);

  useEffect(() => {
    setStatusMsg(null);
    setShowLlmAdvanced(false);
    setFetchedModels([]);
    setFetchedModelQuery('');
  }, [activeModal, selectedId]);

  useEffect(() => {
    if (activeModal === 'providers') {
      setDraftImg({
        ...settings.imageGen,
        providerConfigs: settings.imageGen.providerConfigs
          ? { ...settings.imageGen.providerConfigs }
          : {},
      });
      setDraftVoice({
        ...settings.voice,
        ttsProviderConfigs: settings.voice.ttsProviderConfigs
          ? { ...settings.voice.ttsProviderConfigs }
          : {},
        sttProviderConfigs: settings.voice.sttProviderConfigs
          ? { ...settings.voice.sttProviderConfigs }
          : {},
      });
    }
  }, [activeModal, settings.imageGen, settings.voice]);

  if (activeModal !== 'providers' || !draft) return null;

  const activeImgPreset =
    IMAGE_GEN_PRESETS.find((p) => p.id === draftImg.presetId) || IMAGE_GEN_PRESETS[0];

  const handleSave = async () => {
    await saveProvider({
      ...draft,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
    });
    setStatusMsg({ ok: true, text: '配置已安全保存到本机' });
    showToast('API 配置已保存', 'success');
  };

  const handleTest = async () => {
    setTesting(true);
    setStatusMsg(null);
    const cleaned = {
      ...draft,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
    };
    await saveProvider(cleaned);
    const res = await testProviderConnection(cleaned);
    setStatusMsg({ ok: res.ok, text: res.message });
    setTesting(false);
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setStatusMsg(null);
    try {
      const models = await fetchProviderModels({
        ...draft,
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey.trim(),
      });
      setFetchedModels(models);
      setFetchedModelQuery('');
      setStatusMsg({
        ok: true,
        text: `已拉取 ${models.length} 个远程模型，请在下方勾选要加入已配置列表的模型`,
      });
    } catch (err) {
      setStatusMsg({ ok: false, text: err instanceof Error ? err.message : '拉取模型失败' });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleToggleFetchedModel = (modelId: string) => {
    if (draft.models.includes(modelId)) {
      if (draft.models.length <= 1) return;
      const nextModels = draft.models.filter((m) => m !== modelId);
      setDraft({
        ...draft,
        models: nextModels,
        selectedModel: draft.selectedModel === modelId ? nextModels[0] : draft.selectedModel,
      });
    } else {
      setDraft({
        ...draft,
        models: [...draft.models, modelId],
        selectedModel: draft.selectedModel || modelId,
      });
    }
  };

  const handleKeepOnlySelected = () => {
    const target =
      draft.selectedModel && draft.models.includes(draft.selectedModel)
        ? draft.selectedModel
        : draft.models[0];
    if (!target) return;
    setDraft({
      ...draft,
      models: [target],
      selectedModel: target,
    });
  };

  const handleRestoreDefaultModels = () => {
    const builtin = BUILTIN_PROVIDERS.find((p) => p.id === draft.id);
    if (!builtin) return;
    setDraft({
      ...draft,
      models: [...builtin.models],
      selectedModel: builtin.selectedModel,
    });
  };

  const handleAddCustomProvider = async () => {
    const custom: ProviderConfig = {
      id: createId('prov'),
      name: '自定义 OpenAI 兼容端点',
      description: '任意支持 /v1/chat/completions 的第三方网关或本地推理引擎',
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
      models: ['gpt-4o-mini'],
      selectedModel: 'gpt-4o-mini',
      consoleUrl: '',
      docsUrl: '',
      websiteUrl: '',
      requiresKey: true,
      enabled: true,
      isCustom: true,
    };
    await saveProvider(custom);
    setSelectedId(custom.id);
  };

  const handleAddModel = () => {
    const m = newModelInput.trim();
    if (!m || draft.models.includes(m)) return;
    const nextModels = [...draft.models, m];
    setDraft({ ...draft, models: nextModels, selectedModel: m });
    setNewModelInput('');
  };

  const handleDeleteCustom = () => {
    requestConfirm({
      title: '删除自定义厂商',
      message: `确定要删除「${draft.name}」吗？`,
      onConfirm: async () => {
        await deleteProvider(draft.id);
        setSelectedId('deepseek');
        showToast('已删除自定义端点');
      },
    });
  };

  const updateImgField = (patch: Partial<ImageGenConfig>) => {
    setDraftImg((prev) => {
      const pid = prev.presetId || 'zhipu';
      const next = { ...prev, ...patch };
      const existingCred = prev.providerConfigs?.[pid] || {};
      return {
        ...next,
        providerConfigs: {
          ...(prev.providerConfigs || {}),
          [pid]: {
            ...existingCred,
            baseUrl: next.baseUrl,
            apiKey: next.apiKey,
            model: next.model,
          },
        },
      };
    });
  };

  const switchImgPreset = (preset: (typeof IMAGE_GEN_PRESETS)[number]) => {
    setDraftImg((prev) => {
      const curId = prev.presetId || 'zhipu';
      const nextConfigs: Record<string, MediaProviderCredential> = {
        ...(prev.providerConfigs || {}),
        [curId]: {
          ...(prev.providerConfigs?.[curId] || {}),
          baseUrl: prev.baseUrl,
          apiKey: prev.apiKey,
          model: prev.model,
        },
      };
      const saved = nextConfigs[preset.id];
      const nextBaseUrl = saved?.baseUrl ?? preset.baseUrl;
      const nextApiKey = saved?.apiKey ?? '';
      const nextModel = saved?.model ?? preset.defaultModel;
      return {
        ...prev,
        presetId: preset.id,
        baseUrl: nextBaseUrl,
        apiKey: nextApiKey,
        model: nextModel,
        providerConfigs: {
          ...nextConfigs,
          [preset.id]: {
            ...(saved || {}),
            baseUrl: nextBaseUrl,
            apiKey: nextApiKey,
            model: nextModel,
          },
        },
      };
    });
  };

  const handleRefreshImgModels = async () => {
    setFetchingImgModels(true);
    try {
      const pid = draftImg.presetId || 'zhipu';
      const list = await fetchImageGenModels({
        providerId: pid,
        baseUrl: draftImg.baseUrl,
        apiKey: draftImg.apiKey,
        providerConfigs: draftImg.providerConfigs,
        providers,
      });
      const currentModel = draftImg.model.trim();
      const nextModel = list.includes(currentModel) ? currentModel : list[0] || currentModel;
      setDraftImg((prev) => {
        const curCred = prev.providerConfigs?.[pid] || {};
        return {
          ...prev,
          model: nextModel,
          providerConfigs: {
            ...(prev.providerConfigs || {}),
            [pid]: {
              ...curCred,
              baseUrl: prev.baseUrl,
              apiKey: prev.apiKey,
              model: nextModel,
              models: list,
            },
          },
        };
      });
      showToast(`已刷新 ${list.length} 个可用生图模型`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '拉取生图模型失败', 'error');
    } finally {
      setFetchingImgModels(false);
    }
  };

  const handleSaveImageGen = async () => {
    const pid = draftImg.presetId || 'zhipu';
    const nextBaseUrl = draftImg.baseUrl.trim();
    const nextApiKey = draftImg.apiKey.trim();
    const nextModel = draftImg.model.trim();
    const nextConfigs: Record<string, MediaProviderCredential> = {
      ...(draftImg.providerConfigs || {}),
      [pid]: {
        ...(draftImg.providerConfigs?.[pid] || {}),
        baseUrl: nextBaseUrl,
        apiKey: nextApiKey,
        model: nextModel,
      },
    };
    const nextImg: ImageGenConfig = {
      ...draftImg,
      baseUrl: nextBaseUrl,
      apiKey: nextApiKey,
      model: nextModel,
      providerConfigs: nextConfigs,
    };
    setDraftImg(nextImg);
    await updateSettings({ imageGen: nextImg });
    showToast('生图模型配置已保存（各厂商 Key 已独立持久化）', 'success');
  };

  const handleSaveVoice = async (options?: { keepActiveProfile?: boolean }) => {
    const ttsId =
      draftVoice.ttsEngine === 'native'
        ? 'native'
        : draftVoice.ttsProviderId && draftVoice.ttsProviderId !== 'native'
          ? draftVoice.ttsProviderId
          : findTtsPresetByBaseUrl(draftVoice.ttsBaseUrl)?.id || 'custom_tts';
    const sttId =
      draftVoice.sttEngine === 'native'
        ? 'native'
        : draftVoice.sttProviderId && draftVoice.sttProviderId !== 'native'
          ? draftVoice.sttProviderId
          : findSttPresetByBaseUrl(draftVoice.sttBaseUrl)?.id || 'custom_stt';

    const nextTtsConfigs: Record<string, MediaProviderCredential> = {
      ...(draftVoice.ttsProviderConfigs || {}),
    };
    if (ttsId !== 'native') {
      nextTtsConfigs[ttsId] = {
        ...(nextTtsConfigs[ttsId] || {}),
        baseUrl: draftVoice.ttsBaseUrl.trim(),
        apiKey: draftVoice.ttsApiKey.trim(),
        model: draftVoice.ttsModel.trim(),
        defaultVoice: draftVoice.ttsVoice.trim(),
      };
    }

    const nextSttConfigs: Record<string, MediaProviderCredential> = {
      ...(draftVoice.sttProviderConfigs || {}),
    };
    if (sttId !== 'native') {
      nextSttConfigs[sttId] = {
        ...(nextSttConfigs[sttId] || {}),
        baseUrl: draftVoice.sttBaseUrl.trim(),
        apiKey: draftVoice.sttApiKey.trim(),
        model: draftVoice.sttModel.trim(),
      };
    }

    const nextVoice: VoiceConfig = {
      ...draftVoice,
      ttsProviderId: ttsId,
      sttProviderId: sttId,
      ttsBaseUrl: draftVoice.ttsBaseUrl.trim(),
      ttsApiKey: draftVoice.ttsApiKey.trim(),
      ttsModel: draftVoice.ttsModel.trim(),
      ttsVoice: draftVoice.ttsVoice.trim(),
      ttsProviderConfigs: nextTtsConfigs,
      sttBaseUrl: draftVoice.sttBaseUrl.trim(),
      sttApiKey: draftVoice.sttApiKey.trim(),
      sttModel: draftVoice.sttModel.trim(),
      sttProviderConfigs: nextSttConfigs,
      // 保存基础配置不应顺带清掉用户选好的默认声音
      activeVoiceProfileId: draftVoice.activeVoiceProfileId,
    };
    setDraftVoice(nextVoice);
    await updateSettings({ voice: nextVoice });
    if (options?.keepActiveProfile !== true) {
      showToast('语音基础配置已保存', 'success');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-2 md:p-4"
      onClick={() => setActiveModal('none')}
    >
      <div
        className="w-full max-w-4xl h-[90vh] md:h-[670px] rounded-2xl bg-card border border-line shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2.5 px-4 md:px-5 py-3 border-b border-line shrink-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold text-ink">模型与多模态配置</h2>
            <button
              onClick={() => setActiveModal('none')}
              className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer md:hidden"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 md:flex-initial grid grid-cols-3 md:flex items-center gap-1 p-1 rounded-xl bg-muted border border-line">
              <button
                type="button"
                onClick={() => setProvidersModalTab('llm')}
                className={`flex items-center justify-center gap-1 px-2.5 py-1.5 md:py-1 rounded-lg text-[12px] font-medium whitespace-nowrap cursor-pointer ${
                  providersModalTab === 'llm'
                    ? 'bg-card text-accent shadow-xs'
                    : 'text-secondary hover:text-ink'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>文本模型</span>
              </button>
              <button
                type="button"
                onClick={() => setProvidersModalTab('image')}
                className={`flex items-center justify-center gap-1 px-2.5 py-1.5 md:py-1 rounded-lg text-[12px] font-medium whitespace-nowrap cursor-pointer ${
                  providersModalTab === 'image'
                    ? 'bg-card text-accent shadow-xs'
                    : 'text-secondary hover:text-ink'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>生图模型</span>
              </button>
              <button
                type="button"
                onClick={() => setProvidersModalTab('voice')}
                className={`flex items-center justify-center gap-1 px-2.5 py-1.5 md:py-1 rounded-lg text-[12px] font-medium whitespace-nowrap cursor-pointer ${
                  providersModalTab === 'voice'
                    ? 'bg-card text-accent shadow-xs'
                    : 'text-secondary hover:text-ink'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>语音与音色</span>
              </button>
            </div>
            <button
              onClick={() => setActiveModal('none')}
              className="hidden md:block p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* TAB 1: Text LLM Providers */}
        {providersModalTab === 'llm' && (
          <>
            {!hasReadyKeyProvider && (
              <div className="px-4 md:px-5 py-2.5 bg-accent-soft border-b border-line flex flex-wrap items-center justify-between gap-2 text-[12px] shrink-0">
                <div className="flex items-center gap-2 text-ink">
                  <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span>
                    新手上手 3 步：<strong>①</strong> 选一家厂商（推荐 DeepSeek / 硅基流动）→{' '}
                    <strong>②</strong> 点「去官网拿 Key」复制密钥 → <strong>③</strong> 粘贴并测试连通
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelectedId('deepseek')}
                    className="px-2 py-0.5 rounded-md bg-card border border-line text-ink hover:border-accent cursor-pointer"
                  >
                    DeepSeek
                  </button>
                  <button
                    onClick={() => setSelectedId('siliconflow')}
                    className="px-2 py-0.5 rounded-md bg-card border border-line text-ink hover:border-accent cursor-pointer"
                  >
                    硅基流动
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 flex flex-col md:flex-row min-h-0">
              {/* Provider List */}
              <div className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-line bg-sidebar overflow-x-auto md:overflow-y-auto p-2 flex md:flex-col gap-1">
                {providers.map((p) => {
                  const ready = !p.requiresKey || p.apiKey.trim().length > 0;
                  const active = p.id === draft.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[13px] text-left shrink-0 cursor-pointer transition ${
                        active
                          ? 'bg-accent-soft text-accent font-medium'
                          : 'text-ink hover:bg-hover'
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          ready ? 'bg-emerald-500' : 'bg-dim/50'
                        }`}
                        title={ready ? '已配置' : '未填 Key'}
                      />
                    </button>
                  );
                })}

                <button
                  onClick={handleAddCustomProvider}
                  className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-[12px] border border-dashed border-line text-secondary hover:border-accent hover:text-accent shrink-0 md:mt-2 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新增自定义端点</span>
                </button>
              </div>

              {/* Config Detail */}
              <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 text-[13px]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[16px] font-semibold text-ink">{draft.name}</h3>
                    <p className="mt-0.5 text-[12.5px] text-secondary">{draft.description}</p>
                  </div>
                  {draft.consoleUrl && (
                    <button
                      onClick={() => openExternalUrl(draft.consoleUrl)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium bg-accent text-white hover:opacity-95 cursor-pointer shrink-0"
                    >
                      <span>去官网获取 API Key</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Card 1: Basic Connection */}
                <div className="p-3.5 md:p-4 rounded-2xl bg-sidebar border border-line space-y-3">
                  <div>
                    <label className="block mb-1.5 font-medium text-ink">
                      API Key {!draft.requiresKey && '（本地 Ollama 通常无需填写）'}
                    </label>
                    <div className="flex items-center rounded-xl bg-canvas border border-line px-3.5 focus-within:border-accent">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={draft.apiKey}
                        onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                        placeholder={draft.requiresKey ? 'sk-...' : '留空即可'}
                        className="flex-1 py-2 bg-transparent text-ink outline-none font-mono text-[13px]"
                      />
                      <button
                        onClick={() => setShowKey((v) => !v)}
                        className="p-1 text-dim hover:text-ink cursor-pointer"
                        aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                      >
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Card 2: Model Configuration */}
                <div className="p-3.5 md:p-4 rounded-2xl bg-sidebar border border-line space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <label className="font-medium text-ink">
                        已配置模型（默认：<span className="font-mono text-accent">{draft.selectedModel}</span>）
                      </label>
                      <p className="mt-0.5 text-[11.5px] text-dim">
                        主界面下拉框仅显示此处已配置的模型
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {draft.models.length > 1 && (
                        <button
                          type="button"
                          onClick={handleKeepOnlySelected}
                          className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[12px] text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                        >
                          仅保留当前
                        </button>
                      )}
                      {!draft.isCustom && BUILTIN_PROVIDERS.some((p) => p.id === draft.id) && (
                        <button
                          type="button"
                          onClick={handleRestoreDefaultModels}
                          className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[12px] text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                        >
                          恢复默认
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleFetchModels}
                        disabled={fetchingModels}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-canvas text-[12px] text-accent hover:bg-accent-soft cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${fetchingModels ? 'animate-spin' : ''}`} />
                        <span>拉取模型</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {draft.models.map((m) => (
                      <div
                        key={m}
                        onClick={() => setDraft({ ...draft, selectedModel: m })}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer text-[12px] ${
                          draft.selectedModel === m
                            ? 'bg-accent-soft border-accent text-accent font-medium'
                            : 'bg-canvas border-line text-secondary hover:bg-hover'
                        }`}
                      >
                        <span className="font-mono">{m}</span>
                        {draft.models.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextModels = draft.models.filter((x) => x !== m);
                              setDraft({
                                ...draft,
                                models: nextModels,
                                selectedModel:
                                  draft.selectedModel === m ? nextModels[0] : draft.selectedModel,
                              });
                            }}
                            className="hover:text-red-500 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {fetchedModels.length > 0 &&
                    (() => {
                      const q = fetchedModelQuery.trim().toLowerCase();
                      const filteredFetched = q
                        ? fetchedModels.filter((m) => m.toLowerCase().includes(q))
                        : fetchedModels;
                      const selectedFetchedCount = fetchedModels.filter((m) =>
                        draft.models.includes(m)
                      ).length;

                      return (
                        <div className="p-3 rounded-xl bg-canvas border border-line space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12px] font-medium text-ink">
                              远程可用模型（已选 {selectedFetchedCount} / 共 {fetchedModels.length}）
                            </span>
                            <button
                              type="button"
                              onClick={() => setFetchedModels([])}
                              className="text-[11.5px] text-secondary hover:text-ink cursor-pointer"
                            >
                              收起
                            </button>
                          </div>

                          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-sidebar border border-line focus-within:border-accent">
                            <Search className="w-3.5 h-3.5 text-dim shrink-0" />
                            <input
                              value={fetchedModelQuery}
                              onChange={(e) => setFetchedModelQuery(e.target.value)}
                              placeholder="搜索拉取的模型 ID..."
                              className="w-full bg-transparent text-[12px] font-mono text-ink outline-none placeholder:text-dim"
                            />
                          </div>

                          <div className="max-h-52 overflow-y-auto space-y-1 pr-0.5">
                            {filteredFetched.length === 0 ? (
                              <div className="py-4 text-center text-[12px] text-dim">
                                没有匹配的远程模型
                              </div>
                            ) : (
                              filteredFetched.map((m) => {
                                const checked = draft.models.includes(m);
                                const disabledRemove = checked && draft.models.length <= 1;
                                return (
                                  <button
                                    key={m}
                                    type="button"
                                    disabled={disabledRemove}
                                    onClick={() => handleToggleFetchedModel(m)}
                                    title={disabledRemove ? '至少保留一个已配置模型' : undefined}
                                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-left transition ${
                                      checked
                                        ? 'bg-accent-soft text-accent font-medium'
                                        : 'text-ink hover:bg-hover'
                                    } ${disabledRemove ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                                  >
                                    <span className="truncate font-mono">{m}</span>
                                    {checked && <Check className="w-3.5 h-3.5 shrink-0" />}
                                  </button>
                                );
                              })
                            )}
                          </div>

                          <p className="text-[11px] text-dim">
                            勾选后请点击下方「保存配置」生效（至少保留 1 个已配置模型）。
                          </p>
                        </div>
                      );
                    })()}

                  <div className="flex gap-2">
                    <input
                      value={newModelInput}
                      onChange={(e) => setNewModelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isImeComposing(e)) handleAddModel();
                      }}
                      placeholder="手动添加模型 ID，例如 deepseek-chat"
                      className="flex-1 px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none font-mono text-[12.5px] focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={handleAddModel}
                      className="px-3.5 py-2 rounded-xl border border-line bg-canvas text-secondary hover:bg-hover cursor-pointer"
                    >
                      添加
                    </button>
                  </div>
                </div>

                {/* Card 3: Collapsible Advanced Endpoint Options */}
                <div className="rounded-2xl bg-sidebar border border-line overflow-hidden">
                  {!draft.isCustom && (
                    <button
                      type="button"
                      onClick={() => setShowLlmAdvanced((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-[12.5px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        {showLlmAdvanced ? (
                          <ChevronDown className="w-4 h-4 text-accent" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-dim" />
                        )}
                        <span>高级接口选项（Base URL / 协议 / 文档）</span>
                      </span>
                      <span className="text-[11px] font-mono text-dim truncate max-w-[180px]">
                        {draft.baseUrl}
                      </span>
                    </button>
                  )}

                  {(draft.isCustom || showLlmAdvanced) && (
                    <div
                      className={`p-3.5 md:p-4 space-y-3 ${
                        !draft.isCustom ? 'border-t border-line' : ''
                      }`}
                    >
                      {draft.isCustom && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block mb-1.5 font-medium text-secondary">厂商显示名称</label>
                            <input
                              value={draft.name}
                              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                              className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="block mb-1.5 font-medium text-secondary">接口协议</label>
                            <div className="grid grid-cols-2 gap-2">
                              {(
                                [
                                  { id: 'openai', label: 'OpenAI 兼容' },
                                  { id: 'anthropic', label: 'Anthropic 原生' },
                                ] as const
                              ).map((proto) => (
                                <button
                                  key={proto.id}
                                  type="button"
                                  onClick={() => setDraft({ ...draft, protocol: proto.id })}
                                  className={`py-2 rounded-xl border text-[12px] cursor-pointer ${
                                    draft.protocol === proto.id
                                      ? 'bg-accent-soft border-accent text-accent font-medium'
                                      : 'border-line text-secondary'
                                  }`}
                                >
                                  {proto.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block mb-1.5 font-medium text-secondary">API Base URL</label>
                        <input
                          value={draft.baseUrl}
                          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                          placeholder="https://api.deepseek.com/v1"
                          className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none font-mono text-[12.5px] focus:border-accent"
                        />
                      </div>

                      {!draft.isCustom && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-dim pt-1">
                          <span>协议：{draft.protocol === 'anthropic' ? 'Anthropic 原生' : 'OpenAI 兼容'}</span>
                          {draft.docsUrl && (
                            <button
                              type="button"
                              onClick={() => openExternalUrl(draft.docsUrl)}
                              className="flex items-center gap-1 text-accent hover:underline cursor-pointer"
                            >
                              <span>查看官方 API 文档</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {statusMsg && (
                  <div
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-[13px] ${
                      statusMsg.ok
                        ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-500'
                        : 'bg-red-500/10 border-red-500/35 text-red-500'
                    }`}
                  >
                    {statusMsg.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{statusMsg.text}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <div>
                    {draft.isCustom && (
                      <button
                        onClick={handleDeleteCustom}
                        className="flex items-center gap-1 px-3 py-2 rounded-xl text-red-500 border border-red-500/30 hover:bg-red-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>删除此端点</span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleTest}
                      disabled={testing}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-line text-ink hover:bg-hover cursor-pointer disabled:opacity-50"
                    >
                      {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>测试连通性</span>
                    </button>
                    <button
                      onClick={handleSave}
                      className="px-4 py-2 rounded-xl font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
                    >
                      保存配置
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* TAB 2: Image Generation Models */}
        {providersModalTab === 'image' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 text-[13px]">
            <div className="p-3.5 rounded-xl bg-accent-soft border border-accent/25 text-[12px] text-ink">
              支持所有兼容 OpenAI <code className="font-mono">/v1/images/generations</code>{' '}
              协议的生图服务。各厂商 API Key 独立保存、切换互不覆盖；生成后的角色图会压缩并直接存放在本机。
            </div>

            <div className="space-y-2">
              <div className="font-medium text-secondary">选择生图厂商（切换不丢失其他厂商 Key）</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {IMAGE_GEN_PRESETS.map((preset) => {
                  const active = draftImg.presetId === preset.id;
                  const cred = draftImg.providerConfigs?.[preset.id];
                  const hasCred = Boolean(
                    cred?.apiKey?.trim() ||
                      resolveMediaApiKey({
                        providerId: preset.id,
                        baseUrl: cred?.baseUrl || preset.baseUrl,
                        explicitKey: cred?.apiKey || '',
                        providerConfigs: draftImg.providerConfigs,
                        providers,
                      })
                  );
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => switchImgPreset(preset)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                        active ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{preset.name}</span>
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            hasCred ? 'bg-emerald-500' : 'bg-line'
                          }`}
                          title={hasCred ? '已配置密钥或可复用同域 Key' : '未配置密钥'}
                        />
                      </div>
                      <div className="text-[11.5px] text-dim mt-1">{preset.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-secondary">
                {resolveMediaApiKey({
                  providerId: draftImg.presetId,
                  baseUrl: draftImg.baseUrl,
                  explicitKey: '',
                  providerConfigs: draftImg.providerConfigs,
                  providers,
                }) && !draftImg.apiKey.trim()
                  ? '已检测到「文本模型」中的同域名 Key，下方留空即可自动复用。'
                  : '各家生图厂商密钥独立存储在对应卡片中；留空时会自动检查同域名文本 Key。'}
              </span>
              {activeImgPreset.consoleUrl && (
                <button
                  type="button"
                  onClick={() => openExternalUrl(activeImgPreset.consoleUrl).catch(() => {})}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent text-white text-[12px] font-medium cursor-pointer"
                >
                  <span>去官网拿 Key</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block mb-1.5 font-medium text-secondary">生图 Base URL</label>
                <input
                  value={draftImg.baseUrl}
                  onChange={(e) => updateImgField({ baseUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12.5px] outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-secondary">
                  API Key（当前厂商独立保存，留空可复用同域 Key）
                </label>
                <div className="flex items-center rounded-xl bg-canvas border border-line px-3 focus-within:border-accent">
                  <input
                    type={showImgKey ? 'text' : 'password'}
                    value={draftImg.apiKey}
                    onChange={(e) => updateImgField({ apiKey: e.target.value })}
                    placeholder="sk-... 或留空自动复用"
                    className="flex-1 py-2 bg-transparent text-ink font-mono text-[12.5px] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowImgKey((v) => !v)}
                    className="p-1 text-dim hover:text-ink cursor-pointer"
                  >
                    {showImgKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-medium text-secondary">生图模型 ID</label>
                  <button
                    type="button"
                    onClick={handleRefreshImgModels}
                    disabled={fetchingImgModels}
                    className="flex items-center gap-1 text-[12px] text-accent hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {fetchingImgModels ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>刷新可用模型</span>
                  </button>
                </div>
                <input
                  value={draftImg.model}
                  onChange={(e) => updateImgField({ model: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12.5px] outline-none focus:border-accent"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Array.from(
                    new Set([
                      ...(draftImg.providerConfigs?.[draftImg.presetId]?.models || []),
                      ...activeImgPreset.models,
                    ])
                  ).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateImgField({ model: m })}
                      className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono cursor-pointer ${
                        draftImg.model === m
                          ? 'border-accent bg-accent-soft text-accent font-medium'
                          : 'border-line text-dim hover:bg-hover'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-secondary">
                  分辨率尺寸（决定取景与构图）
                </label>
                <select
                  value={draftImg.size}
                  onChange={(e) => setDraftImg({ ...draftImg, size: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
                >
                  {IMAGE_FRAMINGS.map((framing) => (
                    <option key={framing.id} value={framing.size}>
                      {framing.size}（{framing.label}）
                    </option>
                  ))}
                  {draftImg.size && !IMAGE_FRAMINGS.some((f) => f.size === draftImg.size) && (
                    <option value={draftImg.size}>{draftImg.size}（自定义尺寸）</option>
                  )}
                </select>
                <p className="mt-1.5 text-[11.5px] text-dim">
                  头像只画头肩、半身到膝盖、横版带背景 —— 取景会写进内置提示词，
                  避免选了头像却画出全身像。
                </p>
              </div>
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">
                默认画风提示词缀（可选，生成角色图时自动附带）
              </label>
              <input
                value={draftImg.styleHint}
                onChange={(e) => setDraftImg({ ...draftImg, styleHint: e.target.value })}
                placeholder="例如：国风工笔厚涂插画，电影级光影，高质量细节"
                className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
              />
            </div>

            <div className="flex justify-end pt-3 border-t border-line">
              <button
                type="button"
                onClick={handleSaveImageGen}
                className="px-4 py-2 rounded-xl font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
              >
                保存生图配置
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: Voice Tuning & Cloning Studio */}
        {providersModalTab === 'voice' && (
          <VoiceStudioTab
            draftVoice={draftVoice}
            setDraftVoice={setDraftVoice}
            onSaveVoice={handleSaveVoice}
          />
        )}
      </div>
    </div>
  );
};
