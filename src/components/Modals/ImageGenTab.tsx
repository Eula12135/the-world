import React, { useState } from 'react';
import { ExternalLink, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import type { ImageGenConfig, MediaProviderCredential, ProviderConfig } from '../../types';
import {
  fetchImageGenModels,
  IMAGE_GEN_PRESETS,
  resolveMediaApiKey,
} from '../../services/imageGenService';
import { IMAGE_FRAMINGS } from '../../utils/imageFraming';
import { openExternalUrl } from '../../utils/platform';

interface ImageGenTabProps {
  draftImg: ImageGenConfig;
  setDraftImg: React.Dispatch<React.SetStateAction<ImageGenConfig>>;
  providers: ProviderConfig[];
  updateSettings: (patch: { imageGen: ImageGenConfig }) => Promise<void>;
  showToast: (text: string, tone?: 'info' | 'success' | 'error') => void;
}

export const ImageGenTab: React.FC<ImageGenTabProps> = ({
  draftImg,
  setDraftImg,
  providers,
  updateSettings,
  showToast,
}) => {
  const [showImgKey, setShowImgKey] = useState(false);
  const [fetchingImgModels, setFetchingImgModels] = useState(false);

  const activeImgPreset =
    IMAGE_GEN_PRESETS.find((p) => p.id === draftImg.presetId) || IMAGE_GEN_PRESETS[0];

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

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-[max(env(safe-area-inset-bottom),20px)] md:pb-6 space-y-4 text-[13px]">
      <div className="p-3.5 rounded-xl bg-accent-soft border border-accent/25 text-[13px] text-ink">
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
        <span className="text-[13px] text-secondary">
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
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent text-white text-[13px] font-medium cursor-pointer"
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
            className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[13px] outline-none focus:border-accent"
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
              className="flex-1 py-2 bg-transparent text-ink font-mono text-[13px] outline-none"
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
              onClick={() => void handleRefreshImgModels()}
              disabled={fetchingImgModels}
              className="flex items-center gap-1 text-[13px] text-accent hover:underline cursor-pointer disabled:opacity-50"
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
            className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink font-mono text-[13px] outline-none focus:border-accent"
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
                className={`px-2 py-0.5 rounded-lg border text-[11.5px] font-mono cursor-pointer ${
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
            头像只画头肩、半身到膝盖、横版带背景 —— 取景会写进内置提示词，避免选了头像却画出全身像。
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
          onClick={() => void handleSaveImageGen()}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-control text-body font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
        >
          保存生图配置
        </button>
      </div>
    </div>
  );
};
