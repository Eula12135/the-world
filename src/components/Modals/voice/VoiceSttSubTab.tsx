import React, { useMemo, useState } from 'react';
import { ExternalLink, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { MediaProviderCredential, VoiceConfig } from '../../../types';
import { resolveMediaApiKey } from '../../../services/imageGenService';
import {
  fetchSttModels,
  findSttPresetByBaseUrl,
  STT_PRESETS,
} from '../../../services/voiceService';
import { openExternalUrl } from '../../../utils/platform';

interface VoiceSttSubTabProps {
  draftVoice: VoiceConfig;
  setDraftVoice: React.Dispatch<React.SetStateAction<VoiceConfig>>;
  onSaveVoice: (options?: { keepActiveProfile?: boolean }) => Promise<void>;
}

export const VoiceSttSubTab: React.FC<VoiceSttSubTabProps> = ({
  draftVoice,
  setDraftVoice,
  onSaveVoice,
}) => {
  const providers = useAppStore((s) => s.providers);
  const showToast = useAppStore((s) => s.showToast);

  const [showSttKey, setShowSttKey] = useState(false);
  const [fetchingSttModels, setFetchingSttModels] = useState(false);

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
  }, [
    activeSttProviderId,
    draftVoice.sttApiKey,
    draftVoice.sttBaseUrl,
    draftVoice.sttProviderConfigs,
    providers,
  ]);

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

  return (
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
  );
};
