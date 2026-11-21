import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ChevronDown, Edit3, Eye, List, Plus } from 'lucide-react';
import type { WorldProject } from '../../types';
import { parseDocumentSections, WORLD_TEMPLATES } from '../../data/worldTemplates';
import { useAppStore } from '../../store/useAppStore';
import { openExternalUrl } from '../../utils/platform';

interface WorldDocEditorProps {
  world: WorldProject;
}

export const WorldDocEditor: React.FC<WorldDocEditorProps> = ({ world }) => {
  const { updateWorld, showToast } = useAppStore();
  const [draft, setDraft] = useState(world.document);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [tocOpenMobile, setTocOpenMobile] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    latestRef.current = {
      worldId: world.id,
      draft: world.document,
      synced: world.document,
    };
    setDraft(world.document);
    setSaveState('saved');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id]);

  // Sync external updates (e.g. appended from Chat) if editor has no unsaved local changes
  useEffect(() => {
    const cur = latestRef.current;
    if (cur.worldId === world.id && world.document !== cur.synced) {
      if (cur.draft === cur.synced) {
        cur.draft = world.document;
        cur.synced = world.document;
        setDraft(world.document);
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

  const sections = useMemo(() => parseDocumentSections(draft), [draft]);
  const charCount = useMemo(() => draft.replace(/\s+/g, '').length, [draft]);

  const jumpToSection = (lineStart: number) => {
    setTocOpenMobile(false);
    if (mode !== 'edit') {
      setMode('edit');
    }
    setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      const lines = draft.split('\n');
      const offset = lines.slice(0, lineStart).join('\n').length;
      el.focus();
      el.setSelectionRange(offset, offset);
      const ratio = lineStart / Math.max(1, lines.length);
      el.scrollTop = Math.max(0, ratio * el.scrollHeight - 40);
    }, 30);
  };

  const insertSectionSnippet = (heading: string, bodyHint: string) => {
    setInsertOpen(false);
    const snippet = `\n\n## ${heading}\n${bodyHint}\n`;
    const next = draft.trimEnd() + snippet;
    setDraft(next);
    showToast(`已插入章节「${heading}」`);
  };

  const templateSnippets = useMemo(() => {
    const tpl = WORLD_TEMPLATES.find((t) => t.genres.includes(world.genre)) || WORLD_TEMPLATES[0];
    return parseDocumentSections(tpl.document);
  }, [world.genre]);

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 gap-4">
      {/* Desktop Left TOC */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 rounded-2xl bg-sidebar border border-line p-3 overflow-y-auto">
        <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-line">
          <span className="text-[12px] font-semibold text-secondary flex items-center gap-1.5">
            <List className="w-3.5 h-3.5" />
            <span>章节目录 ({sections.length})</span>
          </span>
        </div>

        {sections.length === 0 ? (
          <div className="px-2 py-4 text-[12px] text-dim leading-relaxed">
            使用 <code className="px-1 py-0.5 rounded bg-muted">## 章节名</code> 即可自动生成目录与对话勾选单元
          </div>
        ) : (
          <div className="space-y-0.5">
            {sections.map((s, idx) => (
              <button
                key={`${s.heading}-${idx}`}
                onClick={() => jumpToSection(s.lineStart)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-left text-[13px] text-secondary hover:bg-hover hover:text-ink transition cursor-pointer"
              >
                <span className="truncate">{s.heading}</span>
                <span className="text-[11px] text-dim shrink-0">{s.charCount}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Main Editor Column */}
      <div className="flex-1 flex flex-col min-h-0 rounded-2xl bg-card border border-line overflow-hidden">
        {/* Editor Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 md:px-4 py-2.5 border-b border-line bg-sidebar">
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            {/* Mobile TOC Toggle */}
            <div className="relative md:hidden shrink-0">
              <button
                onClick={() => setTocOpenMobile((v) => !v)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted border border-line text-[12px] text-ink whitespace-nowrap shrink-0 cursor-pointer"
              >
                <List className="w-3.5 h-3.5 shrink-0" />
                <span>目录 ({sections.length})</span>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </button>
              {tocOpenMobile && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setTocOpenMobile(false)} />
                  <div className="absolute left-0 top-full mt-1 z-40 w-60 max-h-64 overflow-y-auto rounded-xl bg-card border border-line shadow-xl p-1.5 space-y-0.5">
                    {sections.length === 0 ? (
                      <div className="p-3 text-[12px] text-dim">用 ## 标题划分章节</div>
                    ) : (
                      sections.map((s, idx) => (
                        <button
                          key={`${s.heading}-${idx}`}
                          onClick={() => jumpToSection(s.lineStart)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-[12px] text-ink hover:bg-hover"
                        >
                          <span className="truncate">{s.heading}</span>
                          <span className="text-[11px] text-dim">{s.charCount}</span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="inline-flex rounded-xl bg-muted p-0.5 border border-line text-[12px] shrink-0">
              <button
                onClick={() => setMode('edit')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg whitespace-nowrap cursor-pointer transition ${
                  mode === 'edit' ? 'bg-card text-ink font-medium shadow-xs' : 'text-secondary'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5 shrink-0" />
                <span>编辑</span>
              </button>
              <button
                onClick={() => setMode('preview')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg whitespace-nowrap cursor-pointer transition ${
                  mode === 'preview' ? 'bg-card text-ink font-medium shadow-xs' : 'text-secondary'
                }`}
              >
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span>预览</span>
              </button>
            </div>

            <div className="relative shrink-0">
              <button
                onClick={() => setInsertOpen((v) => !v)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-line text-[12px] text-secondary hover:bg-hover hover:text-ink whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>插入章节</span>
              </button>
              {insertOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setInsertOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-40 w-64 max-h-72 overflow-y-auto rounded-xl bg-card border border-line shadow-xl p-1.5 space-y-0.5">
                    {templateSnippets.map((sec) => (
                      <button
                        key={sec.heading}
                        onClick={() => insertSectionSnippet(sec.heading, sec.body)}
                        className="w-full text-left px-3 py-1.5 rounded-lg text-[12px] text-ink hover:bg-hover cursor-pointer"
                      >
                        {sec.heading}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 text-[12px] text-dim">
            <span>{charCount} 字</span>
            <span className="flex items-center gap-1 text-emerald-500">
              {saveState === 'saving' ? (
                <span className="text-dim">保存中...</span>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>已自动保存</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Content Area */}
        {mode === 'edit' ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="在这里写下你的完整世界观设定。支持 Markdown，使用 ## 章节标题 可在对话时按节勾选带入..."
            className="flex-1 w-full p-4 md:p-6 bg-transparent text-[15px] leading-7 text-ink outline-none resize-none font-sans placeholder:text-dim"
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 markdown-body">
            {draft.trim() ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) => (/^(https?:|mailto:)/i.test(url) ? url : '')}
                components={{
                  a: ({ href, children, ...props }) => {
                    const safeHref = href && /^(https?:|mailto:)/i.test(href) ? href : undefined;
                    if (!safeHref) return <span>{children}</span>;
                    return (
                      <a
                        {...props}
                        href={safeHref}
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          openExternalUrl(safeHref).catch(() => {});
                        }}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {draft}
              </ReactMarkdown>
            ) : (
              <div className="text-dim text-[13px]">设定文档还是空的，切换到「编辑」开始书写。</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
