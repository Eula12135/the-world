import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  GripVertical,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import type { Character } from '../../types';
import { buildCharacterImagePrompt } from '../../services/imageGenService';
import { stopSpeaking } from '../../services/voiceService';
import { sortCharacters } from '../../utils/characterSort';
import { useSmoothGridSort } from '../../utils/useSmoothGridSort';
import { createId } from '../../utils/platform';
import { getFramingById, resolveImageFraming } from '../../utils/imageFraming';
import { resolveCharacterStylePrompt } from '../../data/imageStyles';
import { CharacterCardShareModal } from './character/CharacterCardShareModal';
import { AVATAR_COLORS, CharacterEditor, normalizeUserHook } from './character/CharacterEditor';

export const CharactersPanel: React.FC<{ worldId: string }> = ({ worldId }) => {
  const {
    characters,
    worlds,
    providers,
    settings,
    voiceProfiles,
    upsertCharacter,
    toggleCharacterPin,
    reorderCharacters,
    deleteCharacter,
    startNewDraft,
    openProvidersModal,
    lastCreatedVoiceForTarget,
    clearLastCreatedVoiceForTarget,
    pendingCreateStandaloneChar,
    clearPendingCreateStandaloneChar,
    requestConfirm,
    showToast,
  } = useAppStore(
    useShallow((s) => ({
      characters: s.characters,
      worlds: s.worlds,
      providers: s.providers,
      settings: s.settings,
      voiceProfiles: s.voiceProfiles,
      upsertCharacter: s.upsertCharacter,
      toggleCharacterPin: s.toggleCharacterPin,
      reorderCharacters: s.reorderCharacters,
      deleteCharacter: s.deleteCharacter,
      startNewDraft: s.startNewDraft,
      openProvidersModal: s.openProvidersModal,
      lastCreatedVoiceForTarget: s.lastCreatedVoiceForTarget,
      clearLastCreatedVoiceForTarget: s.clearLastCreatedVoiceForTarget,
      pendingCreateStandaloneChar: s.pendingCreateStandaloneChar,
      clearPendingCreateStandaloneChar: s.clearPendingCreateStandaloneChar,
      requestConfirm: s.requestConfirm,
      showToast: s.showToast,
    }))
  );

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Character | null>(null);
  const [originalWorldId, setOriginalWorldId] = useState<string>('');
  const [imgPromptOpen, setImgPromptOpen] = useState(false);
  const [imgPromptDirty, setImgPromptDirty] = useState(false);
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgError, setImgError] = useState<string | null>(null);
  const [cardModal, setCardModal] = useState<
    { mode: 'import' } | { mode: 'export'; target: Character } | null
  >(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);

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

  const editingWorld = useMemo(() => {
    const targetWid = editing ? editing.worldId : worldId;
    return targetWid ? worlds.find((w) => w.id === targetWid) : undefined;
  }, [worlds, editing, worldId]);

  const isSearching = query.trim().length > 0;

  const worldChars = useMemo(() => {
    const filtered = characters
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
      });
    return sortCharacters(filtered);
  }, [characters, worldId, query]);

  const canDragSort = !isSearching && worldChars.length > 1;

  const { gridRef, captureFlipSnapshot, bindCardDragProps, shouldSuppressCardClick } =
    useSmoothGridSort({
      items: worldChars,
      enabled: canDragSort,
      scrollContainerRef: panelScrollRef,
      onReorder: (orderedIds) => {
        void reorderCharacters(worldId, orderedIds);
      },
    });

  const handleTogglePin = (char: Character, fromEditor = false) => {
    const isSavedChar = characters.some((c) => c.id === char.id);
    if (!isSavedChar) {
      setEditing((prev) => (prev && prev.id === char.id ? { ...prev, pinned: !prev.pinned } : prev));
      return;
    }
    const nextPinned = !char.pinned;
    if (!fromEditor) {
      captureFlipSnapshot(char.id);
    }
    void toggleCharacterPin(char.id);
    setEditing((prev) => (prev && prev.id === char.id ? { ...prev, pinned: nextPinned } : prev));
    if (fromEditor) {
      showToast(nextPinned ? `已置顶「${char.name}」` : `已取消置顶「${char.name}」`, 'info');
    }
  };

  const openEditor = (char: Character) => {
    const targetWorld = char.worldId ? worlds.find((w) => w.id === char.worldId) : undefined;
    setEditing({ ...char });
    setOriginalWorldId(char.worldId);
    setImgPromptOpen(false);
    setImgPromptDirty(false);
    setImgError(null);
    const framing = char.imageFramingId
      ? getFramingById(char.imageFramingId)
      : resolveImageFraming(settings.imageGen.size);
    setImgPrompt(
      buildCharacterImagePrompt(
        char,
        targetWorld,
        resolveCharacterStylePrompt(char.imageStyleId, settings.imageGen.styleHint),
        framing.size
      )
    );
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
    openEditor({
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
    });
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

  const handleExportCharacterCard = async (char: Character) => {
    let targetChar = char;
    if (editing && editing.id === char.id && editing.name.trim()) {
      const saved = await handleSave();
      if (saved) targetChar = saved;
    }
    setCardModal({ mode: 'export', target: targetChar });
  };

  if (editing) {
    return (
      <>
        <CharacterEditor
          editing={editing}
          setEditing={setEditing}
          originalWorldId={originalWorldId}
          isSaved={characters.some((c) => c.id === editing.id)}
          worlds={worlds}
          editingWorld={editingWorld}
          providers={providers}
          settings={settings}
          voiceProfiles={voiceProfiles}
          imgPrompt={imgPrompt}
          setImgPrompt={setImgPrompt}
          imgPromptDirty={imgPromptDirty}
          setImgPromptDirty={setImgPromptDirty}
          imgPromptOpen={imgPromptOpen}
          setImgPromptOpen={setImgPromptOpen}
          imgError={imgError}
          setImgError={setImgError}
          onBack={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          onTogglePin={(char) => handleTogglePin(char, true)}
          onStartRoleChat={(char) => void handleStartRoleChat(char)}
          onOpenVoiceStudio={(subTab) => void handleOpenVoiceStudioForEditing(subTab)}
          onOpenImageConfig={() => openProvidersModal('image')}
          onExportCard={(char) => void handleExportCharacterCard(char)}
          showToast={showToast}
        />
        {cardModal && (
          <CharacterCardShareModal
            mode={cardModal.mode}
            exportTarget={cardModal.mode === 'export' ? cardModal.target : null}
            defaultWorldId={worldId}
            onClose={() => setCardModal(null)}
          />
        )}
      </>
    );
  }

  return (
    <div ref={panelScrollRef} className="flex-1 overflow-y-auto space-y-4">
      {worldId === '' && (
        <div className="px-3.5 py-2 rounded-xl bg-accent-soft/70 border border-accent/25 text-[13px] text-secondary">
          <span className="font-medium text-accent">独立角色库</span> ·
          不绑定任何作品，支持 AI 生图、音色绑定与自由提示词，随时可在对话中选用
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCardModal({ mode: 'import' })}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] border border-line bg-card text-secondary hover:text-ink hover:bg-hover cursor-pointer"
          >
            <Upload className="w-4 h-4 text-accent" />
            <span>导入角色卡</span>
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{worldId === '' ? '新建独立角色' : '新建角色卡'}</span>
          </button>
        </div>
      </div>

      {worldChars.length === 0 ? (
        <div className="py-16 text-center rounded-xl border border-dashed border-line space-y-2">
          <Users className="w-8 h-8 mx-auto text-dim" />
          <div className="text-[15px] text-secondary">还没有角色卡</div>
          <p className="text-[13px] text-dim">
            点击右上角「新建角色卡」或「导入角色卡（.twcard / PNG）」开始创建并直接开启角色对话。
          </p>
        </div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {worldChars.map((c) => (
            <div
              key={c.id}
              data-char-card-id={c.id}
              {...bindCardDragProps(c.id)}
              onClick={() => {
                if (shouldSuppressCardClick()) return;
                openEditor(c);
              }}
              className={`p-4 rounded-xl bg-card border transition-colors cursor-pointer flex flex-col justify-between gap-3 ${
                c.pinned
                  ? 'border-accent/40 hover:border-accent/70'
                  : 'border-line hover:border-accent/50'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {canDragSort && (
                      <span
                        data-drag-handle="true"
                        data-no-swipe="true"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 -ml-2 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-grab active:cursor-grabbing touch-none shrink-0"
                        title="按住拖动调整顺序"
                        aria-label={`拖动排序 ${c.name}`}
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                    )}
                    {c.avatarImage ? (
                      <img
                        src={c.avatarImage}
                        alt={c.name}
                        draggable={false}
                        className="w-10 h-10 rounded-full object-cover border border-line shrink-0 select-none"
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0 select-none"
                        style={{ backgroundColor: c.avatarColor || '#4d6bfe' }}
                      >
                        {c.name.slice(0, 1)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[15px] font-semibold text-ink truncate">
                          {c.name}
                        </span>
                        {c.pinned && (
                          <span className="px-1.5 py-0.5 rounded text-[11.5px] bg-accent-soft text-accent font-medium shrink-0">
                            置顶
                          </span>
                        )}
                        {c.systemPrompt?.trim() && (
                          <span className="px-1.5 py-0.5 rounded text-[11.5px] bg-muted text-secondary shrink-0">
                            自由提示词
                          </span>
                        )}
                      </div>
                      {c.identity && (
                        <div className="text-[13px] text-dim truncate">{c.identity}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePin(c);
                      }}
                      className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                        c.pinned
                          ? 'text-accent bg-accent-soft'
                          : 'text-dim hover:text-ink hover:bg-hover'
                      }`}
                      title={c.pinned ? '取消置顶' : '置顶角色'}
                      aria-label={c.pinned ? '取消置顶' : '置顶角色'}
                    >
                      <Pin className={`w-3.5 h-3.5 ${c.pinned ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCardModal({ mode: 'export', target: c });
                      }}
                      className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer"
                      title="分享导出角色卡"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(c);
                      }}
                      className="p-1.5 rounded-lg text-dim hover:text-danger hover:bg-danger/10 cursor-pointer"
                      title="删除角色"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-[13px] text-secondary line-clamp-2 leading-relaxed">
                  {c.personality ||
                    c.systemPrompt ||
                    c.relationsNote ||
                    c.notes ||
                    '点击编辑角色详情...'}
                </p>
              </div>

              <div className="pt-2 border-t border-line flex items-center justify-between gap-2 text-[13px]">
                <span className="text-dim truncate">
                  {c.status ? `状态：${c.status}` : '点击卡片编辑资料'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleStartRoleChat(c);
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

      {cardModal && (
        <CharacterCardShareModal
          mode={cardModal.mode}
          exportTarget={cardModal.mode === 'export' ? cardModal.target : null}
          defaultWorldId={worldId}
          onClose={() => setCardModal(null)}
        />
      )}
    </div>
  );
};
