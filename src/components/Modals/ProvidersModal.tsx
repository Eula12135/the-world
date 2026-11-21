import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ImageGenConfig, ProviderConfig, VoiceConfig } from '../../types';
import { fetchProviderModels, testProviderConnection } from '../../services/llm';
import { IMAGE_GEN_PRESETS } from '../../services/imageGenService';
import {
  listNativeVoices,
  speakText,
  stopSpeaking,
  STT_PRESETS,
  TTS_PRESETS,
} from '../../services/voiceService';
import { createId, openExternalUrl } from '../../utils/platform';

type ProviderModalTab = 'llm' | 'image' | 'voice';

export const ProvidersModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    providers,
    settings,
    saveProvider,
    deleteProvider,
    updateSettings,
    requestConfirm,
    showToast,
  } = useAppStore();

  const [tab, setTab] = useState<ProviderModalTab>('llm');
  const [selectedId, setSelectedId] = useState<string>('deepseek');
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [draftImg, setDraftImg] = useState<ImageGenConfig>(settings.imageGen);
  const [showImgKey, setShowImgKey] = useState(false);

  const [draftVoice, setDraftVoice] = useState<VoiceConfig>(settings.voice);
  const [showVoiceKey, setShowVoiceKey] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);

  useEffect(() => {
    if (activeModal !== 'providers') return;
    const found = providers.find((p) => p.id === selectedId) || providers[0];
    if (found) {
      setSelectedId(found.id);
      setDraft({ ...found, models: [...found.models] });
      setStatusMsg(null);
    }
  }, [activeModal, selectedId, providers]);

  useEffect(() => {
    if (activeModal === 'providers') {
      setDraftImg({ ...settings.imageGen });
      setDraftVoice({ ...settings.voice });
    }
  }, [activeModal, settings.imageGen, settings.voice]);

  if (activeModal !== 'providers' || !draft) return null;

  const activeImgPreset =
    IMAGE_GEN_PRESETS.find((p) => p.id === draftImg.presetId) || IMAGE_GEN_PRESETS[0];
  const nativeVoices = listNativeVoices();

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
      const next: ProviderConfig = {
        ...draft,
        models,
        selectedModel: models.includes(draft.selectedModel) ? draft.selectedModel : models[0],
      };
      setDraft(next);
      await saveProvider(next);
      setStatusMsg({ ok: true, text: `成功拉取 ${models.length} 个可用模型` });
    } catch (err) {
      setStatusMsg({ ok: false, text: err instanceof Error ? err.message : '拉取模型失败' });
    } finally {
      setFetchingModels(false);
    }
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

  const handleSaveImageGen = async () => {
    await updateSettings({
      imageGen: {
        ...draftImg,
        baseUrl: draftImg.baseUrl.trim(),
        apiKey: draftImg.apiKey.trim(),
        model: draftImg.model.trim(),
      },
    });
    showToast('生图模型配置已保存', 'success');
  };

  const handleSaveVoice = async () => {
    await updateSettings({
      voice: {
        ...draftVoice,
        ttsBaseUrl: draftVoice.ttsBaseUrl.trim(),
        ttsApiKey: draftVoice.ttsApiKey.trim(),
        ttsModel: draftVoice.ttsModel.trim(),
        ttsVoice: draftVoice.ttsVoice.trim(),
        sttBaseUrl: draftVoice.sttBaseUrl.trim(),
        sttApiKey: draftVoice.sttApiKey.trim(),
        sttModel: draftVoice.sttModel.trim(),
      },
    });
    showToast('语音 TTS / STT 配置已保存', 'success');
  };

  const handlePreviewTts = async () => {
    if (previewingVoice) {
      stopSpeaking();
      setPreviewingVoice(false);
      return;
    }
    setPreviewingVoice(true);
    await speakText({
      text: '你好，欢迎使用 The World 本地语音框架，当前配置工作正常。',
      config: draftVoice,
      providers,
      onEnd: () => setPreviewingVoice(false),
      onError: (msg) => {
        setPreviewingVoice(false);
        showToast(msg, 'error');
      },
    });
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-line shrink-0">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">模型中心与多模态接口</h2>
            <p className="text-[12px] text-dim">
              直连官方/自定义接口（桌面端使用系统密钥库加密存储，绝不经过第三方中转）
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-muted border border-line">
              <button
                type="button"
                onClick={() => setTab('llm')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium whitespace-nowrap cursor-pointer ${
                  tab === 'llm' ? 'bg-card text-accent shadow-xs' : 'text-secondary hover:text-ink'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>文本模型</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('image')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium whitespace-nowrap cursor-pointer ${
                  tab === 'image' ? 'bg-card text-accent shadow-xs' : 'text-secondary hover:text-ink'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>生图模型</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('voice')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium whitespace-nowrap cursor-pointer ${
                  tab === 'voice' ? 'bg-card text-accent shadow-xs' : 'text-secondary hover:text-ink'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>语音 (TTS/STT)</span>
              </button>
            </div>
            <button
              onClick={() => setActiveModal('none')}
              className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* TAB 1: Text LLM Providers */}
        {tab === 'llm' && (
          <>
            <div className="px-5 py-2.5 bg-accent-soft border-b border-line flex flex-wrap items-center justify-between gap-2 text-[12px] shrink-0">
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

            <div className="flex-1 flex flex-col md:flex-row min-h-0">
              {/* Provider List */}
              <div className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-line bg-sidebar overflow-x-auto md:overflow-y-auto p-2.5 flex md:flex-col gap-1">
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
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 text-[13px]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[16px] font-semibold text-ink">{draft.name}</h3>
                    <p className="mt-0.5 text-[13px] text-secondary">{draft.description}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {draft.consoleUrl && (
                      <button
                        onClick={() => openExternalUrl(draft.consoleUrl)}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
                      >
                        <span>去官网获取 API Key</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {draft.docsUrl && (
                      <button
                        onClick={() => openExternalUrl(draft.docsUrl)}
                        className="flex items-center gap-1 px-3 py-2 rounded-xl text-[12px] border border-line text-secondary hover:bg-hover cursor-pointer"
                      >
                        <span>API 文档</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

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
                    className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-ink outline-none font-mono text-[13px] focus:border-accent"
                  />
                </div>

                <div>
                  <label className="block mb-1.5 font-medium text-secondary">
                    API Key {!draft.requiresKey && '（本地 Ollama 通常无需填写）'}
                  </label>
                  <div className="flex items-center rounded-xl bg-canvas border border-line px-3.5 focus-within:border-accent">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={draft.apiKey}
                      onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                      placeholder={draft.requiresKey ? 'sk-...' : '留空即可'}
                      className="flex-1 py-2.5 bg-transparent text-ink outline-none font-mono text-[13px]"
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

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-secondary">
                      可用模型（默认：{draft.selectedModel}）
                    </label>
                    <button
                      onClick={handleFetchModels}
                      disabled={fetchingModels}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line text-[12px] text-accent hover:bg-accent-soft cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${fetchingModels ? 'animate-spin' : ''}`} />
                      <span>从服务器拉取模型</span>
                    </button>
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

                  <div className="flex gap-2">
                    <input
                      value={newModelInput}
                      onChange={(e) => setNewModelInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                      placeholder="手动添加模型 ID，例如 deepseek-chat"
                      className="flex-1 px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none font-mono text-[12.5px] focus:border-accent"
                    />
                    <button
                      onClick={handleAddModel}
                      className="px-3.5 py-2 rounded-xl border border-line text-secondary hover:bg-hover cursor-pointer"
                    >
                      添加
                    </button>
                  </div>
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

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-line">
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
        {tab === 'image' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 text-[13px]">
            <div className="p-3.5 rounded-xl bg-accent-soft border border-accent/25 text-[12px] text-ink">
              支持所有兼容 OpenAI <code className="font-mono">/v1/images/generations</code>{' '}
              协议的生图服务。生成后的角色图会压缩并直接存放在本机 IndexedDB（不依赖外链长期有效）。
            </div>

            <div className="space-y-2">
              <div className="font-medium text-secondary">选择生图厂商预设</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {IMAGE_GEN_PRESETS.map((preset) => {
                  const active = draftImg.presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setDraftImg({
                          ...draftImg,
                          presetId: preset.id,
                          baseUrl: preset.baseUrl,
                          model: preset.defaultModel,
                        })
                      }
                      className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                        active ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover'
                      }`}
                    >
                      <div className="font-semibold text-ink">{preset.name}</div>
                      <div className="text-[11.5px] text-dim mt-1">{preset.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-secondary">
                若你在「文本模型」中已填写同厂商的 Key，下方 API Key 可留空自动复用。
              </span>
              {activeImgPreset.consoleUrl && (
                <button
                  type="button"
                  onClick={() => openExternalUrl(activeImgPreset.consoleUrl)}
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
                  onChange={(e) => setDraftImg({ ...draftImg, baseUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12.5px] outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-secondary">
                  API Key（留空则自动复用同域名文本 Key）
                </label>
                <div className="flex items-center rounded-xl bg-canvas border border-line px-3 focus-within:border-accent">
                  <input
                    type={showImgKey ? 'text' : 'password'}
                    value={draftImg.apiKey}
                    onChange={(e) => setDraftImg({ ...draftImg, apiKey: e.target.value })}
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
                <label className="block mb-1.5 font-medium text-secondary">生图模型 ID</label>
                <input
                  value={draftImg.model}
                  onChange={(e) => setDraftImg({ ...draftImg, model: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[12.5px] outline-none focus:border-accent"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {activeImgPreset.models.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDraftImg({ ...draftImg, model: m })}
                      className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono cursor-pointer ${
                        draftImg.model === m
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line text-dim hover:bg-hover'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-secondary">分辨率尺寸</label>
                <select
                  value={draftImg.size}
                  onChange={(e) => setDraftImg({ ...draftImg, size: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
                >
                  <option value="1024x1024">1024x1024（正方形头像）</option>
                  <option value="768x1024">768x1024（竖版半身立绘）</option>
                  <option value="1024x768">1024x768（横版场景）</option>
                </select>
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

        {/* TAB 3: Voice TTS / STT */}
        {tab === 'voice' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 text-[13px]">
            {/* TTS Section */}
            <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-ink text-[14px]">
                  <Volume2 className="w-4 h-4 text-accent" />
                  <span>AI 语音朗读 (TTS)</span>
                </div>
                <div className="flex items-center gap-3 text-[12px]">
                  <label className="flex items-center gap-1.5 cursor-pointer text-secondary">
                    <input
                      type="checkbox"
                      checked={draftVoice.ttsEnabled}
                      onChange={(e) =>
                        setDraftVoice({ ...draftVoice, ttsEnabled: e.target.checked })
                      }
                    />
                    <span>显示朗读按钮</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-secondary">
                    <input
                      type="checkbox"
                      checked={draftVoice.ttsAutoPlay}
                      onChange={(e) =>
                        setDraftVoice({ ...draftVoice, ttsAutoPlay: e.target.checked })
                      }
                    />
                    <span>回复完自动朗读</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDraftVoice({ ...draftVoice, ttsEngine: 'native' })}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer ${
                    draftVoice.ttsEngine === 'native'
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-canvas'
                  }`}
                >
                  <div className="font-semibold text-ink">系统原生语音（完全免费离线）</div>
                  <div className="text-[11px] text-dim mt-0.5">
                    手机调用 Android TextToSpeech，电脑调用系统自带微软语音库，零成本无 Key
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDraftVoice({ ...draftVoice, ttsEngine: 'openai_api' })}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer ${
                    draftVoice.ttsEngine === 'openai_api'
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-canvas'
                  }`}
                >
                  <div className="font-semibold text-ink">自定义 TTS API（高拟真）</div>
                  <div className="text-[11px] text-dim mt-0.5">
                    接入硅基流动 CosyVoice2、OpenAI 或本地 GPT-SoVITS / Kokoro 服务
                  </div>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <div>
                  <label className="block mb-1 text-[12px] text-secondary">
                    语速调节 ({draftVoice.ttsRate.toFixed(1)}x)
                  </label>
                  <input
                    type="range"
                    min={0.6}
                    max={1.8}
                    step={0.1}
                    value={draftVoice.ttsRate}
                    onChange={(e) =>
                      setDraftVoice({ ...draftVoice, ttsRate: Number(e.target.value) })
                    }
                    className="w-full accent-[#4d6bfe]"
                  />
                </div>
                {draftVoice.ttsEngine === 'native' && nativeVoices.length > 0 && (
                  <div>
                    <label className="block mb-1 text-[12px] text-secondary">
                      系统语音包（桌面/Web 可选）
                    </label>
                    <select
                      value={draftVoice.ttsNativeVoice}
                      onChange={(e) =>
                        setDraftVoice({ ...draftVoice, ttsNativeVoice: e.target.value })
                      }
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
              </div>

              {draftVoice.ttsEngine === 'openai_api' && (
                <div className="space-y-3 pt-2 border-t border-line">
                  <div className="flex flex-wrap gap-1.5">
                    {TTS_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          setDraftVoice({
                            ...draftVoice,
                            ttsBaseUrl: p.baseUrl,
                            ttsModel: p.model,
                            ttsVoice: p.defaultVoice,
                          })
                        }
                        className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[11.5px] text-secondary hover:border-accent hover:text-accent cursor-pointer"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">TTS Base URL</label>
                      <input
                        value={draftVoice.ttsBaseUrl}
                        onChange={(e) =>
                          setDraftVoice({ ...draftVoice, ttsBaseUrl: e.target.value })
                        }
                        className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">
                        TTS API Key（可留空复用同域名 Key）
                      </label>
                      <div className="flex items-center rounded-xl bg-canvas border border-line px-3">
                        <input
                          type={showVoiceKey ? 'text' : 'password'}
                          value={draftVoice.ttsApiKey}
                          onChange={(e) =>
                            setDraftVoice({ ...draftVoice, ttsApiKey: e.target.value })
                          }
                          placeholder="留空自动复用"
                          className="flex-1 py-1.5 bg-transparent text-ink font-mono text-[12px] outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowVoiceKey((v) => !v)}
                          className="p-1 text-dim cursor-pointer"
                        >
                          {showVoiceKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">TTS 模型 ID</label>
                      <input
                        value={draftVoice.ttsModel}
                        onChange={(e) => setDraftVoice({ ...draftVoice, ttsModel: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">默认音色 (Voice)</label>
                      <input
                        value={draftVoice.ttsVoice}
                        onChange={(e) => setDraftVoice({ ...draftVoice, ttsVoice: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handlePreviewTts}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-accent/40 bg-accent-soft text-accent text-[12px] font-medium cursor-pointer"
                >
                  {previewingVoice ? (
                    <>
                      <Square className="w-3 h-3 fill-current" />
                      <span>停止试听</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>试听当前朗读效果</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* STT Section */}
            <div className="p-4 rounded-2xl bg-sidebar border border-line space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-ink text-[14px]">
                  <Mic className="w-4 h-4 text-accent" />
                  <span>语音输入转文字 (STT)</span>
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

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDraftVoice({ ...draftVoice, sttEngine: 'native' })}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer ${
                    draftVoice.sttEngine === 'native'
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-canvas'
                  }`}
                >
                  <div className="font-semibold text-ink">系统原生识别（免费）</div>
                  <div className="text-[11px] text-dim mt-0.5">
                    Android 调用本机语音识别面板；若 PC 桌面端不支持离线语音，可切到右侧 API 方案
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDraftVoice({ ...draftVoice, sttEngine: 'openai_api' })}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer ${
                    draftVoice.sttEngine === 'openai_api'
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-canvas'
                  }`}
                >
                  <div className="font-semibold text-ink">自定义 STT API（全平台可用）</div>
                  <div className="text-[11px] text-dim mt-0.5">
                    麦克风录音后发送至硅基流动 SenseVoice（含免费额度）、Groq Whisper 或本地 Whisper
                  </div>
                </button>
              </div>

              {draftVoice.sttEngine === 'openai_api' && (
                <div className="space-y-3 pt-2 border-t border-line">
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
                            title="去官网获取 Key"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">STT Base URL</label>
                      <input
                        value={draftVoice.sttBaseUrl}
                        onChange={(e) =>
                          setDraftVoice({ ...draftVoice, sttBaseUrl: e.target.value })
                        }
                        className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">STT 模型 ID</label>
                      <input
                        value={draftVoice.sttModel}
                        onChange={(e) => setDraftVoice({ ...draftVoice, sttModel: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">
                        STT Key（可留空复用）
                      </label>
                      <input
                        type={showVoiceKey ? 'text' : 'password'}
                        value={draftVoice.sttApiKey}
                        onChange={(e) =>
                          setDraftVoice({ ...draftVoice, sttApiKey: e.target.value })
                        }
                        placeholder="留空自动复用"
                        className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink font-mono text-[12px] outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-line">
              <button
                type="button"
                onClick={handleSaveVoice}
                className="px-4 py-2 rounded-xl font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
              >
                保存语音设置
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
