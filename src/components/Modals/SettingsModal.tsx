import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ThemeMode } from '../../types';
import {
  type ApkUpdateProgress,
  APP_VERSION,
  canInAppAndroidUpdate,
  checkForAppUpdate,
  DEFAULT_UPDATE_SOURCE,
  startInAppAndroidUpdate,
  type UpdateCheckResult,
} from '../../services/updateChecker';
import { openExternalUrl } from '../../utils/platform';

const WORLD_CHAR_PRESETS = [
  { label: '3万字', value: 30000 },
  { label: '10万字(推荐)', value: 100000 },
  { label: '30万字', value: 300000 },
  { label: '不限制', value: 0 },
];

function formatCharLimitBadge(chars: number): string {
  if (chars === 0) return '不限制';
  if (chars >= 10000) {
    return `${Number((chars / 10000).toFixed(1))} 万字`;
  }
  return `${chars} 字`;
}

export const SettingsModal: React.FC = () => {
  const { activeModal, setActiveModal, settings, updateSettings, setUpdateNotice } = useAppStore(
    useShallow((s) => ({
      activeModal: s.activeModal,
      setActiveModal: s.setActiveModal,
      settings: s.settings,
      updateSettings: s.updateSettings,
      setUpdateNotice: s.setUpdateNotice,
    }))
  );
  const [desktopEncrypted, setDesktopEncrypted] = useState<boolean | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [apkProgress, setApkProgress] = useState<ApkUpdateProgress | null>(null);
  const [maxTokensText, setMaxTokensText] = useState(String(settings.maxTokens));
  const [contextLimitText, setContextLimitText] = useState(String(settings.contextMessagesLimit));
  const [showUpdateSourceAdv, setShowUpdateSourceAdv] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const apkCleanupRef = useRef<(() => void) | null>(null);

  const effectiveUpdateSource = (settings.updateRepo || '').trim() || DEFAULT_UPDATE_SOURCE;

  useEffect(() => {
    setMaxTokensText(String(settings.maxTokens));
  }, [settings.maxTokens, activeModal]);

  useEffect(() => {
    setContextLimitText(String(settings.contextMessagesLimit));
  }, [settings.contextMessagesLimit, activeModal]);

  useEffect(() => {
    return () => {
      apkCleanupRef.current?.();
      apkCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeModal !== 'settings') {
      apkCleanupRef.current?.();
      apkCleanupRef.current = null;
      setApkProgress(null);
      return;
    }
    setCheckErr(null);
    if (window.theWorldDesktop?.isEncryptionAvailable) {
      window.theWorldDesktop
        .isEncryptionAvailable()
        .then(setDesktopEncrypted)
        .catch(() => setDesktopEncrypted(false));
    } else {
      setDesktopEncrypted(null);
    }
  }, [activeModal]);

  if (activeModal !== 'settings') return null;

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setCheckErr(null);
    setCheckResult(null);
    try {
      const res = await checkForAppUpdate(effectiveUpdateSource);
      setCheckResult(res);
      if (res.hasUpdate) setUpdateNotice(res);
    } catch (err) {
      setCheckErr(err instanceof Error ? err.message : '检查更新失败');
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => setActiveModal('none')}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] rounded-xl bg-card border border-line shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
          <h2 className="text-[17px] font-semibold text-ink">应用设置</h2>
          <button
            onClick={() => setActiveModal('none')}
            className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 md:p-5 overflow-y-auto space-y-4 text-[13px]">
          {/* Card 1: Appearance & Model Parameters */}
          <section className="p-4 rounded-xl bg-sidebar border border-line space-y-4">
            <div className="text-[13px] font-semibold text-secondary">外观与对话参数</div>

            <div>
              <label className="block mb-2 font-medium text-ink">界面主题</label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'dark', label: '深色模式' },
                    { id: 'light', label: '浅色模式' },
                    { id: 'system', label: '跟随系统' },
                  ] as { id: ThemeMode; label: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => updateSettings({ theme: t.id })}
                    className={`py-2 rounded-xl border cursor-pointer transition ${
                      settings.theme === t.id
                        ? 'bg-accent-soft border-accent text-accent font-medium'
                        : 'bg-canvas border-line text-secondary hover:bg-hover'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block mb-1.5 font-medium text-ink">
                  Temperature ({settings.temperature})
                </label>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={settings.temperature}
                  onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
                  className="w-full accent-[#4d6bfe]"
                />
              </div>

              <div>
                <label className="block mb-1.5 font-medium text-ink">Max Tokens</label>
                <input
                  type="number"
                  min={256}
                  max={65536}
                  value={maxTokensText}
                  onChange={(e) => setMaxTokensText(e.target.value)}
                  onBlur={() => {
                    const parsed = Math.round(Number(maxTokensText));
                    const clamped = Number.isFinite(parsed)
                      ? Math.min(65536, Math.max(256, parsed))
                      : 4096;
                    setMaxTokensText(String(clamped));
                    updateSettings({ maxTokens: clamped });
                  }}
                  className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block mb-1.5 font-medium text-ink">携带历史对话条数上限</label>
                <input
                  type="number"
                  min={2}
                  max={500}
                  value={contextLimitText}
                  onChange={(e) => setContextLimitText(e.target.value)}
                  onBlur={() => {
                    const parsed = Math.round(Number(contextLimitText));
                    const clamped = Number.isFinite(parsed)
                      ? Math.min(500, Math.max(2, parsed))
                      : 20;
                    setContextLimitText(String(clamped));
                    updateSettings({ contextMessagesLimit: clamped });
                  }}
                  className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <label className="font-medium text-ink">作品设定字数上限</label>
                  <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-accent-soft text-accent font-medium">
                    {formatCharLimitBadge(settings.maxWorldContextChars)}
                  </span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={2000000}
                  step={10000}
                  value={settings.maxWorldContextChars}
                  onChange={(e) => {
                    if (e.target.value === '') {
                      updateSettings({ maxWorldContextChars: 0 });
                      return;
                    }
                    const parsed = Math.round(Number(e.target.value));
                    if (!Number.isFinite(parsed) || parsed <= 0) {
                      updateSettings({ maxWorldContextChars: 0 });
                    } else {
                      updateSettings({ maxWorldContextChars: Math.min(2000000, parsed) });
                    }
                  }}
                  onBlur={() => {
                    if (settings.maxWorldContextChars > 0 && settings.maxWorldContextChars < 1000) {
                      updateSettings({ maxWorldContextChars: 1000 });
                    }
                  }}
                  className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {WORLD_CHAR_PRESETS.map((preset) => {
                    const active = settings.maxWorldContextChars === preset.value;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => updateSettings({ maxWorldContextChars: preset.value })}
                        className={`px-2 py-0.5 rounded-lg border text-[11.5px] cursor-pointer transition ${
                          active
                            ? 'border-accent bg-accent-soft text-accent font-medium'
                            : 'border-line bg-canvas text-secondary hover:bg-hover'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Global System Prompt */}
          <section className="p-4 rounded-xl bg-sidebar border border-line space-y-2">
            <label className="block text-[13px] font-semibold text-secondary">
              全局系统提示词 (System Prompt)
            </label>
            <textarea
              rows={3}
              value={settings.globalSystemPrompt}
              onChange={(e) => updateSettings({ globalSystemPrompt: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
            />
          </section>

          {/* Card 3: Version & Updates */}
          <section className="p-4 rounded-xl bg-sidebar border border-line space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink">版本与更新</span>
                <span className="text-[13px] font-mono px-2 py-0.5 rounded-lg bg-canvas border border-line text-secondary">
                  v{APP_VERSION}
                </span>
              </div>
              <button
                onClick={handleCheckUpdate}
                disabled={checkingUpdate || !effectiveUpdateSource}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-[13px] font-medium disabled:opacity-40 cursor-pointer shrink-0"
              >
                {checkingUpdate ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>检查更新</span>
              </button>
            </div>

            <label className="flex items-center gap-2 text-[13px] text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoCheckUpdates}
                onChange={(e) => updateSettings({ autoCheckUpdates: e.target.checked })}
                className="accent-[var(--accent)]"
              />
              <span>启动时自动检测更新源新版本</span>
            </label>

            {checkErr && <div className="text-[13px] text-red-500">{checkErr}</div>}

            {checkResult && (
              <div className="p-3 rounded-xl bg-canvas border border-line space-y-1.5 text-[13px]">
                {checkResult.hasUpdate ? (
                  <>
                    <div className="font-semibold text-emerald-500">
                      发现新版本 v{checkResult.latestVersion}！
                    </div>
                    {checkResult.releaseNotes && (
                      <div className="text-secondary whitespace-pre-wrap line-clamp-3">
                        {checkResult.releaseNotes}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {canInAppAndroidUpdate() && checkResult.downloadUrl ? (
                        <button
                          disabled={apkProgress?.status === 'downloading'}
                          onClick={() => {
                            apkCleanupRef.current?.();
                            setApkProgress({
                              status: 'downloading',
                              progress: 0,
                              message: '正在连接下载服务器...',
                            });
                            apkCleanupRef.current = startInAppAndroidUpdate(
                              checkResult.downloadUrl,
                              (ev) => setApkProgress(ev)
                            );
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white font-medium cursor-pointer disabled:opacity-60"
                        >
                          {apkProgress?.status === 'downloading' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {apkProgress?.status === 'downloading'
                              ? apkProgress.progress > 0
                                ? `正在下载 ${apkProgress.progress}%`
                                : '正在下载...'
                              : apkProgress?.status === 'permission'
                                ? '授权后自动继续安装'
                                : apkProgress?.status === 'installing'
                                  ? '正在拉起系统安装...'
                                  : apkProgress?.status === 'error'
                                    ? '重试 App 内更新'
                                    : 'App 内一键下载并安装'}
                          </span>
                        </button>
                      ) : (
                        <>
                          {checkResult.downloadUrl && (
                            <button
                              onClick={() => openExternalUrl(checkResult.downloadUrl).catch(() => {})}
                              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-accent text-white cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>下载新版安装包</span>
                            </button>
                          )}
                          <button
                            onClick={() =>
                              openExternalUrl(checkResult.pageUrl || checkResult.releaseUrl).catch(
                                () => {}
                              )
                            }
                            className="flex items-center gap-1 px-3 py-1 rounded-lg border border-line text-secondary cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>查看详情</span>
                          </button>
                        </>
                      )}
                    </div>
                    {apkProgress && (
                      <div className="pt-1.5 space-y-1">
                        {apkProgress.status !== 'error' && (
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-accent transition-all duration-150"
                              style={{
                                width: `${Math.min(100, Math.max(4, apkProgress.progress))}%`,
                              }}
                            />
                          </div>
                        )}
                        <div
                          className={`text-[11.5px] ${
                            apkProgress.status === 'error' ? 'text-red-500' : 'text-secondary'
                          }`}
                        >
                          {apkProgress.message}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-secondary">
                    当前已是最新版本（最新构建：v{checkResult.latestVersion}）。
                  </div>
                )}
              </div>
            )}

            <div className="pt-1 border-t border-line/70">
              <button
                type="button"
                onClick={() => setShowUpdateSourceAdv((v) => !v)}
                className="flex items-center gap-1.5 text-[13px] text-dim hover:text-ink cursor-pointer"
              >
                {showUpdateSourceAdv ? (
                  <ChevronDown className="w-3.5 h-3.5 text-accent" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <span>自定义更新源（高级）</span>
                {DEFAULT_UPDATE_SOURCE && (
                  <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-500 font-medium">
                    已内置默认源
                  </span>
                )}
              </button>

              {showUpdateSourceAdv && (
                <div className="mt-2.5 space-y-2">
                  <input
                    value={settings.updateRepo || ''}
                    onChange={(e) => updateSettings({ updateRepo: e.target.value })}
                    placeholder={
                      DEFAULT_UPDATE_SOURCE
                        ? `默认：${DEFAULT_UPDATE_SOURCE}（可留空或自定义）`
                        : 'owner/the-world 或 gitee:owner/repo 或 latest.json 链接'
                    }
                    className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink text-[13px] font-mono outline-none focus:border-accent"
                  />
                  <div className="text-[11.5px] text-dim leading-relaxed space-y-0.5">
                    <div>支持多种更新源（空格或逗号分隔，按顺序优先尝试）：</div>
                    <div>
                      • GitHub：<code className="text-secondary">owner/the-world</code>
                      {'　'}· Gitee：<code className="text-secondary">gitee:owner/the-world</code>
                    </div>
                    <div>
                      • 静态清单 / 局域网：<code className="text-secondary">http://192.168.x.x:8787/latest.json</code>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Compact Accordion: Storage Security & MIT License */}
          <section className="rounded-xl bg-sidebar border border-line overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAbout((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-[13px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>安全存储与 MIT 开源声明</span>
              </span>
              {showAbout ? (
                <ChevronDown className="w-4 h-4 text-dim" />
              ) : (
                <ChevronRight className="w-4 h-4 text-dim" />
              )}
            </button>

            {showAbout && (
              <div className="px-4 pb-3.5 pt-2 border-t border-line space-y-2.5 text-[13px] text-secondary leading-relaxed">
                {desktopEncrypted !== null && (
                  <div className="p-2.5 rounded-xl bg-canvas border border-line flex items-center gap-2">
                    <Lock className="w-4 h-4 text-accent shrink-0" />
                    <span>
                      {desktopEncrypted
                        ? '桌面端密钥安全存储已启用（Electron safeStorage 系统级加密）'
                        : '当前系统安全密钥库不可用，API Key 仅保存在本机应用数据目录'}
                    </span>
                  </div>
                )}
                <p>
                  The World 是纯本地、无后端服务器的开源客户端工具（MIT License）。所有对话记录、API Key、作品世界观设定、角色卡与跨时间关系图均仅存储于你自己的设备中；本软件不提供大模型算力或内容托管。请自行遵守所接入模型厂商的服务条款及所在地法律法规。
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
