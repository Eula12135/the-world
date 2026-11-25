import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
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
import { OptionPicker } from '../Common/OptionPicker';
import { useShallow } from 'zustand/react/shallow';
import { pushBackLayer } from '../../utils/backStack';
import { useAppStore } from '../../store/useAppStore';
import type {
  ImageGenConfig,
  MediaProviderCredential,
  ProviderConfig,
  VoiceConfig,
} from '../../types';
import { fetchProviderModels, testProviderConnection } from '../../services/llm';
import { findSttPresetByBaseUrl, findTtsPresetByBaseUrl } from '../../services/voiceService';
import { ImageGenTab } from './ImageGenTab';
import { VoiceStudioTab } from './VoiceStudioTab';
import { createId, isImeComposing, openExternalUrl } from '../../utils/platform';

export const ProvidersModal: React.FC<{ closing?: boolean }> = ({ closing = false }) => {
  const {
    activeModal,
    modalReturnTo,
    setActiveModal,
    closeOrStepBackModal,
    providersModalTab,
    setProvidersModalTab,
    providers,
    settings,
    saveProvider,
    deleteProvider,
    updateSettings,
    requestConfirm,
    showToast,
  } = useAppStore(
    useShallow((s) => ({
      activeModal: s.activeModal,
      modalReturnTo: s.modalReturnTo,
      setActiveModal: s.setActiveModal,
      closeOrStepBackModal: s.closeOrStepBackModal,
      providersModalTab: s.providersModalTab,
      setProvidersModalTab: s.setProvidersModalTab,
      providers: s.providers,
      settings: s.settings,
      saveProvider: s.saveProvider,
      deleteProvider: s.deleteProvider,
      updateSettings: s.updateSettings,
      requestConfirm: s.requestConfirm,
      showToast: s.showToast,
    }))
  );

  const [selectedId, setSelectedId] = useState<string>(() => {
    const preferred = providers.find((p) => p.id === 'deepseek') || providers[0];
    return preferred?.id || 'deepseek';
  });
  const [draft, setDraft] = useState<ProviderConfig | null>(() => {
    const found = providers.find((p) => p.id === 'deepseek') || providers[0];
    return found ? { ...found, models: [...found.models] } : null;
  });
  const [showKey, setShowKey] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showLlmAdvanced, setShowLlmAdvanced] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchedModelQuery, setFetchedModelQuery] = useState('');
  /** 勾选框里的临时选择；点「加入列表」才写回已配置模型 */
  const [pickerSelection, setPickerSelection] = useState<string[]>([]);

  // 选择框本身也是一层：返回键先关它，别把整个配置页关掉
  useEffect(() => {
    if (fetchedModels.length === 0) return;
    return pushBackLayer(() => {
      setFetchedModels([]);
      setPickerSelection([]);
      setStatusMsg(null);
    });
  }, [fetchedModels.length]);

  const [draftImg, setDraftImg] = useState<ImageGenConfig>(() => ({
    ...settings.imageGen,
    providerConfigs: settings.imageGen.providerConfigs
      ? { ...settings.imageGen.providerConfigs }
      : {},
  }));

  const [draftVoice, setDraftVoice] = useState<VoiceConfig>(() => ({
    ...settings.voice,
    ttsProviderConfigs: settings.voice.ttsProviderConfigs
      ? { ...settings.voice.ttsProviderConfigs }
      : {},
    sttProviderConfigs: settings.voice.sttProviderConfigs
      ? { ...settings.voice.sttProviderConfigs }
      : {},
  }));

  const hasReadyKeyProvider = providers.some(
    (p) => p.enabled && p.requiresKey && p.apiKey.trim().length > 0
  );

  useEffect(() => {
    if (activeModal !== 'providers' && !closing) return;
    if (closing) return;
    const found = providers.find((p) => p.id === selectedId) || providers[0];
    if (found) {
      if (found.id !== selectedId) setSelectedId(found.id);
      setDraft({ ...found, models: [...found.models] });
    }
  }, [activeModal, closing, selectedId, providers]);

  useEffect(() => {
    if (closing) return;
    setStatusMsg(null);
    setShowLlmAdvanced(false);
    setFetchedModels([]);
    setFetchedModelQuery('');
    setPickerSelection([]);
  }, [selectedId, closing]);

  useEffect(() => {
    if (activeModal === 'providers' && !closing) {
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
  }, [activeModal, closing, settings.imageGen, settings.voice]);

  if (!draft) return null;

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
      setPickerSelection(draft.models.filter((m) => models.includes(m)));
      setStatusMsg({
        ok: true,
        text: `已拉取 ${models.length} 个可用模型，请选择要加入列表的几个`,
      });
    } catch (err) {
      setStatusMsg({ ok: false, text: err instanceof Error ? err.message : '拉取模型失败' });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleToggleFetchedModel = (modelId: string) => {
    setPickerSelection((prev) =>
      prev.includes(modelId) ? prev.filter((m) => m !== modelId) : [...prev, modelId]
    );
  };

  /** 确认选择：保留不在远程列表里的自定义模型，再把勾选的并进去 */
  const handleConfirmFetchedModels = () => {
    const kept = draft.models.filter((m) => !fetchedModels.includes(m));
    const merged = [...kept, ...pickerSelection];
    const models = merged.length > 0 ? merged : draft.models;
    setDraft({
      ...draft,
      models,
      selectedModel: models.includes(draft.selectedModel) ? draft.selectedModel : models[0],
    });
    setFetchedModels([]);
    setFetchedModelQuery('');
    setPickerSelection([]);
    setStatusMsg({ ok: true, text: '已更新模型列表，记得点「保存配置」生效' });
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
        className={`w-full h-full md:max-w-4xl md:h-[670px] bg-card md:rounded-xl md:border md:border-line md:shadow-2xl flex flex-col overflow-hidden ${
          closing ? 'anim-page-out' : 'anim-page'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2.5 px-3 md:px-5 py-2.5 md:py-3 border-b border-line shrink-0 safe-top">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={closeOrStepBackModal}
                className={`p-1.5 -ml-1 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer ${
                  modalReturnTo === 'settings' ? 'inline-flex items-center gap-0.5' : 'md:hidden'
                }`}
                aria-label={modalReturnTo === 'settings' ? '返回设置' : '返回'}
                title={modalReturnTo === 'settings' ? '返回应用设置' : '返回'}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-[17px] font-semibold text-ink">模型与多模态配置</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 md:flex-initial grid grid-cols-3 md:flex items-center gap-4 border-b border-line">
              <button
                type="button"
                onClick={() => setProvidersModalTab('llm')}
                className={`flex items-center justify-center gap-1 px-2.5 py-1.5 md:py-1 rounded-lg text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  providersModalTab === 'llm'
                    ? 'border-accent text-ink'
                    : 'border-transparent text-secondary hover:text-ink'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>文本模型</span>
              </button>
              <button
                type="button"
                onClick={() => setProvidersModalTab('image')}
                className={`flex items-center justify-center gap-1 px-2.5 py-1.5 md:py-1 rounded-lg text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  providersModalTab === 'image'
                    ? 'border-accent text-ink'
                    : 'border-transparent text-secondary hover:text-ink'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>生图模型</span>
              </button>
              <button
                type="button"
                onClick={() => setProvidersModalTab('voice')}
                className={`flex items-center justify-center gap-1 px-2.5 py-1.5 md:py-1 rounded-lg text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  providersModalTab === 'voice'
                    ? 'border-accent text-ink'
                    : 'border-transparent text-secondary hover:text-ink'
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
          <div key="tab-llm" className="flex-1 flex flex-col min-h-0 anim-subview">
            {!hasReadyKeyProvider && (
              <div className="px-4 md:px-5 py-2.5 bg-accent-soft border-b border-line flex flex-wrap items-center justify-between gap-2 text-[13px] shrink-0">
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
              {/* 手机端：厂商一多横排就滚动、最后一项被裁，改用下拉选择 */}
              <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-line bg-sidebar">
                <div className="min-w-0 flex-1">
                  <OptionPicker
                    value={draft.id}
                    onChange={setSelectedId}
                    items={providers.map((p) => {
                      const ready = !p.requiresKey || p.apiKey.trim().length > 0;
                      return {
                        value: p.id,
                        label: p.name,
                        hint: ready ? '已配置' : '未填 Key',
                      };
                    })}
                  />
                </div>
                <button
                  onClick={handleAddCustomProvider}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-control border border-line text-caption text-secondary hover:border-accent hover:text-accent cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>自定义</span>
                </button>
              </div>

              {/* Provider List（桌面侧栏） */}
              <div className="hidden md:flex md:flex-col md:w-60 shrink-0 md:border-r border-line bg-sidebar md:overflow-y-auto p-2 gap-1">
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
                  className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-[13px] border border-dashed border-line text-secondary hover:border-accent hover:text-accent shrink-0 md:mt-2 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新增自定义端点</span>
                </button>
              </div>

              {/* Config Detail */}
              <div
                key={draft.id}
                className="flex-1 overflow-y-auto p-4 md:p-5 pb-[max(env(safe-area-inset-bottom),20px)] md:pb-5 space-y-4 text-[13px] anim-subview"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[17px] font-semibold text-ink">{draft.name}</h3>
                    <p className="mt-0.5 text-[13px] text-secondary">{draft.description}</p>
                  </div>
                  {draft.consoleUrl && (
                    <button
                      onClick={() => openExternalUrl(draft.consoleUrl)}
                      className="flex items-center gap-1.5 text-body font-medium text-accent-strong hover:underline cursor-pointer shrink-0"
                    >
                      <span>去官网获取 API Key</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Card 1: Basic Connection */}
                <div className="p-3.5 md:p-4 rounded-card border border-line space-y-3">
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
                <div className="p-3.5 md:p-4 rounded-card border border-line space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <label className="font-medium text-ink">
                        已配置模型（默认：<span className="font-mono text-ink">{draft.selectedModel}</span>）
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
                          className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[13px] text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                        >
                          仅保留当前
                        </button>
                      )}
                      {!draft.isCustom && BUILTIN_PROVIDERS.some((p) => p.id === draft.id) && (
                        <button
                          type="button"
                          onClick={handleRestoreDefaultModels}
                          className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[13px] text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                        >
                          恢复默认
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleFetchModels}
                        disabled={fetchingModels}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-canvas text-[13px] text-accent hover:bg-accent-soft cursor-pointer disabled:opacity-50"
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
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer text-[13px] ${
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
                            className="hover:text-danger cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>


                  <div className="flex gap-2">
                    <input
                      value={newModelInput}
                      onChange={(e) => setNewModelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isImeComposing(e)) handleAddModel();
                      }}
                      placeholder="手动添加模型 ID，例如 deepseek-chat"
                      className="flex-1 px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none font-mono text-[13px] focus:border-accent"
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
                <div className="rounded-card border border-line overflow-hidden">
                  {!draft.isCustom && (
                    <button
                      type="button"
                      onClick={() => setShowLlmAdvanced((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-[13px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        {showLlmAdvanced ? (
                          <ChevronDown className="w-4 h-4 text-accent" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-dim" />
                        )}
                        <span>高级接口选项（Base URL / 协议 / 文档）</span>
                      </span>
                      <span className="text-[11.5px] font-mono text-dim truncate max-w-[180px]">
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
                                  className={`py-2 rounded-xl border text-[13px] cursor-pointer ${
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
                          className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none font-mono text-[13px] focus:border-accent"
                        />
                      </div>

                      {!draft.isCustom && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-dim pt-1">
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
                        : 'bg-danger/10 border-danger/35 text-danger'
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
                        className="flex items-center gap-1 px-3 py-2 rounded-xl text-danger border border-danger/30 hover:bg-danger/10 cursor-pointer"
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
                      className="flex items-center gap-1.5 px-4 py-2 rounded-control border border-line text-ink hover:bg-hover cursor-pointer disabled:opacity-50"
                    >
                      {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>测试连通性</span>
                    </button>
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-control text-body font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
                    >
                      保存配置
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Image Generation Models */}
        {providersModalTab === 'image' && (
          <div key="tab-image" className="flex-1 flex flex-col min-h-0 anim-subview">
            <ImageGenTab
              draftImg={draftImg}
              setDraftImg={setDraftImg}
              providers={providers}
              updateSettings={updateSettings}
              showToast={showToast}
            />
          </div>
        )}

        {/* TAB 3: Voice Tuning & Cloning Studio */}
        {providersModalTab === 'voice' && (
          <div key="tab-voice" className="flex-1 flex flex-col min-h-0 anim-subview">
            <VoiceStudioTab
              draftVoice={draftVoice}
              setDraftVoice={setDraftVoice}
              onSaveVoice={handleSaveVoice}
            />
          </div>
        )}
        {/* 从远程可用模型里挑几个加入列表（不直接改已配置列表） */}
        {fetchedModels.length > 0 &&
          typeof document !== 'undefined' &&
          (() => {
            const q = fetchedModelQuery.trim().toLowerCase();
            const filtered = q
              ? fetchedModels.filter((m) => m.toLowerCase().includes(q))
              : fetchedModels;
            const allSelected =
              filtered.length > 0 && filtered.every((m) => pickerSelection.includes(m));
            const keptCount = draft.models.filter((m) => !fetchedModels.includes(m)).length;
            const willRemain = keptCount + pickerSelection.length;

            return createPortal(
              <div
                className="fixed inset-0 z-[80] bg-[#111827]/45 flex items-end md:items-center justify-center p-0 md:p-4 anim-overlay"
                onClick={() => {
                  setFetchedModels([]);
                  setPickerSelection([]);
                }}
              >
                <div
                  className="w-full md:max-w-md max-h-[82vh] bg-card rounded-t-2xl md:rounded-card border border-line flex flex-col overflow-hidden anim-panel"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-4 pt-3 pb-2 border-b border-line">
                    <div className="flex items-center justify-between">
                      <span className="text-title font-semibold text-ink">选择模型</span>
                      <button
                        type="button"
                        onClick={() => {
                          setFetchedModels([]);
                          setPickerSelection([]);
                          setStatusMsg(null);
                        }}
                        className="p-1.5 rounded-control text-dim hover:text-ink hover:bg-hover cursor-pointer"
                        aria-label="关闭"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="mt-1 text-caption text-dim">
                      以下是这个厂商拉到的可用模型，勾选后会加入已配置列表；主界面的下拉只显示已配置的那些。
                    </p>
                  </div>

                  <div className="flex items-center gap-2 px-4 py-2 border-b border-line">
                    <div className="flex flex-1 items-center gap-2 rounded-control border border-line px-2 py-1">
                      <Search className="w-3.5 h-3.5 shrink-0 text-dim" />
                      <input
                        value={fetchedModelQuery}
                        onChange={(e) => setFetchedModelQuery(e.target.value)}
                        placeholder="搜索模型"
                        className="w-full bg-transparent text-body text-ink outline-none placeholder:text-dim"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const target = filtered;
                        setPickerSelection((prev) => {
                          if (allSelected) {
                            return prev.filter((m) => !target.includes(m));
                          }
                          return Array.from(new Set([...prev, ...target]));
                        });
                      }}
                      className="shrink-0 text-body text-accent-strong hover:underline cursor-pointer"
                    >
                      {allSelected ? '取消全选' : '全选'}
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-2 py-1">
                    {filtered.length === 0 ? (
                      <div className="py-8 text-center text-body text-dim">没有匹配的模型</div>
                    ) : (
                      filtered.map((m) => {
                        const checked = pickerSelection.includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => handleToggleFetchedModel(m)}
                            className="flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-hover cursor-pointer"
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                                checked ? 'border-accent bg-accent text-white' : 'border-line'
                              }`}
                            >
                              {checked && <Check className="w-3 h-3" />}
                            </span>
                            <span className="truncate font-mono text-body text-ink" title={m}>
                              {m.replace(/^models\//i, '')}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-line">
                    <span className="text-caption text-dim">
                      {willRemain === 0
                        ? '至少要保留一个模型'
                        : `已选 ${pickerSelection.length} 个`}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFetchedModels([]);
                          setPickerSelection([]);
                          setStatusMsg(null);
                        }}
                        className="px-3.5 py-2 rounded-control border border-line text-body text-ink hover:bg-hover cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmFetchedModels}
                        className="px-4 py-2 rounded-control text-body font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
                      >
                        加入列表
                      </button>
                    </div>
                  </div>
                </div>
              </div>,
              document.body
            );
          })()}

      </div>
  );
};
