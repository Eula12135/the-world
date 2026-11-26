import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Download,
  FileImage,
  FileJson,
  Loader2,
  ShieldAlert,
  Square,
  Upload,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import type { Character } from '../../../types';
import {
  buildShareableCharacterCard,
  exportCharacterCardPng,
  materializeImportedCharacterCard,
  parseShareableCharacterCardBytes,
  type ShareableCharacterCard,
} from '../../../services/characterCardService';
import { uploadClonedVoice } from '../../../services/voiceService';
import { pushBackLayer } from '../../../utils/backStack';
import { downloadBinaryFile, downloadTextFile, sanitizeFilename } from '../../../utils/platform';
import { OptionPicker } from '../../Common/OptionPicker';

interface CharacterCardShareModalProps {
  mode: 'export' | 'import';
  exportTarget?: Character | null;
  defaultWorldId: string;
  onClose: () => void;
  onImported?: (char: Character) => void;
}

export const CharacterCardShareModal: React.FC<CharacterCardShareModalProps> = ({
  mode,
  exportTarget,
  defaultWorldId,
  onClose,
  onImported,
}) => {
  useEffect(() => pushBackLayer(onClose), [onClose]);

  const {
    worlds,
    voiceProfiles,
    providers,
    settings,
    upsertCharacter,
    upsertVoiceProfile,
    showToast,
  } = useAppStore(
    useShallow((s) => ({
      worlds: s.worlds,
      voiceProfiles: s.voiceProfiles,
      providers: s.providers,
      settings: s.settings,
      upsertCharacter: s.upsertCharacter,
      upsertVoiceProfile: s.upsertVoiceProfile,
      showToast: s.showToast,
    }))
  );

  // Export states
  const boundVoice = exportTarget?.voiceProfileId
    ? voiceProfiles.find((vp) => vp.id === exportTarget.voiceProfileId)
    : undefined;
  const hasVoiceSample = Boolean(boundVoice?.sampleAudio);
  const [includeSample, setIncludeSample] = useState(true);
  const [voiceRightsConfirmed, setVoiceRightsConfirmed] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Import states
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [parsedCard, setParsedCard] = useState<ShareableCharacterCard | null>(null);
  const [targetWorldId, setTargetWorldId] = useState<string>(defaultWorldId);
  const [parseError, setParseError] = useState<string | null>(null);
  const [playingSample, setPlayingSample] = useState(false);
  const [recloning, setRecloning] = useState(false);
  const [reclonedUri, setReclonedUri] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  const handleExport = async (format: 'json' | 'png') => {
    if (!exportTarget) return;
    if (hasVoiceSample && includeSample && !voiceRightsConfirmed) {
      showToast('打包参考音频前，请先勾选声音权合规确认', 'error');
      return;
    }
    setExporting(true);
    try {
      const world = exportTarget.worldId
        ? worlds.find((w) => w.id === exportTarget.worldId)
        : undefined;
      const card = await buildShareableCharacterCard({
        character: exportTarget,
        voiceProfile: boundVoice,
        worldHint: world ? { name: world.name, genre: world.genre } : undefined,
        includeVoiceSample: includeSample,
      });
      const baseName = sanitizeFilename(exportTarget.name || '角色卡');

      if (format === 'json') {
        const ok = await downloadTextFile(
          `${baseName}.twcard.json`,
          JSON.stringify(card, null, 2),
          'application/json;charset=utf-8'
        );
        if (ok) {
          showToast('已导出 .twcard.json 角色卡（已自动剥离所有 API Key）', 'success');
          onClose();
        }
      } else {
        const pngBytes = await exportCharacterCardPng(card);
        const ok = await downloadBinaryFile(`${baseName}.card.png`, pngBytes, 'image/png');
        if (ok) {
          showToast('已导出 PNG 角色卡（分享时请发送「原图」或文件）', 'success');
          onClose();
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出角色卡失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handlePickImportFile = async (file: File) => {
    setParseError(null);
    setParsedCard(null);
    setReclonedUri(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const card = parseShareableCharacterCardBytes(bytes);
      setParsedCard(card);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '解析角色卡失败');
    }
  };

  const handleTogglePlaySample = () => {
    const sample = parsedCard?.voice?.sampleAudio;
    if (!sample) return;
    if (playingSample && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlayingSample(false);
      return;
    }
    const audio = new Audio(sample);
    audioRef.current = audio;
    audio.onended = () => setPlayingSample(false);
    audio.onerror = () => {
      setPlayingSample(false);
      showToast('参考音频播放失败', 'error');
    };
    setPlayingSample(true);
    audio.play().catch(() => {
      setPlayingSample(false);
      showToast('无法播放参考音频', 'error');
    });
  };

  const handleRecloneToMyAccount = async () => {
    const v = parsedCard?.voice;
    if (!v?.sampleAudio) return;
    const sfCred = settings.voice.ttsProviderConfigs?.siliconflow_tts;
    const baseUrl = sfCred?.baseUrl || 'https://api.siliconflow.cn/v1';
    const apiKey = sfCred?.apiKey || settings.voice.ttsApiKey;
    const model = sfCred?.model || 'FunAudioLLM/CosyVoice2-0.5B';

    setRecloning(true);
    try {
      const { uri } = await uploadClonedVoice({
        baseUrl,
        apiKey,
        providers,
        providerConfigs: settings.voice.ttsProviderConfigs,
        model,
        customName: v.name || parsedCard!.character.name,
        text: v.sourceText?.trim() || '你好，很高兴认识你。',
        audioDataUrl: v.sampleAudio,
      });
      setReclonedUri(uri);
      showToast('已用你的账号复刻专属音色，导入后即可直接发声', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : '复刻音色失败，请先配置硅基流动 API Key',
        'error'
      );
    } finally {
      setRecloning(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!parsedCard) return;
    setImporting(true);
    try {
      const sfCred = settings.voice.ttsProviderConfigs?.siliconflow_tts;
      const { character, voiceProfile } = materializeImportedCharacterCard({
        card: parsedCard,
        targetWorldId,
        overrideVoiceId: reclonedUri || undefined,
        overrideProviderId: reclonedUri ? 'siliconflow_tts' : undefined,
        overrideBaseUrl: reclonedUri
          ? sfCred?.baseUrl || 'https://api.siliconflow.cn/v1'
          : undefined,
        overrideModel: reclonedUri ? sfCred?.model || 'FunAudioLLM/CosyVoice2-0.5B' : undefined,
      });

      if (voiceProfile) {
        await upsertVoiceProfile(voiceProfile);
      }
      await upsertCharacter(character);
      showToast(
        voiceProfile
          ? `已导入角色「${character.name}」及配套声线`
          : `已导入角色「${character.name}」`,
        'success'
      );
      onImported?.(character);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入角色卡失败', 'error');
    } finally {
      setImporting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 bg-[#111827]/45 flex items-center justify-center p-3 md:p-4 anim-overlay"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] rounded-card bg-card border border-line shadow-2xl flex flex-col overflow-hidden anim-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
          <h2 className="text-title font-semibold text-ink">
            {mode === 'export' ? '分享导出角色卡' : '导入角色卡 (.twcard / PNG)'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-control text-dim hover:text-ink hover:bg-hover cursor-pointer"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-body">
          {mode === 'export' && exportTarget ? (
            <>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-sidebar border border-line">
                {exportTarget.avatarImage ? (
                  <img
                    src={exportTarget.avatarImage}
                    alt={exportTarget.name}
                    className="w-12 h-12 rounded-xl object-cover border border-line shrink-0"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
                    style={{ backgroundColor: exportTarget.avatarColor || '#4d6bfe' }}
                  >
                    {exportTarget.name.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-ink truncate">{exportTarget.name}</div>
                  <div className="text-caption text-dim truncate">
                    {exportTarget.identity || '角色设定 + 立绘'}
                    {boundVoice ? ` · 含音色「${boundVoice.name}」` : ''}
                  </div>
                </div>
              </div>

              <div className="text-caption text-secondary leading-relaxed">
                导出文件仅包含该角色的文本设定、立绘与声音配方，<strong>严格剥离所有 API Key 与会话隐私</strong>。
              </div>

              {boundVoice && hasVoiceSample && (
                <div className="p-3 rounded-xl bg-sidebar border border-line space-y-2">
                  <label className="flex items-center gap-2 text-ink font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeSample}
                      onChange={(e) => setIncludeSample(e.target.checked)}
                      className="accent-[var(--accent)]"
                    />
                    <span>附带音色参考音频样本（供对方离线试听或用自己的 Key 一键复刻）</span>
                  </label>
                  {includeSample && (
                    <label className="flex items-start gap-1.5 text-caption text-secondary cursor-pointer pt-1">
                      <ShieldAlert className="w-3.5 h-3.5 text-warn shrink-0 mt-0.5" />
                      <input
                        type="checkbox"
                        checked={voiceRightsConfirmed}
                        onChange={(e) => setVoiceRightsConfirmed(e.target.checked)}
                        className="accent-[var(--accent)] mt-0.5"
                      />
                      <span>
                        我确认该参考音频为 AI 原创生成声线或已获合法授权，不含未经授权的真人/商用配音样本
                      </span>
                    </label>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => void handleExport('json')}
                  className="flex flex-col items-start gap-1 p-3.5 rounded-xl border border-accent bg-accent-soft text-left hover:opacity-95 cursor-pointer disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 font-semibold text-accent-strong">
                    <FileJson className="w-4 h-4" />
                    <span>导出 .twcard.json（推荐）</span>
                  </span>
                  <span className="text-caption text-secondary">
                    微信 / QQ / 网盘文件直传最稳妥，不会被平台转码破坏数据
                  </span>
                </button>

                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => void handleExport('png')}
                  className="flex flex-col items-start gap-1 p-3.5 rounded-xl border border-line bg-canvas text-left hover:bg-hover cursor-pointer disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 font-semibold text-ink">
                    <FileImage className="w-4 h-4 text-accent" />
                    <span>导出 PNG 角色卡</span>
                  </span>
                  <span className="text-caption text-dim">
                    存图即存卡；社交软件发送时须勾选「原图」或按文件发送
                  </span>
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.png,application/json,image/png"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handlePickImportFile(f);
                  e.target.value = '';
                }}
              />

              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full py-6 px-4 rounded-xl border border-dashed border-line hover:border-accent bg-sidebar flex flex-col items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <Upload className="w-5 h-5 text-accent" />
                <span className="font-medium text-ink">
                  选择 `.twcard.json` 或内嵌数据的 `.png` 角色卡
                </span>
                <span className="text-caption text-dim">
                  同时兼容社区 TavernCard v2 角色卡图片/JSON
                </span>
              </button>

              {parseError && (
                <div className="px-3.5 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-danger">
                  {parseError}
                </div>
              )}

              {parsedCard && (
                <div className="p-3.5 rounded-xl bg-sidebar border border-line space-y-3">
                  <div className="flex items-center gap-3">
                    {parsedCard.character.avatarImage ? (
                      <img
                        src={parsedCard.character.avatarImage}
                        alt={parsedCard.character.name}
                        className="w-14 h-14 rounded-xl object-cover border border-line shrink-0"
                      />
                    ) : (
                      <div
                        className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
                        style={{ backgroundColor: parsedCard.character.avatarColor || '#4d6bfe' }}
                      >
                        {parsedCard.character.name.slice(0, 1)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                        <span className="font-semibold text-ink truncate">
                          {parsedCard.character.name}
                        </span>
                      </div>
                      {parsedCard.character.identity && (
                        <div className="text-caption text-secondary truncate mt-0.5">
                          {parsedCard.character.identity}
                        </div>
                      )}
                      {parsedCard.worldHint && (
                        <div className="text-caption text-dim mt-0.5">
                          原属作品：《{parsedCard.worldHint.name}》
                          {parsedCard.worldHint.genre ? ` · ${parsedCard.worldHint.genre}` : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  {parsedCard.character.personality && (
                    <p className="text-caption text-secondary line-clamp-3">
                      {parsedCard.character.personality}
                    </p>
                  )}

                  {parsedCard.voice && (
                    <div className="p-2.5 rounded-lg bg-canvas border border-line space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-caption font-medium text-ink">
                          随卡音色：{parsedCard.voice.name}（
                          {parsedCard.voice.kind === 'public_preset'
                            ? '公共预设，配置同厂商 Key 即可直读'
                            : parsedCard.voice.kind === 'native'
                              ? '系统原生语音'
                              : parsedCard.voice.kind === 'designed'
                                ? 'AI 捏制声线'
                                : '定制克隆声线'}
                          ）
                        </span>
                        {parsedCard.voice.sampleAudio && (
                          <button
                            type="button"
                            onClick={handleTogglePlaySample}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-line text-caption text-accent-strong hover:bg-hover cursor-pointer shrink-0"
                          >
                            {playingSample ? (
                              <Square className="w-3 h-3 fill-current" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5" />
                            )}
                            <span>{playingSample ? '停止试听' : '离线试听样本'}</span>
                          </button>
                        )}
                      </div>

                      {(parsedCard.voice.kind === 'cloned' ||
                        parsedCard.voice.kind === 'designed') &&
                        parsedCard.voice.sampleAudio && (
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line">
                            <span className="text-caption text-dim">
                              {reclonedUri
                                ? '已复刻到你的硅基流动账号'
                                : '跨账号私有音色可用你自己的 Key 一键复刻：'}
                            </span>
                            <button
                              type="button"
                              disabled={recloning || Boolean(reclonedUri)}
                              onClick={() => void handleRecloneToMyAccount()}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-soft text-accent-strong text-caption font-medium cursor-pointer disabled:opacity-50"
                            >
                              {recloning ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Wand2 className="w-3 h-3" />
                              )}
                              <span>
                                {reclonedUri
                                  ? '复刻已完成'
                                  : recloning
                                    ? '复刻中…'
                                    : '复刻到我的账号'}
                              </span>
                            </button>
                          </div>
                        )}
                    </div>
                  )}

                  <div>
                    <label className="block mb-1 text-caption text-secondary">导入到哪里</label>
                    <OptionPicker
                      value={targetWorldId}
                      items={[
                        { value: '', label: '独立角色库（不绑定作品）' },
                        ...worlds.map((w) => ({
                          value: w.id,
                          label: `《${w.name}》`,
                          hint: w.genre || undefined,
                        })),
                      ]}
                      onChange={setTargetWorldId}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3.5 py-2 rounded-control border border-line text-secondary hover:bg-hover cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => void handleConfirmImport()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control bg-accent text-white font-medium hover:opacity-95 cursor-pointer disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{importing ? '导入中…' : '确认导入角色'}</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modalContent;
  return createPortal(modalContent, document.body);
};
