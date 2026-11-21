import React, { useEffect } from 'react';
import { BookOpen, KeyRound, MessageSquare, Settings } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useMobileKeyboardOpen } from '../../utils/keyboard';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SwipeNavigator } from './SwipeNavigator';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeView, activeModal, setActiveView, setActiveModal, setSidebarOpen, providers } =
    useAppStore();
  const keyboardOpen = useMobileKeyboardOpen();
  const readyCount = providers.filter(
    (p) => p.enabled && p.requiresKey && p.apiKey.trim().length > 0
  ).length;

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => {
      setSidebarOpen(e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setSidebarOpen]);

  return (
    <div className="h-full w-full flex overflow-hidden bg-canvas text-ink">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <TopBar />
        <main className="flex-1 flex flex-col min-h-0">
          <SwipeNavigator>{children}</SwipeNavigator>
        </main>

        {/* Mobile Bottom Tab Bar (hidden while IME keyboard is active so input stays unobstructed) */}
        {!keyboardOpen && (
          <nav
            data-testid="mobile-bottom-nav"
            className="md:hidden shrink-0 grid grid-cols-4 border-t border-line bg-sidebar safe-bottom"
          >
          <button
            onClick={() => {
              setActiveModal('none');
              setActiveView('chat');
            }}
            className={`flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] cursor-pointer ${
              activeView === 'chat' && activeModal === 'none'
                ? 'text-accent font-medium'
                : 'text-secondary'
            }`}
          >
            <MessageSquare className="w-4.5 h-4.5" />
            <span>对话</span>
          </button>

          <button
            onClick={() => {
              setActiveModal('none');
              setActiveView('worlds');
            }}
            className={`flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] cursor-pointer ${
              activeView === 'worlds' && activeModal === 'none'
                ? 'text-accent font-medium'
                : 'text-secondary'
            }`}
          >
            <BookOpen className="w-4.5 h-4.5" />
            <span>作品</span>
          </button>

          <button
            onClick={() => setActiveModal('providers')}
            className={`relative flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] cursor-pointer ${
              activeModal === 'providers' ? 'text-accent font-medium' : 'text-secondary'
            }`}
          >
            <div className="relative">
              <KeyRound className="w-4.5 h-4.5" />
              <span
                className={`absolute -top-0.5 -right-1 w-2 h-2 rounded-full ${
                  readyCount > 0 ? 'bg-emerald-500' : 'bg-amber-400'
                }`}
              />
            </div>
            <span>模型</span>
          </button>

          <button
            onClick={() => setActiveModal('settings')}
            className={`flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] cursor-pointer ${
              activeModal === 'settings' ? 'text-accent font-medium' : 'text-secondary'
            }`}
          >
            <Settings className="w-4.5 h-4.5" />
            <span>设置</span>
          </button>
        </nav>
        )}
      </div>
    </div>
  );
};
