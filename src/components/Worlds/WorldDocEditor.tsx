import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  LayoutList,
  List,
  Pin,
  Plus,
  Trash2,
} from 'lucide-react';
import type { WorldProject } from '../../types';
import {
  type EditableDocSection,
  parseDocumentSections,
  parseEditableSections,
  serializeEditableSections,
  WORLD_TEMPLATES,
} from '../../data/worldTemplates';
import { useAppStore } from '../../store/useAppStore';
import { createId, isImeComposing } from '../../utils/platform';

interface WorldDocEditorProps {
  world: WorldProject;
}

function getInitialExpandedIds(sections: EditableDocSection[]): Set<string> {
  if (sections.length === 0) return new Set();
  if (sections.length <= 2) return new Set(sections.map((s) => s.id));
  return new Set([sections[0].id]);
}

export const WorldDocEditor: React.FC<WorldDocEditorProps> = ({ world }) => {
  const { updateWorld, requestConfirm, showToast } = useAppStore();
  const [draft, setDraft] = useState(world.document);
  const [sections, setSections] = useState<EditableDocSection[]>(() =>
    parseEditableSections(world.document)
  );
  const [mode, setMode] = useState<'cards' | 'raw'>('cards');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    getInitialExpandedIds(parseEditableSections(world.document))
  );
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [insertOpen, setInsertOpen] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');

  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const bodyRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const focusedHeadingRef = useRef<Record<string, string>>({});

  const latestRef = useRef({
    worldId: world.id,
    draft: world.document,
    synced: world.document,
  });

  // Flush pending edits before switching world.id, then sync cleanly
  useEffect(() => {
    const prev = latestRef.current;
    if (prev.worldId !== world.id && prev.draft !== prev.synced) {
      void updateWorld(prev.worldId, { document: prev.draft });
    }
    const parsed = parseEditableSections(world.document);
    latestRef.current = {
      worldId: world.id,
      draft: world.document,
      synced: world.document,
    };
    setDraft(world.document);
    setSections(parsed);
    setExpandedIds(getInitialExpandedIds(parsed));
    setSaveState('saved');
    setInsertOpen(false);
    setNewSectionTitle('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id]);

  // Sync external updates (e.g. appended from Chat) if editor has no unsaved local changes
  useEffect(() => {
    const cur = latestRef.current;
    if (cur.worldId === world.id && world.document !== cur.synced) {
      if (cur.draft === cur.synced) {
        const parsed = parseEditableSections(world.document);
        cur.draft = world.document;
        cur.synced = world.document;
        setDraft(world.document);
        setSections(parsed);
        setExpandedIds((prev) => {
          if (parsed.length === 0) return new Set();
          if (prev.size === 0) return getInitialExpandedIds(parsed);
          return new Set(parsed.filter((s) => prev.has(s.id)).map((s) => s.id));
        });
        setSaveState('saved');
      } else {
        cur.synced = world.document;
      }
    }
  }, [world.id, world.document]);

  // Flush dirty doc on unmount
  useEffect(() => {
    return () => {
      const cur = latestRef.current;
      if (cur.draft !== cur.synced) {
        void updateWorld(cur.worldId, { document: cur.draft });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced auto-save
  useEffect(() => {
    latestRef.current.draft = draft;
    if (draft === latestRef.current.synced) return;
    setSaveState('saving');
    const targetWorldId = world.id;
    const docToSave = draft;
    const timer = window.setTimeout(async () => {
      await updateWorld(targetWorldId, { document: docToSave });
      if (latestRef.current.worldId === targetWorldId) {
        latestRef.current.synced = docToSave;
        if (latestRef.current.draft === docToSave) {
          setSaveState('saved');
        }
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, world.id, updateWorld]);

  const rawOutline = useMemo(() => parseDocumentSections(draft), [draft]);
  const outlineItems = useMemo(
    () =>
      mode === 'cards'
        ? sections.map((s, idx) => ({
            id: s.id,
            heading: s.heading.trim() || '未命名章节',
            charCount: s.body.replace(/\s+/g, '').length,
            lineStart: idx,
          }))
        : rawOutline.map((s, idx) => ({
            id: `raw-${idx}`,
            heading: s.heading,
            charCount: s.charCount,
            lineStart: s.lineStart,
          })),
    [mode, sections, rawOutline]
  );

  const charCount = useMemo(() => draft.replace(/\s+/g, '').length, [draft]);

  const templateSnippets = useMemo(() => {
    const tpl = WORLD_TEMPLATES.find((t) => t.genres.includes(world.genre)) || WORLD_TEMPLATES[0];
    return parseDocumentSections(tpl.document);
  }, [world.genre]);

  const existingHeadingSet = useMemo(
    () => new Set(sections.map((s) => s.heading.trim())),
    [sections]
  );

  const commitSections = (next: EditableDocSection[]) => {
    setSections(next);
    setDraft(serializeEditableSections(next));
  };

  const handleToggleMode = () => {
    if (mode === 'cards') {
      setMode('raw');
      return;
    }
    const parsed = parseEditableSections(draft);
    setSections(parsed);
    setExpandedIds((prev) => {
      if (parsed.length === 0) return new Set();
      if (prev.size === 0) return getInitialExpandedIds(parsed);
      const kept = parsed.filter((s) => prev.has(s.id)).map((s) => s.id);
      return kept.length > 0 ? new Set(kept) : getInitialExpandedIds(parsed);
    });
    setMode('cards');
  };

  const focusSectionCard = (id: string) => {
    setExpandedIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      bodyRefs.current[id]?.focus();
    }, 40);
  };

  const handleCreateSection = (heading: string, body = '') => {
    const cleanHeading = heading.trim() || `新章节 ${sections.length + 1}`;
    const baseSections = mode === 'raw' ? parseEditableSections(draft) : sections;
    const newSec: EditableDocSection = {
      id: createId('sec'),
      heading: cleanHeading,
      body,
      isPreamble: false,
    };
    const next = [...baseSections, newSec];
    setInsertOpen(false);
    setNewSectionTitle('');
    setMode('cards');
    commitSections(next);
    focusSectionCard(newSec.id);
    showToast(`已添加章节「${cleanHeading}」`, 'success');
  };

  const handleOutlineClick = (item: { id: string; lineStart: number }) => {
    if (mode === 'cards') {
      setExpandedIds((prev) => new Set(prev).add(item.id));
      setTimeout(() => {
        cardRefs.current[item.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 30);
      return;
    }
    setTimeout(() => {
      const el = rawTextareaRef.current;
      if (!el) return;
      const lines = draft.split('\n');
      const offset = lines.slice(0, item.lineStart).join('\n').length;
      el.focus();
      el.setSelectionRange(offset, offset);
      const ratio = item.lineStart / Math.max(1, lines.length);
      el.scrollTop = Math.max(0, ratio * el.scrollHeight - 40);
    }, 30);
  };

  const toggleCardExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allExpanded = sections.length > 0 && sections.every((s) => expandedIds.has(s.id));

  const handleToggleAllCards = () => {
    if (allExpanded) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(sections.map((s) => s.id)));
    }
  };

  const handleTogglePin = async (heading: string) => {
    const clean = heading.trim();
    if (!clean) return;
    const pinned = world.pinnedSections || [];
    const exists = pinned.includes(clean);
    const nextPinned = exists ? pinned.filter((h) => h !== clean) : [...pinned, clean];
    await updateWorld(world.id, { pinnedSections: nextPinned });
    showToast(exists ? `已取消「${clean}」常驻` : `已设「${clean}」为对话常驻章节`);
  };

  const handleHeadingBlur = async (sec: EditableDocSection) => {
    if (sec.isPreamble) return;
    const oldHeading = focusedHeadingRef.current[sec.id];
    delete focusedHeadingRef.current[sec.id];
    const nextHeading = sec.heading.trim() || '未命名章节';
    if (nextHeading !== sec.heading) {
      commitSections(sections.map((s) => (s.id === sec.id ? { ...s, heading: nextHeading } : s)));
    }
    if (oldHeading && oldHeading !== nextHeading && world.pinnedSections.includes(oldHeading)) {
      const nextPinned = Array.from(
        new Set(world.pinnedSections.map((h) => (h === oldHeading ? nextHeading : h)))
      );
      await updateWorld(world.id, { pinnedSections: nextPinned });
    }
  };

  const handleMoveSection = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    commitSections(next);
  };

  const handleDeleteSection = (sec: EditableDocSection) => {
    const performDelete = () => {
      commitSections(sections.filter((s) => s.id !== sec.id));
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(sec.id);
        return next;
      });
    };

    if (!sec.body.trim()) {
      performDelete();
      return;
    }

    requestConfirm({
      title: '删除章节',
      message: `确定要删除章节「${sec.heading || '未命名章节'}」及其正文内容吗？`,
      danger: true,
      onConfirm: performDelete,
    });
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 gap-3 md:gap-4">
      {/* Desktop Left TOC */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 rounded-2xl bg-sidebar border border-line p-3 overflow-y-auto">
        <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-line">
          <span className="text-[12px] font-semibold text-secondary flex items-center gap-1.5">
            <List className="w-3.5 h-3.5" />
            <span>章节目录 ({outlineItems.length})</span>
          </span>
        </div>

        {outlineItems.length === 0 ? (
          <div className="px-2 py-4 text-[12px] text-dim leading-relaxed">
            点击右侧「+ 新建章节」快速开始梳理设定
          </div>
        ) : (
          <div className="space-y-0.5">
            {outlineItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleOutlineClick(item)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-left text-[13px] text-secondary hover:bg-hover hover:text-ink transition cursor-pointer"
              >
                <span className="truncate">{item.heading}</span>
                <span className="text-[11px] text-dim shrink-0">{item.charCount}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Main Editor Column */}
      <div className="flex-1 flex flex-col min-h-0 rounded-2xl bg-card border border-line overflow-hidden">
        {/* Strict Single-Row Editor Toolbar */}
        <div className="flex items-center justify-between gap-2 px-3 md:px-4 py-2 border-b border-line bg-sidebar shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {mode === 'cards' ? (
              sections.length > 1 ? (
                <button
                  type="button"
                  onClick={handleToggleAllCards}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted border border-line text-[12px] text-secondary hover:text-ink whitespace-nowrap cursor-pointer"
                >
                  {allExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                  <span>{allExpanded ? '全部折叠' : `展开全部 (${sections.length})`}</span>
                </button>
              ) : (
                <span className="text-[12.5px] font-medium text-secondary whitespace-nowrap">
                  章节卡片 ({sections.length})
                </span>
              )
            ) : (
              <span className="text-[12.5px] font-medium text-secondary whitespace-nowrap">
                Markdown 原文
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* + New Chapter Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setInsertOpen((v) => !v)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-accent/35 bg-accent-soft text-[12px] font-medium text-accent hover:opacity-90 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>新建章节</span>
              </button>

              {insertOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setInsertOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-card border border-line shadow-2xl overflow-hidden text-[12.5px]">
                    <div className="p-3 border-b border-line space-y-2 bg-sidebar">
                      <div className="text-[11.5px] font-medium text-secondary">自定义新章节</div>
                      <div className="flex gap-1.5">
                        <input
                          autoFocus
                          value={newSectionTitle}
                          onChange={(e) => setNewSectionTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isImeComposing(e)) {
                              e.preventDefault();
                              handleCreateSection(newSectionTitle);
                            }
                            if (e.key === 'Escape') setInsertOpen(false);
                          }}
                          placeholder="输入章节名，如：力量体系..."
                          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => handleCreateSection(newSectionTitle)}
                          className="px-3 py-1.5 rounded-xl bg-accent text-white font-medium hover:opacity-95 shrink-0 cursor-pointer"
                        >
                          添加
                        </button>
                      </div>
                    </div>

                    <div className="p-1.5 max-h-60 overflow-y-auto space-y-0.5">
                      <div className="px-2.5 py-1 text-[11px] font-medium text-dim">
                        参考模板章节（点击插入）
                      </div>
                      {templateSnippets.map((sec) => {
                        const exists = existingHeadingSet.has(sec.heading.trim());
                        return (
                          <button
                            key={sec.heading}
                            type="button"
                            disabled={exists}
                            onClick={() => handleCreateSection(sec.heading, sec.body)}
                            className={`w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded-xl transition ${
                              exists
                                ? 'opacity-45 text-dim cursor-not-allowed'
                                : 'text-ink hover:bg-hover cursor-pointer'
                            }`}
                          >
                            <span className="truncate">{sec.heading}</span>
                            {exists && (
                              <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-muted text-dim shrink-0">
                                已有
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Single Mode Toggle Button */}
            <button
              type="button"
              onClick={handleToggleMode}
              className="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-line bg-canvas text-[12px] text-secondary hover:text-ink hover:bg-hover whitespace-nowrap cursor-pointer"
              title={mode === 'cards' ? '切换为整篇 Markdown 原文编辑' : '切换为章节卡片模式'}
            >
              {mode === 'cards' ? (
                <>
                  <Code2 className="w-3.5 h-3.5 shrink-0" />
                  <span>原文</span>
                </>
              ) : (
                <>
                  <LayoutList className="w-3.5 h-3.5 shrink-0" />
                  <span>卡片</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Area */}
        {mode === 'cards' ? (
          <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-3">
            {sections.length === 0 ? (
              <div className="py-12 px-4 text-center rounded-2xl border border-dashed border-line space-y-3">
                <div className="text-[14px] font-medium text-ink">还没有设定章节</div>
                <p className="text-[12px] text-dim max-w-md mx-auto">
                  每个章节都会自动参与对话时的渐进式披露，按需带入上下文、节省 Token。
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleCreateSection('一、世界设定')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white text-[12.5px] font-medium cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>新建第一个章节</span>
                  </button>
                </div>
                {templateSnippets.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1.5 pt-2">
                    {templateSnippets.slice(0, 4).map((sec) => (
                      <button
                        key={sec.heading}
                        type="button"
                        onClick={() => handleCreateSection(sec.heading, sec.body)}
                        className="px-2.5 py-1 rounded-full bg-sidebar border border-line text-[11.5px] text-secondary hover:border-accent hover:text-accent cursor-pointer"
                      >
                        + {sec.heading}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              sections.map((sec, idx) => {
                const isExpanded = expandedIds.has(sec.id);
                const bodyCharCount = sec.body.replace(/\s+/g, '').length;
                const isPinned =
                  !sec.isPreamble && world.pinnedSections.includes(sec.heading.trim());

                if (!isExpanded) {
                  return (
                    <div
                      key={sec.id}
                      ref={(el) => {
                        cardRefs.current[sec.id] = el;
                      }}
                      onClick={() => toggleCardExpanded(sec.id)}
                      className="rounded-2xl bg-sidebar border border-line hover:border-accent/40 px-3.5 py-2.5 transition cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <ChevronRight className="w-4 h-4 text-dim shrink-0" />
                          <span className="font-semibold text-[14px] text-ink truncate">
                            {sec.heading || '未命名章节'}
                          </span>
                          {isPinned && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent-soft text-accent text-[10.5px] font-medium shrink-0">
                              <Pin className="w-2.5 h-2.5" />
                              <span>常驻</span>
                            </span>
                          )}
                        </div>
                        <span className="text-[11.5px] text-dim shrink-0">{bodyCharCount} 字</span>
                      </div>
                      {sec.body.trim() && (
                        <div className="line-clamp-1 text-[12px] text-dim mt-1 pl-6">
                          {sec.body.trim()}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={sec.id}
                    ref={(el) => {
                      cardRefs.current[sec.id] = el;
                    }}
                    className="rounded-2xl bg-sidebar border border-line overflow-hidden transition"
                  >
                    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line/70">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleCardExpanded(sec.id)}
                          className="p-1 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer shrink-0"
                          title="折叠章节"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        {sec.isPreamble ? (
                          <span className="font-semibold text-[14px] text-secondary truncate px-1">
                            {sec.heading}
                          </span>
                        ) : (
                          <input
                            value={sec.heading}
                            onFocus={() => {
                              focusedHeadingRef.current[sec.id] = sec.heading.trim();
                            }}
                            onChange={(e) => {
                              const nextVal = e.target.value;
                              commitSections(
                                sections.map((s) =>
                                  s.id === sec.id ? { ...s, heading: nextVal } : s
                                )
                              );
                            }}
                            onBlur={() => void handleHeadingBlur(sec)}
                            placeholder="章节标题..."
                            className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-transparent hover:bg-canvas/50 focus:bg-canvas border border-transparent focus:border-accent text-[14px] font-semibold text-ink outline-none"
                          />
                        )}
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        {!sec.isPreamble && (
                          <button
                            type="button"
                            onClick={() => void handleTogglePin(sec.heading)}
                            className={`p-1.5 rounded-lg cursor-pointer transition ${
                              isPinned
                                ? 'text-accent bg-accent-soft'
                                : 'text-dim hover:text-ink hover:bg-hover'
                            }`}
                            title={isPinned ? '取消对话常驻章节' : '设为对话常驻章节'}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveSection(idx, -1)}
                          className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover disabled:opacity-30 cursor-pointer disabled:cursor-default"
                          title="上移"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === sections.length - 1}
                          onClick={() => handleMoveSection(idx, 1)}
                          className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover disabled:opacity-30 cursor-pointer disabled:cursor-default"
                          title="下移"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSection(sec)}
                          className="p-1.5 rounded-lg text-dim hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
                          title="删除章节"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="p-3">
                      <textarea
                        ref={(el) => {
                          bodyRefs.current[sec.id] = el;
                        }}
                        rows={Math.max(4, Math.min(14, sec.body.split('\n').length + 1))}
                        value={sec.body}
                        onChange={(e) => {
                          const nextBody = e.target.value;
                          commitSections(
                            sections.map((s) =>
                              s.id === sec.id ? { ...s, body: nextBody } : s
                            )
                          );
                        }}
                        placeholder="写下这一章节的设定内容..."
                        className="w-full bg-canvas/70 rounded-xl border border-line p-3 text-[14.5px] leading-7 text-ink outline-none focus:border-accent resize-y placeholder:text-dim"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <textarea
            ref={rawTextareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="在这里写下你的完整世界观设定。支持 Markdown，使用 ## 章节标题 可自动切分为章节卡片..."
            className="flex-1 w-full p-4 md:p-6 bg-transparent text-[15px] leading-7 text-ink outline-none resize-none font-sans placeholder:text-dim"
          />
        )}

        {/* Minimal Bottom Status Bar */}
        <div className="shrink-0 flex items-center justify-between px-3.5 py-1.5 border-t border-line bg-sidebar text-[11.5px] text-dim">
          <span>
            {charCount} 字 · {outlineItems.length} 节
          </span>
          {saveState === 'saving' ? (
            <span>保存中...</span>
          ) : (
            <span className="flex items-center gap-1 text-emerald-500">
              <Check className="w-3 h-3" />
              <span>已自动保存</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
