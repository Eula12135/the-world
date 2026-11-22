import React, { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { MediaProviderCredential, VoiceConfig, VoiceProfile } from '../../../types';
import {
  type BreezeVoiceItem,
  type BreezeVoicePreview,
  designBreezeVoice,
  listBreezeVoices,
  saveBreezeVoiceDesign,
} from '../../../services/voiceService';
import { generateVoiceDescription } from '../../../services/voicePromptService';
import { isProviderReady } from '../../../utils/platform';
import { type InspirationChip, VOICE_INSPIRATION_CHIPS } from './constants';

interface VoiceBreezeDesignSectionProps {
  draftVoice: VoiceConfig;
  setDraftVoice: React.Dispatch<React.SetStateAction<VoiceConfig>>;
  previewText: string;
  newProfileName: string;
  setNewProfileName: (name: string) => void;
  designPrompt: string;
  setDesignPrompt: (prompt: string) => void;
  designVoiceName: string;
  setDesignVoiceName: (name: string) => void;
  designPreviews: BreezeVoicePreview[];
  setDesignPreviews: React.Dispatch<React.SetStateAction<BreezeVoicePreview[]>>;
  breezeVoices: BreezeVoiceItem[];
  setBreezeVoices: React.Dispatch<React.SetStateAction<BreezeVoiceItem[]>>;
  updateTtsField: (patch: Partial<VoiceConfig>) => void;
  onApplyInspirationChip: (chip: InspirationChip) => void;
  buildVoiceProfileFromDraft: (opts?: {
    overrideName?: string;
    overrideVoiceId?: string;
    overrideModel?: string;
    isCloned?: boolean;
  }) => VoiceProfile;
}

export const VoiceBreezeDesignSection: React.FC<VoiceBreezeDesignSectionProps> = ({
  draftVoice,
  setDraftVoice,
  previewText,
  newProfileName,
  setNewProfileName,
  designPrompt,
  setDesignPrompt,
  designVoiceName,
  setDesignVoiceName,
  designPreviews,
  setDesignPreviews,
  breezeVoices,
  setBreezeVoices,
  updateTtsField,
  onApplyInspirationChip,
  buildVoiceProfileFromDraft,
}) => {
  const providers = useAppStore((s) => s.providers);
  const characters = useAppStore((s) => s.characters);
  const worlds = useAppStore((s) => s.worlds);
  const settings = useAppStore((s) => s.settings);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const draftConfig = useAppStore((s) => s.draftConfig);
  const pendingVoiceBindTarget = useAppStore((s) => s.pendingVoiceBindTarget);
  const completePendingVoiceBind = useAppStore((s) => s.completePendingVoiceBind);
  const upsertVoiceProfile = useAppStore((s) => s.upsertVoiceProfile);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setVoiceStudioSubTab = useAppStore((s) => s.setVoiceStudioSubTab);
  const showToast = useAppStore((s) => s.showToast);

  const [voiceBriefCharacterId, setVoiceBriefCharacterId] = useState(() =>
    pendingVoiceBindTarget?.kind === 'character' ? pendingVoiceBindTarget.characterId : ''
  );
  const [generatingVoiceDesc, setGeneratingVoiceDesc] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [savingDesignId, setSavingDesignId] = useState<string | null>(null);
  const [fetchingBreezeVoices, setFetchingBreezeVoices] = useState(false);

  useEffect(() => {
    if (pendingVoiceBindTarget?.kind === 'character' && pendingVoiceBindTarget.characterId) {
      setVoiceBriefCharacterId(pendingVoiceBindTarget.characterId);
    }
  }, [pendingVoiceBindTarget]);

  const handleGenerateVoiceDescription = async () => {
    const character = characters.find((c) => c.id === voiceBriefCharacterId);
    if (!character) {
      showToast('先选一张角色卡，AI 会按它的设定写音色描述', 'info');
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
    setGeneratingVoiceDesc(true);
    try {
      const text = await generateVoiceDescription({
        provider,
        model,
        character,
        world: worlds.find((w) => w.id === character.worldId) || null,
      });
      if (!text) {
        showToast('模型没有返回有效的音色描述，请重试', 'error');
        return;
      }
      setDesignPrompt(text);
      setDraftVoice((prev) => ({ ...prev, ttsStyleInstruction: text }));
      showToast('已根据角色卡生成音色描述，可再手动微调', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '生成音色描述失败', 'error');
    } finally {
      setGeneratingVoiceDesc(false);
    }
  };

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

  return (
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
            onClick={() => onApplyInspirationChip(chip)}
            className="px-2.5 py-1 rounded-full bg-canvas border border-line text-[11.5px] text-secondary hover:border-accent hover:text-accent cursor-pointer"
          >
            + {chip.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={voiceBriefCharacterId}
            onChange={(e) => setVoiceBriefCharacterId(e.target.value)}
            className="flex-1 min-w-[160px] px-3 py-1.5 rounded-xl bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
          >
            <option value="">从角色卡生成：选择角色…</option>
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
            onClick={handleGenerateVoiceDescription}
            disabled={generatingVoiceDesc || !voiceBriefCharacterId}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-accent/40 bg-accent-soft text-accent text-[12px] font-medium hover:opacity-90 cursor-pointer disabled:opacity-40"
          >
            {generatingVoiceDesc ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wand2 className="w-3.5 h-3.5" />
            )}
            <span>{generatingVoiceDesc ? '生成中…' : 'AI 帮我写'}</span>
          </button>
        </div>
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
  );
};
