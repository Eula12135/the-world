import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, ExternalLink, Loader2, RotateCcw, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from './store/useAppStore';
import { AppShell } from './components/Layout/AppShell';
import { ChatView } from './components/Chat/ChatView';
import { ConfirmDialog } from './components/Common/ConfirmDialog';
import { ToastHost } from './components/Common/ToastHost';

const WorldsView = lazy(() =>
  import('./components/Worlds/WorldsView').then((m) => ({ default: m.WorldsView }))
);
const ProvidersModal = lazy(() =>
  import('./components/Modals/ProvidersModal').then((m) => ({ default: m.ProvidersModal }))
);
const DataTransferModal = lazy(() =>
  import('./components/Modals/DataTransferModal').then((m) => ({ default: m.DataTransferModal }))
);
const SettingsModal = lazy(() =>
  import('./components/Modals/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
import {
  type ApkUpdateProgress,
  canInAppAndroidUpdate,
  checkForAppUpdate,
  DEFAULT_UPDATE_SOURCE,
  startInAppAndroidUpdate,
} from './services/updateChecker';
import { openExternalUrl } from './utils/platform';

export const App: React.FC = () => {
  const {
    initialized,
    initError,
    activeView,
    activeModal,
    theme,
    autoCheckUpdates,
    updateRepo,
    updateNotice,
    setUpdateNotice,
    showToast,
    updateSettings,
    init,
  } = useAppStore(
    useShallow((s) => ({
      initialized: s.initialized,
      initError: s.initError,
      activeView: s.activeView,
      activeModal: s.activeModal,
      theme: s.settings.theme,
      autoCheckUpdates: s.settings.autoCheckUpdates,
      updateRepo: s.settings.updateRepo,
      updateNotice: s.updateNotice,
      setUpdateNotice: s.setUpdateNotice,
      showToast: s.showToast,
      updateSettings: s.updateSettings,
      init: s.init,
    }))
  );
  const [apkProgress, setApkProgress] = useState<ApkUpdateProgress | null>(null);
  const apkCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      apkCleanupRef.current?.();
      apkCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  // Silent update check if repo/manifest is configured or baked in
  useEffect(() => {
    const source = updateRepo?.trim() || DEFAULT_UPDATE_SOURCE;
    if (!initialized || !autoCheckUpdates || !source) return;
    checkForAppUpdate(source)
      .then((res) => {
        const latestIgnored = useAppStore.getState().settings.ignoredVersion;
        // 用户点过「忽略此版本」就不再对同一个版本重复提示；出现更高版本会重新提示
        if (res.hasUpdate && res.latestVersion !== latestIgnored) {
          setUpdateNotice(res);
        }
      })
      .catch(() => {});
  }, [initialized, autoCheckUpdates, updateRepo, setUpdateNotice]);

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

    if (theme === 'dark') {
      apply(true);
    } else if (theme === 'light') {
      apply(false);
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  if (initError) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-canvas text-ink p-4">
        <div className="max-w-md w-full rounded-2xl border border-line bg-card p-6 space-y-4 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-ink">本地工作区初始化失败</h2>
              <p className="text-[12.5px] text-secondary leading-relaxed">
                可能是本地存储权限受限或数据库版本迁移异常，请重试或重启应用。
              </p>
            </div>
          </div>
          <div className="rounded-xl bg-muted border border-line px-3 py-2 text-[12px] text-secondary font-mono break-all max-h-28 overflow-y-auto">
            {initError}
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3.5 py-2 rounded-xl text-[13px] border border-line text-secondary hover:bg-hover hover:text-ink transition cursor-pointer"
            >
              刷新页面
            </button>
            <button
              type="button"
              onClick={() => init()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium bg-accent text-white hover:opacity-95 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重试初始化</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-canvas text-secondary text-sm">
        正在初始化本地工作区...
      </div>
    );
  }

  return (
    <>
      <AppShell>
        {updateNotice?.hasUpdate && (
          <div className="px-4 py-2 bg-accent-soft border-b border-accent/30 flex items-center justify-between gap-2 text-[12px]">
            <span className="text-ink truncate">
              {apkProgress && apkProgress.status !== 'error' && apkProgress.message
                ? apkProgress.message
                : (
                  <>
                    发现新版本 <strong>v{updateNotice.latestVersion}</strong>（当前 v
                    {updateNotice.currentVersion}）
                  </>
                )}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {canInAppAndroidUpdate() && updateNotice.downloadUrl ? (
                <button
                  disabled={apkProgress?.status === 'downloading'}
                  onClick={() => {
                    apkCleanupRef.current?.();
                    setApkProgress({ status: 'downloading', progress: 0, message: '正在连接下载服务器...' });
                    apkCleanupRef.current = startInAppAndroidUpdate(updateNotice.downloadUrl, (ev) => {
                      setApkProgress(ev);
                      if (ev.status === 'error' && ev.message) {
                        showToast(ev.message, 'error');
                      }
                    });
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent text-white font-medium cursor-pointer disabled:opacity-60"
                >
                  {apkProgress?.status === 'downloading' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3" />
                  )}
                  <span>
                    {apkProgress?.status === 'downloading'
                      ? apkProgress.progress > 0
                        ? `下载中 ${apkProgress.progress}%`
                        : '下载中...'
                      : apkProgress?.status === 'permission'
                        ? '授权后自动安装'
                        : apkProgress?.status === 'installing'
                          ? '正在安装...'
                          : apkProgress?.status === 'error'
                            ? '重试更新'
                            : 'App 内一键更新'}
                  </span>
                </button>
              ) : (
                <>
                  {updateNotice.downloadUrl && (
                    <button
                      onClick={() => openExternalUrl(updateNotice.downloadUrl).catch(() => {})}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent text-white font-medium cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      <span>直接下载</span>
                    </button>
                  )}
                  <button
                    onClick={() =>
                      openExternalUrl(updateNotice.pageUrl || updateNotice.releaseUrl).catch(() => {})
                    }
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line text-ink font-medium cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>查看更新</span>
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  apkCleanupRef.current?.();
                  apkCleanupRef.current = null;
                  setApkProgress(null);
                  updateSettings({ ignoredVersion: updateNotice.latestVersion });
                  setUpdateNotice(null);
                }}
                className="px-1.5 py-1 text-[11.5px] text-dim hover:text-ink cursor-pointer shrink-0"
                aria-label="忽略此版本"
              >
                忽略此版本
              </button>
              <button
                onClick={() => {
                  apkCleanupRef.current?.();
                  apkCleanupRef.current = null;
                  setApkProgress(null);
                  setUpdateNotice(null);
                }}
                className="p-1 text-dim hover:text-ink cursor-pointer"
                aria-label="关闭更新提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        {activeView === 'chat' ? (
          <ChatView />
        ) : (
          <Suspense
            fallback={
              <div className="h-full w-full flex items-center justify-center bg-canvas text-secondary text-sm">
                正在加载世界观工坊...
              </div>
            }
          >
            <WorldsView />
          </Suspense>
        )}
      </AppShell>
      <Suspense fallback={null}>
        {activeModal === 'providers' && <ProvidersModal />}
        {activeModal === 'dataTransfer' && <DataTransferModal />}
        {activeModal === 'settings' && <SettingsModal />}
      </Suspense>
      <ConfirmDialog />
      <ToastHost />
    </>
  );
};

export default App;
