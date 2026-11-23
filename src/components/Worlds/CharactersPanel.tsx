import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  Users,
  Volume2,
  X,
  ZoomIn,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ImageLightbox } from '../Common/ImageLightbox';
import { OptionPicker } from '../Common/OptionPicker';
import type { Character, RelationType, VoiceProfile } from '../../types';
import {
  buildCharacterImagePrompt,
  compressImageDataToDataUrl,
  generateImage,
} from '../../services/imageGenService';
import {
  findTtsPresetByBaseUrl,
  speakText,
  stopSpeaking,
  TTS_PRESETS,
} from '../../services/voiceService';
import { RELATION_TYPE_META } from '../../services/temporalGraph';
import { generateImagePrompt } from '../../services/imagePromptService';
import { createId, isProviderReady } from '../../utils/platform';

/** 清掉空白字段；全空则整个钩子不落库，避免老卡被写入一堆空串 */
function normalizeUserHook(hook?: Character['userRelation']): Character['userRelation'] {
  if (!hook) return undefined;
  const next = {
    defaultAddress: hook.defaultAddress?.trim() || undefined,
    defaultRelationType: hook.defaultRelationType,
    defaultRelationLabel: hook.defaultRelationLabel?.trim() || undefined,
    defaultRelationDesc: hook.defaultRelationDesc?.trim() || undefined,
    slotHint: hook.slotHint?.trim() || undefined,
  };
  return Object.values(next).some((v) => v !== undefined) ? next : undefined;
}

function formatVoiceProfileOption(vp: VoiceProfile): string {
  const provider =
    vp.engine === 'native'
      ? '系统原生'
      : (
          TTS_PRESETS.find((p) => p.id === vp.providerId) ||
          (vp.baseUrl ? findTtsPresetByBaseUrl(vp.baseUrl) : undefined)
        )?.name.split('（')[0].trim() || 'API';
  return `${vp.name}（${vp.isCloned ? `${provider} · 克隆` : provider}）`;
}

