import React, { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SwipeNavigator } from './SwipeNavigator';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const setSidebarOpen = useAppStore(useShallow((s) => s.setSidebarOpen));

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
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <SwipeNavigator>{children}</SwipeNavigator>
        </main>
      </div>
    </div>
  );
};
