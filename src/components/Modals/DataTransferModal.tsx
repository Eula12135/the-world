import React, { useRef, useState } from 'react';
import {
  CheckSquare,
  Download,
  FileArchive,
  FileJson,
  FileText,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  materializeImportedSessions,
  parseDeepSeekArchive,
  type ParsedImportBundle,
} from '../../services/deepseekImport';
import {
  exportFullBackupJson,
  importFullBackupJson,
  sessionToMarkdown,
} from '../../services/exportService';
import { db } from '../../db/database';
import { downloadTextFile } from '../../utils/platform';

export const DataTransferModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    sessions,
    activeSessionId,
    messages,
    providers,
    settings,
    reloadAll,
    showToast,
  } = useAppStore();

  const dsFileRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);

  const [bundle, setBundle] = useState<ParsedImportBundle | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includeKeys, setIncludeKeys] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (activeModal !== 'dataTransfer') return null;

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const handleDeepSeekFile = async (file: File) => {
    setNotice(null);
    setBundle(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const existingSourceIds = new Set(
        sessions.map((s) => s.sourceId).filter((x): x is string => Boolean(x))
      );
      const parsed = await parseDeepSeekArchive(buf, file.name, existingSourceIds);
      setBundle(parsed);
      setSelectedIds(
        new Set(parsed.sessions.filter((s) => !s.isDuplicate).map((s) => s.sourceId))
      );
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : '解析 DeepSeek 导出包失败',
      });
    }
  };

  const handleConfirmImport = async () => {
    if (!bundle) return;
    const picked = bundle.sessions.filter((s) => selectedIds.has(s.sourceId));
    if (picked.length === 0) return;

    const defaultProvider =
      providers.find((p) => p.id === settings.defaultProviderId) || providers[0];
    const { sessions: newSessions, messages: newMessages } = materializeImportedSessions(
      picked,
      defaultProvider?.id || 'deepseek',
      defaultProvider?.selectedModel || 'deepseek-chat'
    );

    await db.transaction('rw', db.sessions, db.messages, async () => {
      await db.sessions.bulkPut(newSessions);
      await db.messages.bulkPut(newMessages);
    });
    await reloadAll();
    setBundle(null);
    setNotice({
      ok: true,
      text: `已成功导入 ${newSessions.length} 个会话（共 ${newMessages.length} 条消息）`,
    });
    showToast(`已导入 ${newSessions.length} 个 DeepSeek 对话`, 'success');
  };

  const handleExportCurrentMd = () => {
    if (!activeSession) return;
    const md = sessionToMarkdown(activeSession, messages, true);
    downloadTextFile(`${activeSession.title}.md`, md, 'text/markdown;charset=utf-8');
    showToast('已导出对话 Markdown', 'success');
  };

  const handleExportFullBackup = async () => {
    const json = await exportFullBackupJson(includeKeys);
    downloadTextFile(
      `the-world-backup-${new Date().toISOString().slice(0, 10)}.json`,
      json,
      'application/json;charset=utf-8'
    );
    setNotice({
      ok: true,
      text: includeKeys ? '已导出全量备份（含 API Key，请妥善保管）' : '已导出全量备份（已剔除 API Key）',
    });
  };

  const handleImportBackup = async (file: File) => {
    try {
      const text = await file.text();
      const res = await importFullBackupJson(text);
      await reloadAll();
      setNotice({
        ok: true,
        text: `备份恢复完成：${res.sessionsCount} 个会话，${res.worldsCount} 部作品`,
      });
      showToast('备份已恢复', 'success');
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : '备份恢复失败' });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-3 md:p-4"
      onClick={() => setActiveModal('none')}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] rounded-xl bg-card border border-line shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h2 className="text-[17px] font-semibold text-ink">DeepSeek 记录导入与数据备份</h2>
          <button
            onClick={() => setActiveModal('none')}
            className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-[13px]">
          {notice && (
            <div
              className={`px-3.5 py-2.5 rounded-xl border ${
                notice.ok
                  ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-500'
                  : 'bg-red-500/10 border-red-500/35 text-red-500'
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* DeepSeek Import */}
          <div className="p-4 rounded-xl bg-sidebar border border-line space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-[15px] text-ink">
                <FileArchive className="w-4 h-4 text-accent" />
                <span>导入 DeepSeek 聊天记录</span>
              </div>
              <span className="text-[13px] text-dim">支持官方 Export v3 .zip / .json</span>
            </div>

            <p className="text-secondary leading-relaxed">
              在 DeepSeek 网页或 App 中导出数据压缩包（例如 <code className="px-1 py-0.5 rounded bg-muted">deepseek_data-*.zip</code>），选择后即可完整还原历史对话、思考耗时与检索记录。
            </p>

            <input
              ref={dsFileRef}
              type="file"
              accept=".zip,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleDeepSeekFile(file);
                e.target.value = '';
              }}
            />

            <button
              onClick={() => dsFileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>选择 DeepSeek 导出文件 (.zip / .json)</span>
            </button>

            {bundle && (
              <div className="space-y-3 pt-3 border-t border-line">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-ink">
                    识别格式：{bundle.formatVersion} · 共 {bundle.sessions.length} 个会话
                  </span>
                  <button
                    onClick={() => {
                      if (selectedIds.size === bundle.sessions.length) {
                        setSelectedIds(new Set());
                      } else {
                        setSelectedIds(new Set(bundle.sessions.map((s) => s.sourceId)));
                      }
                    }}
                    className="text-accent hover:underline cursor-pointer"
                  >
                    {selectedIds.size === bundle.sessions.length ? '取消全选' : '全选'}
                  </button>
                </div>

                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {bundle.sessions.map((s) => {
                    const checked = selectedIds.has(s.sourceId);
                    return (
                      <div
                        key={s.sourceId}
                        onClick={() => {
                          const next = new Set(selectedIds);
                          if (checked) next.delete(s.sourceId);
                          else next.add(s.sourceId);
                          setSelectedIds(next);
                        }}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border cursor-pointer transition ${
                          checked
                            ? 'bg-accent-soft border-accent'
                            : 'bg-canvas border-line hover:bg-hover'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {checked ? (
                            <CheckSquare className="w-4 h-4 text-accent shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-dim shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink">{s.title}</div>
                            <div className="text-[11.5px] text-dim">
                              {s.messages.length} 条消息 · {s.thinkingCount} 段思考 ·{' '}
                              {new Date(s.updatedAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        {s.isDuplicate && (
                          <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 shrink-0">
                            已导入过
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={handleConfirmImport}
                  disabled={selectedIds.size === 0}
                  className="w-full py-2.5 rounded-xl font-medium bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer"
                >
                  确认导入选中的 {selectedIds.size} 个会话
                </button>
              </div>
            )}
          </div>

          {/* Backup & Export */}
          <div className="p-4 rounded-xl bg-sidebar border border-line space-y-3">
            <div className="font-semibold text-[15px] text-ink flex items-center gap-2">
              <FileJson className="w-4 h-4 text-accent" />
              <span>数据导出与跨设备迁移</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {activeSession && (
                <button
                  onClick={handleExportCurrentMd}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-line bg-canvas text-ink hover:bg-hover cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>导出当前对话 (.md)</span>
                </button>
              )}

              <button
                onClick={handleExportFullBackup}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-line bg-canvas text-ink hover:bg-hover cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>导出全量本地备份 (.json)</span>
              </button>

              <input
                ref={backupFileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportBackup(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => backupFileRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-line bg-canvas text-ink hover:bg-hover cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>从备份文件恢复</span>
              </button>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-[13px] text-secondary">
              <input
                type="checkbox"
                checked={includeKeys}
                onChange={(e) => setIncludeKeys(e.target.checked)}
              />
              <span>导出全量备份时包含我的 API Key（默认不导出以防密钥泄露）</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
