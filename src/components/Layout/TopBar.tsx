import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BookOpen, Menu, PanelLeftOpen, Plus, Upload } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ModelPicker } from '../Common/ModelPicker';

export const TopBar: React.FC = () => {
  const {
    sidebarOpen,
    setSidebarOpen,
    activeView,
    setActiveView,
    sessions,
    activeSessionId,
    draftConfig,
    updateDraftConfig,
    updateSession,
    startNewDraft,
    setActiveModal,
  } = useAppStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      setSidebarOpen: s.setSidebarOpen,
      activeView: s.activeView,
      setActiveView: s.setActiveView,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      draftConfig: s.draftConfig,
      updateDraftConfig: s.updateDraftConfig,
      updateSession: s.updateSession,
      startNewDraft: s.startNewDraft,
      setActiveModal: s.setActiveModal,
    }))
  );

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const currentProviderId = session ? session.providerId : draftConfig.providerId;
  const currentModel = session ? session.model : draftConfig.model;

  const handleModelSelect = async (pid: string, model: string) => {
    if (session) {
      await updateSession(session.id, { providerId: pid, model });
    } else {
      updateDraftConfig({ providerId: pid, model });
    }
  };

  return (
    <header className="shrink-0 bg-canvas/95 backdrop-blur-md border-b border-line safe-top">
      <div className="h-14 flex items-center justify-between gap-2 px-3 md:px-5">
        {/* Left action */}
        <div className="flex items-center gap-2 min-w-0">
          {activeView === 'chat' ? (
            <>
              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="p-2 rounded-xl bg-muted hover:bg-hover text-secondary hover:text-ink transition cursor-pointer"
                  title="展开历史对话"
                  aria-label="展开历史对话"
                >
                  <PanelLeftOpen className="w-4 h-4 hidden md:block" />
                  <Menu className="w-4 h-4 md:hidden" />
                </button>
              )}
              {sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="p-2 rounded-xl bg-muted text-secondary md:hidden cursor-pointer"
                  aria-label="打开历史对话"
                >
                  <Menu className="w-4 h-4" />
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-accent shrink-0" />
              <span className="text-[16px] font-semibold text-ink">作品与世界观</span>
            </div>
          )}
        </div>

        {/* Center pill in Chat view */}
        {activeView === 'chat' && (
          <div className="flex-1 flex justify-center min-w-0">
            <ModelPicker
              providerId={currentProviderId}
              model={currentModel}
              onSelect={handleModelSelect}
            />
          </div>
        )}

        {/* Right action */}
        <div className="flex items-center gap-2 shrink-0">
          {activeView === 'chat' ? (
            <>
              <button
                onClick={() => startNewDraft()}
                className="p-2 rounded-xl bg-muted hover:bg-hover text-secondary hover:text-ink transition md:hidden cursor-pointer"
                title="新对话"
                aria-label="新对话"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveModal('dataTransfer')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line text-[13px] text-secondary hover:bg-hover hover:text-ink transition cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>导入 / 备份</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => setActiveView('chat')}
              className="hidden md:inline-flex px-3 py-1.5 rounded-xl border border-line text-[13px] text-secondary hover:bg-hover hover:text-ink transition cursor-pointer"
            >
              返回对话
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
