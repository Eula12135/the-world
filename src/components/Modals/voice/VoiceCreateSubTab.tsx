import React, { useState } from 'react';
import {
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  UserCheck,
  Volume2,
  Wand2,
} from 'lucide-react';
import type {
  Character,
  ProviderConfig,
  VoiceConfig,
  VoiceProfile,
  WorldProject,
} from '../../../types';
import type { PendingVoiceBindTarget } from '../../../store/types';
import { resolveMediaApiKey } from '../../../services/imageGenService';
import {
  type BreezeVoiceItem,
  type BreezeVoicePreview,
  extractSiliconFlowShortVoice,
  formatSiliconFlowSystemVoice,
  type RemoteClonedVoice,
  rewriteSiliconFlowVoiceForModel,
  TTS_BUILTIN_VOICES,
  TTS_PRESETS,
  type TtsPreset,
} from '../../../services/voiceService';
import { sortCharacters } from '../../../utils/characterSort';
import { openExternalUrl } from '../../../utils/platform';
import { OptionPicker } from '../../Common/OptionPicker';
import { type InspirationChip, VOICE_INSPIRATION_CHIPS } from './constants';
import { VoiceBreezeDesignSection } from './VoiceBreezeDesignSection';
import { VoiceCloneSection } from './VoiceCloneSection';

interface VoiceCreateSubTabProps {
  draftVoice: VoiceConfig;
  setDraftVoice: React.Dispatch<React.SetStateAction<VoiceConfig>>;
  activeTtsProviderId: string;
  activeTtsPreset: TtsPreset | null;
  isBreezeActive: boolean;
  isSiliconFlowActive: boolean;
  availableTtsModels: string[];
  resolvedTtsReusableKey: string;
  fetchingTtsModels: boolean;
  nativeVoices: SpeechSynthesisVoice[];
  characters: Character[];
  worlds: WorldProject[];
  providers: ProviderConfig[];
  styleBriefCharacterId: string;
  setStyleBriefCharacterId: React.Dispatch<React.SetStateAction<string>>;
  generatingStyleDesc: boolean;
  editingProfileId: string | null;
  setEditingProfileId: React.Dispatch<React.SetStateAction<string | null>>;
  newProfileName: string;
  setNewProfileName: React.Dispatch<React.SetStateAction<string>>;
  saveAsDefault: boolean;
  setSaveAsDefault: React.Dispatch<React.SetStateAction<boolean>>;
  previewText: string;
  setPreviewText: React.Dispatch<React.SetStateAction<string>>;
  previewingDraft: boolean;
  pendingVoiceBindTarget: PendingVoiceBindTarget | null;
  designPrompt: string;
  setDesignPrompt: React.Dispatch<React.SetStateAction<string>>;
  designVoiceName: string;
  setDesignVoiceName: React.Dispatch<React.SetStateAction<string>>;
  designPreviews: BreezeVoicePreview[];
  setDesignPreviews: React.Dispatch<React.SetStateAction<BreezeVoicePreview[]>>;
  breezeVoices: BreezeVoiceItem[];
  setBreezeVoices: React.Dispatch<React.SetStateAction<BreezeVoiceItem[]>>;
  remoteCloned: RemoteClonedVoice[];
  setRemoteCloned: React.Dispatch<React.SetStateAction<RemoteClonedVoice[]>>;
  switchTtsProvider: (nextId: string) => void;
  updateTtsField: (patch: Partial<VoiceConfig>) => void;
  onRefreshTtsModels: () => void;
  onGenerateStyleInstruction: () => void;
  onApplyInspirationChip: (chip: InspirationChip) => void;
  onPreviewDraft: () => void;
  onSaveToLibrary: (mode: 'library' | 'bind') => void;
  onSaveVoice: (options?: { keepActiveProfile?: boolean }) => Promise<void>;
  buildVoiceProfileFromDraft: (opts?: {
    overrideName?: string;
    overrideVoiceId?: string;
    overrideModel?: string;
    isCloned?: boolean;
    sourceText?: string;
    sampleAudio?: string;
    designPrompt?: string;
  }) => VoiceProfile;
}

