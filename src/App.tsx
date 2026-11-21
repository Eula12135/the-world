import React, { useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { AppShell } from './components/Layout/AppShell';
import { ChatView } from './components/Chat/ChatView';
import { WorldsView } from './components/Worlds/WorldsView';
import { ProvidersModal } from './components/Modals/ProvidersModal';
import { DataTransferModal } from './components/Modals/DataTransferModal';
import { SettingsModal } from './components/Modals/SettingsModal';
import { ConfirmDialog } from './components/Common/ConfirmDialog';
import { ToastHost } from './components/Common/ToastHost';
import { checkForAppUpdate, DEFAULT_UPDATE_SOURCE } from './services/updateChecker';
import { openExternalUrl } from './utils/platform';

export const App: React.FC = () => {
  const { initialized, activeView, settings, updateNotice, setUpdateNotice, init } = useAppStore();

  useEffect(() => {
    init();
  }, [init]);

  // Silent update check if repo/manifest is configured or baked in
  useEffect(() => {
    const source = settings.updateRepo?.trim() || DEFAULT_UPDATE_SOURCE;
    if (!initialized || !settings.autoCheckUpdates || !source) return;
    checkForAppUpdate(source)
      .then((res) => {
        if (res.hasUpdate) setUpdateNotice(res);
      })
      .catch(() => {});
  }, [initialized, settings.autoCheckUpdates, settings.updateRepo, setUpdateNotice]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (dark: boolean) => {
      if (dark) root.classList.add('dark');
      else root.classList.remove('dark');
      try {
        window.TheWorldAndroid?.setTheme(dark);
      } catch {
        // Ignore bridge errors
      }
    };

    if (settings.theme === 'dark') {
      apply(true);
    } else if (settings.theme === 'light') {
      apply(false);
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [settings.theme]);

  if (!initialized) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-canvas text-secondary text-sm">
        正在初始化本地工作区...
      </div>
    );
  }

  return (
    <AppShell>
      {updateNotice?.hasUpdate && (
        <div className="px-4 py-2 bg-accent-soft border-b border-accent/30 flex items-center justify-between gap-2 text-[12px]">
          <span className="text-ink truncate">
            发现新版本 <strong>v{updateNotice.latestVersion}</strong>（当前 v
            {updateNotice.currentVersion}）
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => openExternalUrl(updateNotice.downloadUrl)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent text-white font-medium cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>下载更新</span>
            </button>
            <button
              onClick={() => setUpdateNotice(null)}
              className="p-1 text-dim hover:text-ink cursor-pointer"
              aria-label="关闭更新提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      {activeView === 'chat' ? <ChatView /> : <WorldsView />}
      <ProvidersModal />
      <DataTransferModal />
      <SettingsModal />
      <ConfirmDialog />
      <ToastHost />
    </AppShell>
  );
};

export default App;
