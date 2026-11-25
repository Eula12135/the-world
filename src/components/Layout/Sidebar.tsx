import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  BookOpen,
  Download,
  Edit3,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { pushBackLayer } from '../../utils/backStack';
import type { ChatSession } from '../../types';
import { db } from '../../db/database';
import { sessionToMarkdown } from '../../services/exportService';
import { downloadTextFile, isImeComposing, isProviderReady } from '../../utils/platform';

function groupSessions(sessions: ChatSession[]) {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayTs = startOfToday.getTime();
  const weekTs = todayTs - 7 * 24 * 3600 * 1000;

  const pinned: ChatSession[] = [];
  const today: ChatSession[] = [];
  const week: ChatSession[] = [];
  const older: ChatSession[] = [];

  for (const s of sessions) {
    if (s.pinned) pinned.push(s);
    else if (s.updatedAt >= todayTs && s.updatedAt <= now + 86400000) today.push(s);
    else if (s.updatedAt >= weekTs) week.push(s);
    else older.push(s);
  }

  return [
    { label: '置顶对话', items: pinned },
    { label: '今天', items: today },
    { label: '近 7 天', items: week },
    { label: '更早', items: older },
  ].filter((g) => g.items.length > 0);
}

export const Sidebar: React.FC = () => {
  const {
    sidebarOpen,
    setSidebarOpen,
    swipeOffset,
    sessions,
    activeSessionId,
    activeView,
    setActiveView,
    setActiveModal,
    selectSession,
    startNewDraft,
    updateSession,
    deleteSession,
    requestConfirm,
    showToast,
    providers,
    worlds,
    isStreaming,
    streamingSessionId,
  } = useAppStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      setSidebarOpen: s.setSidebarOpen,
      swipeOffset: s.swipeOffset,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      activeView: s.activeView,
      setActiveView: s.setActiveView,
      setActiveModal: s.setActiveModal,
      selectSession: s.selectSession,
      startNewDraft: s.startNewDraft,
      updateSession: s.updateSession,
      deleteSession: s.deleteSession,
      requestConfirm: s.requestConfirm,
      showToast: s.showToast,
      providers: s.providers,
      worlds: s.worlds,
      isStreaming: s.isStreaming,
      streamingSessionId: s.streamingSessionId,
    }))
  );

  const [query, setQuery] = useState('');
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const configuredCount = useMemo(
    () => providers.filter((p) => p.enabled && isProviderReady(p)).length,
    [providers]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  const groups = useMemo(() => groupSessions(filtered), [filtered]);

  // 手机端抽屉也算一层浮层：返回键先收抽屉，而不是直接退出 App
  const drawerOpen = sidebarOpen;
  // 右滑过程中还没「打开」，但抽屉要跟着手指走
  const drawerDragging = !sidebarOpen && swipeOffset > 0;
  useEffect(() => {
    if (!drawerOpen) return;
    if (typeof window === 'undefined' || window.innerWidth >= 768) return;
    return pushBackLayer(() => setSidebarOpen(false));
  }, [drawerOpen, setSidebarOpen]);

  const handleSelectSession = async (id: string) => {
    setMenuSessionId(null);
    await selectSession(id);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleNewChat = async () => {
    setMenuSessionId(null);
    await startNewDraft();
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleExportSession = async (s: ChatSession) => {
    setMenuSessionId(null);
    const msgs = await db.messages.where('sessionId').equals(s.id).sortBy('createdAt');
    const ok = await downloadTextFile(
      `${s.title}.md`,
      sessionToMarkdown(s, msgs, true),
      'text/markdown;charset=utf-8'
    );
    if (ok) {
      showToast('已导出对话 Markdown', 'success');
    }
  };

  const handleDeleteSession = (s: ChatSession) => {
    setMenuSessionId(null);
    requestConfirm({
      title: '删除对话',
      message: `确定要删除「${s.title}」吗？该对话中的所有消息将被永久移除且无法恢复。`,
      onConfirm: async () => {
        await deleteSession(s.id);
        showToast('对话已删除');
      },
    });
  };

  const commitRename = async (s: ChatSession) => {
    const next = renameText.trim();
    setRenamingId(null);
    if (next && next !== s.title) {
      await updateSession(s.id, { title: next });
      showToast('已重命名');
    }
  };

  return (
    <div className="flex h-full shrink-0">
      {/* Desktop Icon Rail */}
      <nav className="hidden md:flex flex-col items-center justify-between w-[60px] py-3 bg-sidebar border-r border-line shrink-0">
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => {
              setActiveView('chat');
              setSidebarOpen(true);
            }}
            className="w-9 h-9 rounded-xl bg-accent text-white font-bold text-sm flex items-center justify-center shadow-sm cursor-pointer"
            title="The World"
          >
            W
          </button>

          <button
            onClick={() => {
              setActiveView('chat');
              setSidebarOpen(true);
            }}
            className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium transition cursor-pointer ${
              activeView === 'chat'
                ? 'bg-accent-soft text-accent-strong'
                : 'text-secondary hover:bg-hover hover:text-ink'
            }`}
            title="对话"
          >
            <MessageSquare className="w-4 h-4" />
            <span>对话</span>
          </button>

          <button
            onClick={() => {
              setActiveView('worlds');
              if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false);
            }}
            className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium transition cursor-pointer ${
              activeView === 'worlds'
                ? 'bg-accent-soft text-accent-strong'
                : 'text-secondary hover:bg-hover hover:text-ink'
            }`}
            title="作品与世界观"
          >
            <BookOpen className="w-4 h-4" />
            <span>作品</span>
          </button>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            onClick={() => setActiveModal('dataTransfer')}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-secondary hover:bg-hover hover:text-ink cursor-pointer"
            title="导入 DeepSeek 记录与备份"
          >
            <Upload className="w-4.5 h-4.5" />
          </button>
          <button
            onClick={() => {
              setActiveModal('settings');
              if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false);
            }}
            className="relative w-10 h-10 rounded-xl flex items-center justify-center text-secondary hover:bg-hover hover:text-ink cursor-pointer"
            title="全局设置（含模型厂商与 API Key）"
          >
            <Settings className="w-4.5 h-4.5" />
            {configuredCount === 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400" />
            )}
          </button>
        </div>
      </nav>

      {/* Mobile Drawer Backdrop：拖动时跟着手指变浓 */}
      {(sidebarOpen || drawerDragging) && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          style={drawerDragging ? { opacity: Math.min(0.5, (swipeOffset / 288) * 0.5) } : undefined}
          onClick={() => {
            setMenuSessionId(null);
            setSidebarOpen(false);
          }}
        />
      )}

      {/* Session List Column (only shown in Chat view on Desktop, or as drawer on Mobile) */}
      {(activeView === 'chat' || sidebarOpen || drawerDragging) && (
        <aside
          style={
            drawerDragging
              ? { transform: `translateX(${Math.min(0, -288 + swipeOffset)}px)` }
              : undefined
          }
          className={`fixed md:static inset-y-0 left-0 z-40 flex flex-col w-72 md:w-[260px] bg-sidebar border-r border-line safe-top safe-bottom ${
            drawerDragging ? '' : 'transition-transform duration-200'
          } ${
            sidebarOpen
              ? activeView === 'chat'
                ? 'translate-x-0'
                : 'translate-x-0 md:hidden'
              : drawerDragging
                ? 'translate-x-0'
                : '-translate-x-full invisible md:visible md:hidden'
          }`}
        >
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-accent text-white font-bold text-xs flex items-center justify-center md:hidden">
                W
              </div>
              <span className="text-[15px] font-semibold text-ink">历史对话</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer"
              title="收起侧边栏"
            >
              <PanelLeftClose className="w-4 h-4 hidden md:block" />
              <X className="w-4 h-4 md:hidden" />
            </button>
          </div>

          <div className="px-3 space-y-2">
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-[13px] font-medium bg-accent text-white hover:opacity-95 shadow-sm transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>新对话</span>
            </button>

            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-canvas border border-line">
              <Search className="w-3.5 h-3.5 text-dim shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索对话..."
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-dim"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
            {groups.length === 0 ? (
              <div className="text-center py-10 px-4 text-[13px] text-dim leading-relaxed">
                暂无历史对话
                <br />
                点击「新对话」直接开聊，或导入 DeepSeek 聊天记录
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <div className="px-2.5 pb-1 text-[11.5px] font-medium text-dim">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((s) => {
                      const isActive = activeView === 'chat' && s.id === activeSessionId;
                      const isGenerating = isStreaming && streamingSessionId === s.id;
                      const menuOpen = menuSessionId === s.id;

                      return (
                        <div key={s.id} className="relative">
                          {renamingId === s.id ? (
                            <div className="px-2 py-1">
                              <input
                                autoFocus
                                value={renameText}
                                onChange={(e) => setRenameText(e.target.value)}
                                onBlur={() => commitRename(s)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !isImeComposing(e)) commitRename(s);
                                  if (e.key === 'Escape') setRenamingId(null);
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-accent text-[13px] text-ink outline-none"
                              />
                            </div>
                          ) : (
                            <div
                              onClick={() => handleSelectSession(s.id)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setMenuSessionId(menuOpen ? null : s.id);
                              }}
                              className={`flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-xl cursor-pointer transition ${
                                isActive
                                  ? 'bg-hover text-ink font-medium'
                                  : 'text-secondary hover:bg-hover/70 hover:text-ink'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isGenerating ? (
                                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                                ) : (
                                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-65" />
                                )}
                                <span className="truncate text-[13px]">{s.title}</span>
                                {s.importedFrom === 'deepseek' && (
                                  <span className="text-caption px-1 rounded bg-accent-soft text-accent-strong shrink-0">
                                    DS
                                  </span>
                                )}
                              </div>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenuSessionId(menuOpen ? null : s.id);
                                }}
                                className="p-1 rounded-lg text-dim hover:text-ink hover:bg-muted shrink-0 cursor-pointer"
                                title="对话操作"
                                aria-label="对话操作"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </div>
                          )}

                          {menuOpen && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setMenuSessionId(null)}
                              />
                              <div className="absolute right-1 top-9 z-50 w-40 rounded-xl bg-card border border-line shadow-xl py-1 text-[13px]">
                                <button
                                  onClick={async () => {
                                    setMenuSessionId(null);
                                    await updateSession(s.id, { pinned: !s.pinned });
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-ink hover:bg-hover cursor-pointer"
                                >
                                  {s.pinned ? (
                                    <PinOff className="w-3.5 h-3.5" />
                                  ) : (
                                    <Pin className="w-3.5 h-3.5" />
                                  )}
                                  <span>{s.pinned ? '取消置顶' : '置顶对话'}</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setMenuSessionId(null);
                                    setRenameText(s.title);
                                    setRenamingId(s.id);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-ink hover:bg-hover cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>重命名</span>
                                </button>
                                <button
                                  onClick={() => handleExportSession(s)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-ink hover:bg-hover cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>导出 Markdown</span>
                                </button>
                                <button
                                  onClick={() => handleDeleteSession(s)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-danger hover:bg-danger/10 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>删除对话</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Mobile quick access inside drawer */}
          <div className="p-3 border-t border-line space-y-1.5 md:hidden">
            <button
              onClick={() => {
                setSidebarOpen(false);
                setActiveView('worlds');
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-card border border-line text-[13px] text-ink cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-accent" />
                <span>作品与世界观工坊</span>
              </span>
              <span className="text-[13px] text-dim">{worlds.length} 部</span>
            </button>
            <button
              onClick={() => {
                setSidebarOpen(false);
                setActiveModal('dataTransfer');
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-control bg-card border border-line text-body text-secondary cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>导入 DeepSeek 记录 / 备份</span>
            </button>
            <button
              onClick={() => {
                setSidebarOpen(false);
                setActiveModal('settings');
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-control bg-card border border-line text-body text-secondary cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              <span>设置（模型 · 外观 · 语音）</span>
            </button>
          </div>
        </aside>
      )}
    </div>
  );
};