export const VoiceCreateSubTab: React.FC<VoiceCreateSubTabProps> = ({
  draftVoice,
  setDraftVoice,
  activeTtsProviderId,
  activeTtsPreset,
  isBreezeActive,
  isSiliconFlowActive,
  availableTtsModels,
  resolvedTtsReusableKey,
  fetchingTtsModels,
  nativeVoices,
  characters,
  worlds,
  providers,
  styleBriefCharacterId,
  setStyleBriefCharacterId,
  generatingStyleDesc,
  editingProfileId,
  setEditingProfileId,
  newProfileName,
  setNewProfileName,
  saveAsDefault,
  setSaveAsDefault,
  previewText,
  setPreviewText,
  previewingDraft,
  pendingVoiceBindTarget,
  designPrompt,
  setDesignPrompt,
  designVoiceName,
  setDesignVoiceName,
  designPreviews,
  setDesignPreviews,
  breezeVoices,
  setBreezeVoices,
  remoteCloned,
  setRemoteCloned,
  switchTtsProvider,
  updateTtsField,
  onRefreshTtsModels,
  onGenerateStyleInstruction,
  onApplyInspirationChip,
  onPreviewDraft,
  onSaveToLibrary,
  onSaveVoice,
  buildVoiceProfileFromDraft,
}) => {
  const [showVoiceKey, setShowVoiceKey] = useState(false);

  return (
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

      {/* Step A: Platform Selection */}
      <div className="p-4 rounded-xl bg-sidebar border border-line space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-ink">
              1. 选择语音服务厂商（各家 Key 独立保存，切换互不覆盖）
            </div>
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

        {activeTtsPreset && <p className="text-[11.5px] text-dim">{activeTtsPreset.description}</p>}

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

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[13px] font-medium text-secondary">语音模型 (Model)</label>
                <button
                  type="button"
                  onClick={onRefreshTtsModels}
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

      {/* Step B: Voice Config */}
      {draftVoice.ttsEngine === 'native' ? (
        <div className="p-4 rounded-xl bg-sidebar border border-line space-y-3">
          <div className="font-semibold text-ink">2. 系统原生音色与语速音调</div>
          <div>
            <label className="block mb-1 text-[13px] font-medium text-secondary">
              本机可用声音 ({nativeVoices.length})
            </label>
            <OptionPicker
              value={draftVoice.ttsNativeVoice}
              items={[
                { value: '', label: '跟随系统默认语音' },
                ...nativeVoices.map((v) => ({
                  value: v.name,
                  label: v.name,
                  hint: v.lang,
                })),
              ]}
              onChange={(val) => setDraftVoice((prev) => ({ ...prev, ttsNativeVoice: val }))}
              searchable={nativeVoices.length > 8}
              searchPlaceholder="搜索系统声音…"
            />
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
          onApplyInspirationChip={onApplyInspirationChip}
          buildVoiceProfileFromDraft={buildVoiceProfileFromDraft}
        />
      ) : (
        <div className="p-4 rounded-xl bg-sidebar border border-line space-y-4">
          <div>
            <div className="font-semibold text-ink">2. 选择底色音色与语气表达</div>
            {isSiliconFlowActive && (
              <p className="text-[11.5px] text-amber-500 mt-1">
                提示：硅基流动的性别与基础音色由「底色音色」决定，「语气指令」仅控制说话情绪（如慵懒/耳语）；点击下方“慵懒御姐”等灵感标签时会自动为您切到对应的女声底色（如 Anna）。
              </p>
            )}
          </div>

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

          <div className="space-y-1.5">
            <div className="text-[13px] font-medium text-secondary">
              快捷人设声线灵感（一键同步底色与语气）
            </div>
            <div className="flex flex-wrap gap-1.5">
              {VOICE_INSPIRATION_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => onApplyInspirationChip(chip)}
                  className="px-2.5 py-1 rounded-full bg-canvas border border-line text-[11.5px] text-secondary hover:border-accent hover:text-accent cursor-pointer"
                >
                  + {chip.label}
                </button>
              ))}
            </div>
          </div>

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
                <div className="flex-1 min-w-0">
                  <OptionPicker
                    compact
                    value={styleBriefCharacterId}
                    items={[
                      { value: '', label: '从角色卡生成语气：选择角色…' },
                      ...sortCharacters(characters).map((c) => {
                        const w = worlds.find((x) => x.id === c.worldId);
                        return {
                          value: c.id,
                          label: c.name,
                          hint: w ? `《${w.name}》` : '独立角色',
                          color: c.avatarColor,
                          image: c.avatarImage,
                        };
                      }),
                    ]}
                    onChange={setStyleBriefCharacterId}
                    searchable={characters.length >= 6}
                    searchPlaceholder="搜索角色…"
                  />
                </div>
                <button
                  type="button"
                  onClick={onGenerateStyleInstruction}
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

      {/* Step C: Audition & Save */}
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
            onClick={onPreviewDraft}
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
              onClick={() => onSaveToLibrary('bind')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white font-medium hover:opacity-95 cursor-pointer"
            >
              <UserCheck className="w-4 h-4" />
              <span>保存声音并绑定返回</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onSaveToLibrary('library')}
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
            onClick={() => void onSaveVoice({ keepActiveProfile: false })}
            className="px-3 py-2 rounded-xl border border-line text-secondary hover:text-ink hover:bg-hover cursor-pointer"
            title="仅应用下方接口/音色参数，不改动全局默认声音"
          >
            仅保存基础配置
          </button>
        </div>
      </div>
    </div>
  );
};
