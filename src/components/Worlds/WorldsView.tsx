import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Download,
  FileText,
  GitBranch,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  getRecommendedTemplateId,
  parseDocumentSections,
  WORLD_GENRES,
  WORLD_TEMPLATES,
} from '../../data/worldTemplates';
import { WorldDocEditor } from './WorldDocEditor';
import { CharactersPanel } from './CharactersPanel';
import { TimelinePanel } from './TimelinePanel';
import { TemporalRelationGraph } from './TemporalRelationGraph';
import { WorldImportModal } from './WorldImportModal';
import { worldToMarkdown } from '../../services/exportService';
import { downloadTextFile, isImeComposing } from '../../utils/platform';

type StudioTab = 'doc' | 'characters' | 'timeline' | 'relations';

export const WorldsView: React.FC = () => {
  const {
    worlds,
    activeWorldId,
    characters,
    relations,
    timelineEvents,
    selectWorld,
    createWorld,
    updateWorld,
    deleteWorld,
    startNewDraft,
    worldStudioMode,
    setWorldStudioMode,
    requestConfirm,
    showToast,
  } = useAppStore();

  const [tab, setTab] = useState<StudioTab>('doc');
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGenre, setNewGenre] = useState<string>('玄幻');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('xianxia');
  const [menuOpen, setMenuOpen] = useState(false);
  const [worldPickerOpen, setWorldPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const activeWorld = worlds.find((w) => w.id === activeWorldId) ?? null;

  const standaloneCharsCount = useMemo(
    () => characters.filter((c) => !c.worldId).length,
    [characters]
  );

  const worldChars = useMemo(
    () => (activeWorld ? characters.filter((c) => c.worldId === activeWorld.id) : []),
    [activeWorld, characters]
  );
  const worldRels = useMemo(
    () => (activeWorld ? relations.filter((r) => r.worldId === activeWorld.id) : []),
    [activeWorld, relations]
  );
  const worldEvents = useMemo(
    () => (activeWorld ? timelineEvents.filter((e) => e.worldId === activeWorld.id) : []),
    [activeWorld, timelineEvents]
  );

  const selectedTemplate = useMemo(
    () => WORLD_TEMPLATES.find((t) => t.id === selectedTemplateId) || WORLD_TEMPLATES[0],
    [selectedTemplateId]
  );
  const templateHeadings = useMemo(
    () => parseDocumentSections(selectedTemplate.document),
    [selectedTemplate]
  );

  const openCreator = () => {
    setNewName('');
    setNewGenre('玄幻');
    setSelectedTemplateId(getRecommendedTemplateId('玄幻'));
    setCreating(true);
  };

  const handleGenrePick = (genre: string) => {
    setNewGenre(genre);
    setSelectedTemplateId(getRecommendedTemplateId(genre));
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    await createWorld({
      name: trimmed,
      genre: newGenre,
      document: selectedTemplate.document,
    });
    setCreating(false);
    setTab('doc');
    showToast(`已创建《${trimmed}》`, 'success');
  };

  const handleExportMd = async () => {
    if (!activeWorld) return;
    setMenuOpen(false);
    const md = worldToMarkdown({
      world: activeWorld,
      characters: worldChars,
      events: worldEvents,
      relations: worldRels,
    });
    const ok = await downloadTextFile(
      `${activeWorld.name}-设定集.md`,
      md,
      'text/markdown;charset=utf-8'
    );
    if (ok) {
      showToast('已导出设定集 Markdown', 'success');
    }
  };

  const handleDeleteWorld = () => {
    if (!activeWorld) return;
    setMenuOpen(false);
    if (worldChars.length > 0) {
      requestConfirm({
        title: '删除作品',
        message: `《${activeWorld.name}》下包含 ${worldChars.length} 张角色卡。删除作品时，这些角色卡要如何处理？`,
        secondaryLabel: '保留角色为独立角色',
        onSecondary: async () => {
          await deleteWorld(activeWorld.id, { keepCharacters: true });
          showToast('作品已删除，角色已保留至独立角色库');
        },
        confirmLabel: '连同角色一起删除',
        onConfirm: async () => {
          await deleteWorld(activeWorld.id, { keepCharacters: false });
          showToast('作品与角色已删除');
        },
      });
      return;
    }

    requestConfirm({
      title: '删除作品',
      message: `确定要删除《${activeWorld.name}》吗？设定文档、跨时间关系与时间线将被永久删除，无法恢复。`,
      onConfirm: async () => {
        await deleteWorld(activeWorld.id, { keepCharacters: false });
        showToast('作品已删除');
      },
    });
  };

  if (creating || (worldStudioMode !== 'standalone_characters' && !activeWorld && worlds.length === 0)) {
    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-[18px] font-semibold text-ink">
                {worlds.length === 0 && !creating ? '创建你的第一部作品世界观' : '新建小说作品'}
              </h1>
              <p className="text-[13px] text-secondary mt-1">
                只需填好名称与题材，可选参考模板或直接导入你已有的设定文档。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!creating && (
                <button
                  type="button"
                  onClick={() => setWorldStudioMode('standalone_characters')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-line bg-card text-[13px] font-medium text-ink hover:border-accent cursor-pointer"
                >
                  <Users className="w-4 h-4 text-accent" />
                  <span>独立角色库 ({standaloneCharsCount})</span>
                </button>
              )}
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-accent/50 bg-accent-soft text-[13px] font-medium text-accent hover:opacity-90 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>导入已有设定</span>
              </button>
              {creating && (worlds.length > 0 || worldStudioMode === 'standalone_characters') && (
                <button
                  onClick={() => setCreating(false)}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl border border-line text-[13px] text-secondary hover:bg-hover cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>返回</span>
                </button>
              )}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-card border border-line space-y-5">
            <div>
              <label className="block mb-1.5 text-[13px] font-medium text-ink">作品名称 *</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：长夜余烬"
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block mb-2 text-[13px] font-medium text-ink">选择题材</label>
              <div className="flex flex-wrap gap-2">
                {WORLD_GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => handleGenrePick(g)}
                    className={`px-3.5 py-1.5 rounded-full text-[13px] border cursor-pointer transition ${
                      newGenre === g
                        ? 'bg-accent text-white border-transparent font-medium'
                        : 'border-line text-secondary hover:bg-hover hover:text-ink'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <label className="block text-[13px] font-medium text-ink">
                选择参考设定模板（可随意删改，或选空白自由书写）
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {WORLD_TEMPLATES.map((tpl) => {
                  const active = tpl.id === selectedTemplateId;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                        active
                          ? 'border-accent bg-accent-soft'
                          : 'border-line bg-canvas hover:bg-hover'
                      }`}
                    >
                      <div className="text-[13px] font-semibold text-ink">{tpl.name}</div>
                      <div className="text-[12px] text-dim mt-0.5 line-clamp-2">
                        {tpl.description}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="p-3.5 rounded-xl bg-muted border border-line space-y-1.5">
                <div className="text-[12px] font-medium text-secondary">
                  模板包含 {templateHeadings.length} 个参考章节：
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {templateHeadings.map((h) => (
                    <span
                      key={h.heading}
                      className="text-[11px] px-2 py-0.5 rounded-md bg-card border border-line text-secondary"
                    >
                      {h.heading}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {creating && worlds.length > 0 && (
                <button
                  onClick={() => setCreating(false)}
                  className="px-4 py-2 rounded-xl text-[13px] border border-line text-secondary cursor-pointer"
                >
                  取消
                </button>
              )}
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="px-5 py-2.5 rounded-xl text-[14px] font-medium bg-accent text-white disabled:opacity-40 hover:opacity-95 cursor-pointer"
              >
                创建并进入设定编辑
              </button>
            </div>
          </div>
        </div>

        <WorldImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      </div>
    );
  }

  const inStandaloneMode = worldStudioMode === 'standalone_characters';

  return (
    <div className="flex-1 flex flex-col min-h-0 p-2.5 md:p-5 gap-3">
      {/* Compact Studio Top Bar */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-line">
        <div className="relative min-w-0 flex-1">
          {!inStandaloneMode && renaming && activeWorld ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={async () => {
                setRenaming(false);
                if (renameValue.trim() && renameValue.trim() !== activeWorld.name) {
                  await updateWorld(activeWorld.id, { name: renameValue.trim() });
                  showToast('已修改作品名称');
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isImeComposing(e)) e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="w-full max-w-xs px-3 py-1.5 rounded-xl bg-card border border-accent text-[14px] font-semibold text-ink outline-none"
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => setWorldPickerOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card border border-line hover:border-accent text-[13.5px] font-semibold text-ink max-w-full cursor-pointer transition"
              >
                {inStandaloneMode ? (
                  <>
                    <Users className="w-3.5 h-3.5 text-accent shrink-0" />
                    <span className="truncate">独立角色库</span>
                    <span className="text-[11px] font-normal px-1.5 py-0.5 rounded bg-muted text-secondary shrink-0">
                      {standaloneCharsCount} 人
                    </span>
                  </>
                ) : activeWorld ? (
                  <>
                    <span className="truncate">《{activeWorld.name}》</span>
                    <span className="text-[11px] font-normal px-1.5 py-0.5 rounded bg-muted text-secondary shrink-0">
                      {activeWorld.genre}
                    </span>
                  </>
                ) : (
                  <span>选择作品或独立角色库</span>
                )}
                <ChevronDown className="w-3.5 h-3.5 text-dim shrink-0" />
              </button>

              {worldPickerOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setWorldPickerOpen(false)} />
                  <div className="absolute left-0 top-full mt-1.5 z-40 w-64 max-w-[85vw] rounded-2xl bg-card border border-line shadow-xl overflow-hidden text-[13px]">
                    <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setWorldStudioMode('standalone_characters');
                          setWorldPickerOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left cursor-pointer transition ${
                          inStandaloneMode
                            ? 'bg-accent-soft text-accent font-medium'
                            : 'text-ink hover:bg-hover'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Users className="w-3.5 h-3.5 shrink-0" />
                          <span>独立角色库（不绑定作品）</span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] text-dim">{standaloneCharsCount}</span>
                          {inStandaloneMode && <Check className="w-3.5 h-3.5" />}
                        </span>
                      </button>

                      {worlds.length > 0 && <div className="my-1 border-t border-line/70" />}

                      {worlds.map((w) => {
                        const selected = !inStandaloneMode && w.id === activeWorld?.id;
                        return (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => {
                              selectWorld(w.id);
                              setWorldPickerOpen(false);
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left cursor-pointer transition ${
                              selected
                                ? 'bg-accent-soft text-accent font-medium'
                                : 'text-ink hover:bg-hover'
                            }`}
                          >
                            <span className="truncate">《{w.name}》</span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] text-dim">{w.genre}</span>
                              {selected && <Check className="w-3.5 h-3.5" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="p-1.5 border-t border-line bg-sidebar grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setWorldPickerOpen(false);
                          openCreator();
                        }}
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-card border border-line text-[12px] text-ink hover:border-accent cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 text-accent" />
                        <span>新建作品</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWorldPickerOpen(false);
                          setImportOpen(true);
                        }}
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-card border border-line text-[12px] text-ink hover:border-accent cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 text-accent" />
                        <span>导入设定</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {!inStandaloneMode && activeWorld && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => startNewDraft({ worldId: activeWorld.id })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12.5px] font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>开始创作</span>
            </button>

            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="p-2 rounded-xl border border-line bg-card text-secondary hover:bg-hover hover:text-ink cursor-pointer"
                title="作品操作"
                aria-label="作品操作"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-40 w-44 rounded-2xl bg-card border border-line shadow-xl py-1.5 text-[13px]">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        openCreator();
                      }}
                      className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-ink hover:bg-hover cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新建作品</span>
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setImportOpen(true);
                      }}
                      className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-ink hover:bg-hover cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>导入设定</span>
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setRenameValue(activeWorld.name);
                        setRenaming(true);
                      }}
                      className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-ink hover:bg-hover cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>重命名作品</span>
                    </button>
                    <button
                      onClick={handleExportMd}
                      className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-ink hover:bg-hover cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>导出设定集 (.md)</span>
                    </button>
                    <button
                      onClick={handleDeleteWorld}
                      className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-red-500 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>删除此作品</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content: Standalone Character Library or World Sub-Tabs */}
      {inStandaloneMode ? (
        <CharactersPanel key="standalone" worldId="" />
      ) : (
        activeWorld && (
        <>
          <div className="grid grid-cols-4 md:inline-grid md:grid-cols-4 gap-1 p-1 rounded-xl bg-muted border border-line shrink-0">
            {(
              [
                { id: 'doc', label: '设定', count: null, icon: FileText },
                { id: 'characters', label: '角色', count: worldChars.length, icon: Users },
                { id: 'timeline', label: '时间线', count: worldEvents.length, icon: Clock },
                { id: 'relations', label: '关系', count: worldRels.length, icon: GitBranch },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`flex items-center justify-center gap-1 px-2 md:px-3.5 py-1.5 rounded-lg text-[12px] md:text-[13px] font-medium transition cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-card text-accent shadow-xs'
                      : 'text-secondary hover:text-ink'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                  {item.count !== null && (
                    <span
                      className={`text-[10.5px] leading-tight px-1.5 py-0.5 rounded-full ${
                        active ? 'bg-accent-soft text-accent' : 'bg-canvas/70 text-dim'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {tab === 'doc' && <WorldDocEditor world={activeWorld} />}
          {tab === 'characters' && <CharactersPanel key={activeWorld.id} worldId={activeWorld.id} />}
          {tab === 'timeline' && <TimelinePanel key={activeWorld.id} worldId={activeWorld.id} />}
          {tab === 'relations' && <TemporalRelationGraph key={activeWorld.id} worldId={activeWorld.id} />}
        </>
      ))}

      <WorldImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        targetWorldId={activeWorld?.id}
      />
    </div>
  );
};
