import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2, Lock, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ThemeMode } from '../../types';
import {
  APP_VERSION,
  checkForAppUpdate,
  DEFAULT_UPDATE_SOURCE,
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
  const { activeModal, setActiveModal, settings, updateSettings, setUpdateNotice } = useAppStore();
  const [desktopEncrypted, setDesktopEncrypted] = useState<boolean | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);

  const effectiveUpdateSource = (settings.updateRepo || '').trim() || DEFAULT_UPDATE_SOURCE;

  useEffect(() => {
    if (activeModal !== 'settings') return;
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
        className="w-full max-w-lg max-h-[88vh] rounded-2xl bg-card border border-line shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h2 className="text-[16px] font-semibold text-ink">全局设置与开源声明</h2>
          <button
            onClick={() => setActiveModal('none')}
            className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-[13px]">
          <div>
            <label className="block mb-2 font-medium text-ink">界面外观主题</label>
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

          <div className="grid grid-cols-2 gap-3">
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
                value={settings.maxTokens}
                onChange={(e) =>
                  updateSettings({
                    maxTokens: Math.min(65536, Math.max(256, Number(e.target.value) || 4096)),
                  })
                }
                className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1.5 font-medium text-ink">携带历史对话条数上限</label>
              <input
                type="number"
                min={2}
                max={500}
                value={settings.contextMessagesLimit}
                onChange={(e) =>
                  updateSettings({
                    contextMessagesLimit: Math.min(500, Math.max(2, Number(e.target.value) || 20)),
                  })
                }
                className="w-full px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <label className="font-medium text-ink">作品设定字数上限</label>
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent-soft text-accent font-medium">
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
                      className={`px-2 py-0.5 rounded-lg border text-[11px] cursor-pointer transition ${
                        active
                          ? 'border-accent bg-accent-soft text-accent font-medium'
                          : 'border-line text-secondary hover:bg-hover'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className="block mb-1.5 font-medium text-ink">全局系统提示词 (System Prompt)</label>
            <textarea
              rows={3}
              value={settings.globalSystemPrompt}
              onChange={(e) => updateSettings({ globalSystemPrompt: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
            />
          </div>

          {/* Version & Multi-Source Updates */}
          <div className="p-3.5 rounded-xl bg-sidebar border border-line space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink">版本与更新检测</span>
                {DEFAULT_UPDATE_SOURCE && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-500 font-medium">
                    已内置默认源
                  </span>
                )}
              </div>
              <span className="text-[12px] font-mono px-2 py-0.5 rounded bg-muted text-secondary shrink-0">
                当前 v{APP_VERSION}
              </span>
            </div>

            <div className="flex gap-2">
              <input
                value={settings.updateRepo || ''}
                onChange={(e) => updateSettings({ updateRepo: e.target.value })}
                placeholder={
                  DEFAULT_UPDATE_SOURCE
                    ? `默认：${DEFAULT_UPDATE_SOURCE}（可留空或自定义）`
                    : 'owner/the-world 或 gitee:owner/repo 或 latest.json 链接'
                }
                className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-canvas border border-line text-ink text-[12px] font-mono outline-none focus:border-accent"
              />
              <button
                onClick={handleCheckUpdate}
                disabled={checkingUpdate || !effectiveUpdateSource}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent text-white text-[12px] font-medium disabled:opacity-40 cursor-pointer shrink-0"
              >
                {checkingUpdate ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>检查更新</span>
              </button>
            </div>

            <div className="text-[11px] text-dim leading-relaxed space-y-0.5">
              <div>支持三种零服务端更新源（自动匹配当前设备 `.apk` / `.exe`）：</div>
              <div>
                • GitHub：<code className="text-secondary">owner/the-world</code>
                {'　'}· Gitee 国内直连：<code className="text-secondary">gitee:owner/the-world</code>
              </div>
              <div>
                • 静态清单 / 局域网同步：<code className="text-secondary">http://192.168.x.x:8787/latest.json</code>
              </div>
            </div>

            <label className="flex items-center gap-2 text-[12px] text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoCheckUpdates}
                onChange={(e) => updateSettings({ autoCheckUpdates: e.target.checked })}
              />
              <span>启动时自动检测更新源新版本</span>
            </label>

            {checkErr && <div className="text-[12px] text-red-500">{checkErr}</div>}

            {checkResult && (
              <div className="p-2.5 rounded-xl bg-canvas border border-line space-y-1.5 text-[12px]">
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
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => openExternalUrl(checkResult.downloadUrl)}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg bg-accent text-white cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>下载新版安装包</span>
                      </button>
                      <button
                        onClick={() => openExternalUrl(checkResult.releaseUrl)}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg border border-line text-secondary cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>查看详情</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-secondary">
                    当前已是最新版本（最新构建：v{checkResult.latestVersion}）。
                  </div>
                )}
              </div>
            )}
          </div>

          {desktopEncrypted !== null && (
            <div className="p-3 rounded-xl bg-muted border border-line flex items-center gap-2 text-[12px] text-secondary">
              <Lock className="w-4 h-4 text-accent shrink-0" />
              <span>
                {desktopEncrypted
                  ? '桌面端密钥安全存储已启用（Electron safeStorage 系统级加密）'
                  : '当前系统安全密钥库不可用，API Key 仅保存在本机应用数据目录'}
              </span>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-emerald-500/8 border border-emerald-500/25 space-y-1.5">
            <div className="font-semibold flex items-center gap-1.5 text-emerald-500">
              <ShieldCheck className="w-4 h-4" />
              <span>纯本地开源框架声明（MIT License）</span>
            </div>
            <p className="text-[12px] text-secondary leading-relaxed">
              The World 是纯本地、无后端服务器的开源客户端工具。所有对话记录、API Key、作品世界观设定、角色卡与跨时间关系图均仅存储于你自己的设备中；本软件不提供大模型算力或内容托管。请自行遵守所接入模型厂商的服务条款及所在地法律法规。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