const AVATAR_COLORS = ['#4d6bfe', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444'];

export const CharactersPanel: React.FC<{ worldId: string }> = ({ worldId }) => {
  const {
    characters,
    worlds,
    providers,
    settings,
    voiceProfiles,
    upsertCharacter,
    deleteCharacter,
    startNewDraft,
    openProvidersModal,
    lastCreatedVoiceForTarget,
    clearLastCreatedVoiceForTarget,
    pendingCreateStandaloneChar,
    clearPendingCreateStandaloneChar,
    requestConfirm,
    showToast,
  } = useAppStore();

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Character | null>(null);
  const [originalWorldId, setOriginalWorldId] = useState<string>('');
  const [showSystemPromptBox, setShowSystemPromptBox] = useState(false);
  const [showUserHookBox, setShowUserHookBox] = useState(false);
  const [imgPromptOpen, setImgPromptOpen] = useState(false);
  const [imgPrompt, setImgPrompt] = useState('');
  const [generatingImg, setGeneratingImg] = useState(false);
  const [refiningPrompt, setRefiningPrompt] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [showCustomVoiceInput, setShowCustomVoiceInput] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing || !lastCreatedVoiceForTarget) return;
    if (lastCreatedVoiceForTarget.targetKey === `character:${editing.id}`) {
      setEditing((prev) =>
        prev ? { ...prev, voiceProfileId: lastCreatedVoiceForTarget.profileId } : prev
      );
      clearLastCreatedVoiceForTarget();
    }
  }, [lastCreatedVoiceForTarget, editing?.id, clearLastCreatedVoiceForTarget]);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  const editingWorld = useMemo(
    () => {
      const targetWid = editing ? editing.worldId : worldId;
      return targetWid ? worlds.find((w) => w.id === targetWid) : undefined;
    },
    [worlds, editing, worldId]
  );

  const worldChars = useMemo(
    () =>
      characters
        .filter((c) => c.worldId === worldId)
        .filter((c) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return (
            c.name.toLowerCase().includes(q) ||
            c.identity.toLowerCase().includes(q) ||
            c.personality.toLowerCase().includes(q) ||
            (c.systemPrompt || '').toLowerCase().includes(q)
          );
        })
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [characters, worldId, query]
  );

  const openEditor = (char: Character) => {
    const targetWorld = char.worldId ? worlds.find((w) => w.id === char.worldId) : undefined;
    setEditing({ ...char });
    setOriginalWorldId(char.worldId);
    setShowSystemPromptBox(Boolean(char.systemPrompt?.trim()));
    setShowUserHookBox(Boolean(normalizeUserHook(char.userRelation)));
    setImgPromptOpen(false);
    setImgError(null);
    setImgPrompt(buildCharacterImagePrompt(char, targetWorld, settings.imageGen.styleHint));
  };

  useEffect(() => {
    if (worldId === '' && pendingCreateStandaloneChar) {
      clearPendingCreateStandaloneChar();
      const standaloneCount = characters.filter((c) => !c.worldId).length;
      openEditor({
        id: createId('char'),
        worldId: '',
        name: '',
        identity: '',
        personality: '',
        status: '',
        relationsNote: '',
        notes: '',
        avatarColor: AVATAR_COLORS[standaloneCount % AVATAR_COLORS.length],
        updatedAt: Date.now(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, pendingCreateStandaloneChar]);

  const openNew = () => {
    const fresh: Character = {
      id: createId('char'),
      worldId,
      name: '',
      identity: '',
      personality: '',
      status: '',
      relationsNote: '',
      notes: '',
      avatarColor: AVATAR_COLORS[worldChars.length % AVATAR_COLORS.length],
      updatedAt: Date.now(),
    };
    openEditor(fresh);
  };

  const handleSave = async (): Promise<Character | null> => {
    if (!editing || !editing.name.trim()) return null;
    const saved: Character = {
      ...editing,
      name: editing.name.trim(),
      systemPrompt: editing.systemPrompt?.trim() ? editing.systemPrompt : undefined,
      userRelation: normalizeUserHook(editing.userRelation),
      updatedAt: Date.now(),
    };
    await upsertCharacter(saved);
    setEditing(saved);
    setOriginalWorldId(saved.worldId);
    showToast('角色卡已保存', 'success');
    return saved;
  };

  const updateUserHook = (patch: Partial<NonNullable<Character['userRelation']>>) => {
    if (!editing) return;
    setEditing({ ...editing, userRelation: { ...(editing.userRelation || {}), ...patch } });
  };

  const handleOpenVoiceStudioForEditing = async (voiceSubTab: 'library' | 'create') => {
    if (!editing) return;
    const existedBefore = characters.some((c) => c.id === editing.id);
    const resolvedName = editing.name.trim() || '未命名角色';
    const saved: Character = {
      ...editing,
      name: resolvedName,
      systemPrompt: editing.systemPrompt?.trim() ? editing.systemPrompt : undefined,
      updatedAt: Date.now(),
    };
    await upsertCharacter(saved);
    setEditing(saved);
    setOriginalWorldId(saved.worldId);
    if (!existedBefore) {
      showToast(`已自动保存角色「${resolvedName}」`, 'info');
    }
    openProvidersModal('voice', {
      voiceSubTab,
      bindTarget: {
        kind: 'character',
        characterId: saved.id,
        characterName: saved.name,
      },
    });
  };

  const handleStartRoleChat = async (char: Character) => {
    let targetChar = char;
    if (editing && editing.id === char.id && editing.name.trim()) {
      const saved = await handleSave();
      if (!saved) return;
      targetChar = saved;
    }
    await startNewDraft({
      worldId: targetChar.worldId || undefined,
      chatMode: 'character_role',
      roleCharacterId: targetChar.id,
    });
  };

  const handleDelete = (c: Character) => {
    requestConfirm({
      title: '删除角色卡',
      message: c.worldId
        ? `确定要删除角色「${c.name}」吗？相关时间线中的角色标记也会同步清除。`
        : `确定要删除独立角色「${c.name}」吗？`,
      onConfirm: async () => {
        await deleteCharacter(c.id);
        if (editing?.id === c.id) setEditing(null);
        showToast('角色已删除');
      },
    });
  };

  const handleUploadAvatar = async (file: File) => {
    if (!editing) return;
    setImgError(null);
    try {
      const dataUrl = await compressImageDataToDataUrl(file, 512, 0.85);
      setEditing({ ...editing, avatarImage: dataUrl });
      showToast('角色图片已压缩载入，记得点击「保存角色」', 'success');
    } catch (err) {
      setImgError(err instanceof Error ? err.message : '读取图片失败');
    }
  };

  const handleAiRefinePrompt = async () => {
    if (!editing) return;
    const readyProviders = providers.filter((p) => p.enabled && isProviderReady(p));
    const provider =
      readyProviders.find((p) => p.id === settings.defaultProviderId) || readyProviders[0];
    if (!provider) {
      showToast('没有已配置 API Key 的可用文本模型，请先在「模型」页填写密钥', 'error');
      return;
    }
    const model = provider.selectedModel || provider.models[0];
    setRefiningPrompt(true);
    setImgError(null);
    try {
      const text = await generateImagePrompt({
        provider,
        model,
        character: editing,
        world: editingWorld,
      });
      if (!text) {
        showToast('模型没有返回有效的画面描述，请重试', 'error');
        return;
      }
      const prefix = settings.imageGen.styleHint?.trim();
      setImgPrompt(prefix ? `${prefix}，${text}` : text);
      showToast('已用 AI 提炼画面描述，可再手动微调', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI 提炼画面描述失败', 'error');
    } finally {
      setRefiningPrompt(false);
    }
  };

  const handleGenerateAvatar = async () => {
    if (!editing) return;
    const promptToUse =
      imgPrompt.trim() || buildCharacterImagePrompt(editing, editingWorld, settings.imageGen.styleHint);
    if (!imgPrompt.trim()) setImgPrompt(promptToUse);

    setGeneratingImg(true);
    setImgError(null);
    try {
      const dataUrl = await generateImage({
        config: settings.imageGen,
        providers,
        prompt: promptToUse,
      });
      setEditing((prev) => (prev ? { ...prev, avatarImage: dataUrl } : prev));
      showToast('AI 角色图生成完成，请点击「保存角色」', 'success');
    } catch (err) {
      setImgError(err instanceof Error ? err.message : '生成角色图失败');
    } finally {
      setGeneratingImg(false);
    }
  };

  if (editing) {
    return (
      <>
      <div className="flex-1 flex flex-col min-h-0 rounded-2xl bg-card border border-line overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line bg-sidebar">
          <button
            onClick={() => {
              setPreviewImage(null);
              setEditing(null);
            }}
            className="flex items-center gap-1.5 text-[13px] font-medium text-secondary hover:text-ink cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回角色列表</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {editing.name.trim() && (
              <button
                type="button"
                onClick={() => handleStartRoleChat(editing)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] border border-accent/40 bg-accent-soft text-accent font-medium hover:opacity-90 cursor-pointer whitespace-nowrap"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>以该角色对话</span>
              </button>
            )}
            {characters.some((c) => c.id === editing.id) && (
              <button
                onClick={() => handleDelete(editing)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] text-red-500 border border-red-500/30 hover:bg-red-500/10 cursor-pointer whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除</span>
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!editing.name.trim()}
              className="px-4 py-1.5 rounded-xl text-[13px] font-medium bg-accent text-white disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              保存角色
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-2xl mx-auto space-y-4 text-[13px]">
            {/* Portrait & AI Image Generation */}
            <div className="p-3.5 rounded-2xl bg-sidebar border border-line space-y-3">
              <div className="flex flex-wrap items-center gap-4">
                {editing.avatarImage ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewImage({
                        src: editing.avatarImage!,
                        alt: `${editing.name || '角色'} 立绘`,
                      })
                    }
                    className="relative group shrink-0 cursor-zoom-in rounded-2xl"
                    title="点击查看大图"
                  >
                    <img
                      src={editing.avatarImage}
                      alt={editing.name || '角色立绘'}
                      className="w-20 h-20 rounded-2xl object-cover border border-line"
                    />
                    <span className="absolute bottom-1 right-1 p-1 rounded-lg bg-black/60 text-white/90 backdrop-blur-xs group-hover:bg-accent transition">
                      <ZoomIn className="w-3 h-3" />
                    </span>
                  </button>
                ) : (
                  <div
                    className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shrink-0"
                    style={{ backgroundColor: editing.avatarColor || '#4d6bfe' }}
                  >
                    {(editing.name || '?').slice(0, 1)}
                  </div>
                )}

                <div className="flex-1 min-w-[200px] space-y-2">
                  <div className="font-medium text-ink">角色形象（头像 / 立绘）</div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadAvatar(f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-line bg-canvas text-[12px] text-ink hover:bg-hover cursor-pointer"
                    >
                      <ImagePlus className="w-3.5 h-3.5 text-accent" />
                      <span>上传本地图片</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextOpen = !imgPromptOpen;
                        setImgPromptOpen(nextOpen);
                        if (nextOpen && !imgPrompt.trim()) {
                          setImgPrompt(
                            buildCharacterImagePrompt(
                              editing,
                              editingWorld,
                              settings.imageGen.styleHint
                            )
                          );
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent-soft text-accent text-[12px] font-medium hover:opacity-90 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>AI 生成角色图</span>
                    </button>
                    {editing.avatarImage && (
                      <button
                        type="button"
                        onClick={() => setEditing({ ...editing, avatarImage: undefined })}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-line text-[12px] text-dim hover:text-red-500 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>清除</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {imgPromptOpen && (
                <div className="pt-2 border-t border-line space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <span className="text-secondary">
                      画面描述词（当前生图模型：<code className="text-accent">{settings.imageGen.model}</code>）
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleAiRefinePrompt()}
                        disabled={refiningPrompt}
                        className="flex items-center gap-1 text-accent font-medium hover:underline disabled:opacity-50 cursor-pointer"
                        title="用文本模型从角色卡里提炼，会剔除台词与剧情"
                      >
                        {refiningPrompt ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        <span>{refiningPrompt ? '提炼中…' : 'AI 提炼画面'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setImgPrompt(
                            buildCharacterImagePrompt(editing, editingWorld, settings.imageGen.styleHint)
                          )
                        }
                        className="text-dim hover:text-accent hover:underline cursor-pointer"
                        title="本地按关键词拼装，不调用模型"
                      >
                        按设定快速拼装
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    value={imgPrompt}
                    onChange={(e) => setImgPrompt(e.target.value)}
                    placeholder="描述角色外貌、服装、神态与背景光影..."
                    className="w-full p-2.5 rounded-xl bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openProvidersModal('image')}
                      className="text-[12px] text-dim hover:text-accent underline cursor-pointer"
                    >
                      配置生图模型 / API Key
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerateAvatar}
                      disabled={generatingImg}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent text-white text-[12px] font-medium disabled:opacity-50 cursor-pointer"
                    >
                      {generatingImg ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{generatingImg ? '生成中...' : '立即生成角色图'}</span>
                    </button>
                  </div>
                </div>
              )}

              {imgError && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-[12px]">
                  <span>{imgError}</span>
                  <button
                    type="button"
                    onClick={() => openProvidersModal('image')}
                    className="underline font-medium shrink-0 cursor-pointer"
                  >
                    前往配置生图 Key
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">所属作品</label>
              <OptionPicker
                value={editing.worldId}
                items={[
                  { value: '', label: '不绑定作品（独立角色）' },
                  ...worlds.map((w) => ({
                    value: w.id,
                    label: `《${w.name}》${w.genre ? ` · ${w.genre}` : ''}`,
                  })),
                ]}
                onChange={(value) => setEditing({ ...editing, worldId: value })}
              />
              {originalWorldId && originalWorldId !== editing.worldId && (
                <p className="mt-1 text-[11.5px] text-amber-500">
                  更改所属作品后，保存时将自动移除该角色在原作品中的关系连线与时间线出场标记。
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block mb-1.5 font-medium text-secondary">姓名 *</label>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例如：林澈"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-secondary">身份 / 定位</label>
                <input
                  value={editing.identity}
                  onChange={(e) => setEditing({ ...editing, identity: e.target.value })}
                  placeholder="例如：主角 · 边境调查员"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block mb-1.5 font-medium text-secondary">标识色</label>
                <div className="flex items-center gap-2.5 pt-1">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditing({ ...editing, avatarColor: c })}
                      className={`w-7 h-7 rounded-full cursor-pointer transition ${
                        editing.avatarColor === c ? 'ring-2 ring-accent scale-110' : 'opacity-80'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`选择颜色 ${c}`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="font-medium text-secondary">绑定角色声音（可选）</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleOpenVoiceStudioForEditing('library')}
                      className="text-[11.5px] text-secondary hover:text-accent hover:underline cursor-pointer"
                    >
                      管理声音库
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenVoiceStudioForEditing('create')}
                      className="flex items-center gap-0.5 text-[11.5px] text-accent font-medium hover:underline cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>新建声音</span>
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <OptionPicker
                      value={editing.voiceProfileId || ''}
                      items={[
                        { value: '', label: '跟随全局默认声音' },
                        ...voiceProfiles.map((vp) => ({
                          value: vp.id,
                          label: formatVoiceProfileOption(vp),
                        })),
                      ]}
                      onChange={(value) =>
                        setEditing({ ...editing, voiceProfileId: value || undefined })
                      }
                      searchable={voiceProfiles.length > 8}
                      searchPlaceholder="搜索声音档案…"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (previewingVoice) {
                        stopSpeaking();
                        setPreviewingVoice(false);
                        return;
                      }
                      const profile = editing.voiceProfileId
                        ? voiceProfiles.find((vp) => vp.id === editing.voiceProfileId)
                        : undefined;
                      setPreviewingVoice(true);
                      await speakText({
                        text: `你好，我是${editing.name.trim() || '角色'}。`,
                        config: settings.voice,
                        providers,
                        profile,
                        voiceOverride: profile ? undefined : editing.voiceName?.trim() || undefined,
                        onEnd: () => setPreviewingVoice(false),
                        onError: (msg) => {
                          setPreviewingVoice(false);
                          showToast(msg, 'error');
                        },
                      });
                    }}
                    className="flex items-center gap-1 px-2.5 py-2 rounded-xl border border-line bg-canvas text-[12px] text-ink hover:border-accent cursor-pointer shrink-0"
                    title="试听当前选中的角色声音"
                  >
                    {previewingVoice ? (
                      <Square className="w-3.5 h-3.5 text-accent" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-accent" />
                    )}
                    <span>{previewingVoice ? '停止' : '试听'}</span>
                  </button>
                </div>

                <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={() => setShowCustomVoiceInput((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] text-dim hover:text-secondary cursor-pointer"
                  >
                    {showCustomVoiceInput || editing.voiceName ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    <span>高级：直接填写外部音色 ID（仅未选声音库档案时生效）</span>
                  </button>
                  {(showCustomVoiceInput || Boolean(editing.voiceName)) && (
                    <input
                      value={editing.voiceName || ''}
                      onChange={(e) => setEditing({ ...editing, voiceName: e.target.value })}
                      placeholder="例如 FunAudioLLM/CosyVoice2-0.5B:anna"
                      className="w-full mt-1.5 px-3 py-1.5 rounded-xl bg-canvas border border-line text-[12px] font-mono text-ink outline-none focus:border-accent"
                    />
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">性格特点</label>
              <textarea
                rows={3}
                value={editing.personality}
                onChange={(e) => setEditing({ ...editing, personality: e.target.value })}
                placeholder="例如：表面冷静克制，实则对旧日誓言极为执着，说话简洁少废话。"
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[14px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">目前状态</label>
              <input
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                placeholder="例如：正在前往北境调查失踪案，负轻伤"
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[14px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">人物关系简记</label>
              <textarea
                rows={3}
                value={editing.relationsNote}
                onChange={(e) => setEditing({ ...editing, relationsNote: e.target.value })}
                placeholder="例如：与苏岚：旧日搭档，因三年前事故产生隔阂；与沈老：师徒，受其暗中庇护。"
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[14px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div className="rounded-2xl bg-sidebar border border-line overflow-hidden">
              <button
                type="button"
                onClick={() => setShowUserHookBox((v) => !v)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-[12.5px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  {showUserHookBox || Boolean(normalizeUserHook(editing.userRelation)) ? (
                    <ChevronDown className="w-4 h-4 text-accent" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-dim" />
                  )}
                  <span>与「我」的关系钩子（可选 · 独立角色尤其有用）</span>
                </span>
                {Boolean(normalizeUserHook(editing.userRelation)) && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                    已启用
                  </span>
                )}
              </button>
              {(showUserHookBox || Boolean(normalizeUserHook(editing.userRelation))) && (
                <div className="p-3.5 pt-2 border-t border-line space-y-2">
                  <p className="text-[11.5px] text-dim">
                    这张卡被当成对话对象时的默认设定：默认怎么称呼「我」、默认是什么关系。用户在对话里随时能覆盖，
                    不会改到卡本身。
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={editing.userRelation?.defaultAddress || ''}
                      onChange={(e) => updateUserHook({ defaultAddress: e.target.value })}
                      placeholder="默认称呼，例如：旅人"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                    />
                    <select
                      value={editing.userRelation?.defaultRelationType || ''}
                      onChange={(e) =>
                        updateUserHook({
                          defaultRelationType: (e.target.value || undefined) as
                            | RelationType
                            | undefined,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                    >
                      <option value="">默认关系类型：不指定</option>
                      {(Object.keys(RELATION_TYPE_META) as RelationType[]).map((t) => (
                        <option key={t} value={t}>
                          {RELATION_TYPE_META[t].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    value={editing.userRelation?.defaultRelationLabel || ''}
                    onChange={(e) => updateUserHook({ defaultRelationLabel: e.target.value })}
                    placeholder="默认关系标签，例如：点头之交"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                  <input
                    value={editing.userRelation?.defaultRelationDesc || ''}
                    onChange={(e) => updateUserHook({ defaultRelationDesc: e.target.value })}
                    placeholder="默认关系描述，例如：在渡口见过几面"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                  <input
                    value={editing.userRelation?.slotHint || ''}
                    onChange={(e) => updateUserHook({ slotHint: e.target.value })}
                    placeholder="可选项提示，例如：用户可以是他的同门 / 他早年失散的宿敌"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">补充备注（外貌、习惯、背景）</label>
              <textarea
                rows={4}
                value={editing.notes}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                placeholder="任何想让 AI 注意的角色细节..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[14px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div className="rounded-2xl bg-sidebar border border-line overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSystemPromptBox((v) => !v)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-[12.5px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  {showSystemPromptBox || Boolean(editing.systemPrompt?.trim()) ? (
                    <ChevronDown className="w-4 h-4 text-accent" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-dim" />
                  )}
                  <span>自定义系统提示词（可选 · 适合工具型/自由人设）</span>
                </span>
                {Boolean(editing.systemPrompt?.trim()) && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                    已启用
                  </span>
                )}
              </button>
              {(showSystemPromptBox || Boolean(editing.systemPrompt?.trim())) && (
                <div className="p-3.5 pt-2 border-t border-line space-y-1.5">
                  <p className="text-[11.5px] text-dim">
                    留空时将按上方角色档案自动生成第一人称扮演提示词；填写后将直接使用这里的内容作为完整系统提示词（仍可保留声音绑定和立绘）。
                  </p>
                  <textarea
                    rows={4}
                    value={editing.systemPrompt || ''}
                    onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
                    placeholder="例如：你是一位冷静毒舌的剑修师兄…… 或 你是我的中英小说润色编辑……"
                    className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-[13.5px] text-ink outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {previewImage && (
        <ImageLightbox
          src={previewImage.src}
          alt={previewImage.alt}
          onClose={() => setPreviewImage(null)}
        />
      )}
      </>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-4">
      {worldId === '' && (
        <div className="px-3.5 py-2 rounded-xl bg-accent-soft/70 border border-accent/25 text-[12px] text-secondary">
          <span className="font-medium text-accent">独立角色库</span> · 不绑定任何作品，支持 AI 生图、音色绑定与自由提示词，随时可在对话中选用
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-line w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-dim shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索角色姓名或身份..."
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-dim"
          />
        </div>

        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{worldId === '' ? '新建独立角色' : '新建角色卡'}</span>
        </button>
      </div>

      {worldChars.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-line space-y-2">
          <Users className="w-8 h-8 mx-auto text-dim" />
          <div className="text-[14px] text-secondary">还没有角色卡</div>
          <p className="text-[12px] text-dim">
            角色卡支持上传或 AI 生成立绘，并可直接让 AI 以该角色第一人称对话。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {worldChars.map((c) => (
            <div
              key={c.id}
              onClick={() => openEditor(c)}
              className="p-4 rounded-2xl bg-card border border-line hover:border-accent/50 transition cursor-pointer flex flex-col justify-between gap-3"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {c.avatarImage ? (
                      <img
                        src={c.avatarImage}
                        alt={c.name}
                        className="w-10 h-10 rounded-full object-cover border border-line shrink-0"
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
                        style={{ backgroundColor: c.avatarColor || '#4d6bfe' }}
                      >
                        {c.name.slice(0, 1)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[15px] font-semibold text-ink truncate">{c.name}</span>
                        {c.systemPrompt?.trim() && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent-soft text-accent shrink-0">
                            自由提示词
                          </span>
                        )}
                      </div>
                      {c.identity && (
                        <div className="text-[12px] text-dim truncate">{c.identity}</div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(c);
                    }}
                    className="p-1.5 rounded-lg text-dim hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
                    title="删除角色"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-[13px] text-secondary line-clamp-2 leading-relaxed">
                  {c.personality || c.systemPrompt || c.relationsNote || c.notes || '点击编辑角色详情...'}
                </p>
              </div>

              <div className="pt-2 border-t border-line flex items-center justify-between gap-2 text-[12px]">
                <span className="text-dim truncate">
                  {c.status ? `状态：${c.status}` : '点击卡片编辑资料'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartRoleChat(c);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent-soft text-accent font-medium hover:opacity-90 shrink-0 cursor-pointer"
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>角色对话</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
