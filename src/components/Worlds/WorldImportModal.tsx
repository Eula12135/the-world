import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import {
  extractWorldWithAI,
  materializeExtractedWorldEntities,
  normalizeTextToWorldMarkdown,
  readWorldSourceFile,
  type ExtractedWorldData,
} from '../../services/worldImport';
import { WORLD_GENRES } from '../../data/worldTemplates';
import { pushBackLayer } from '../../utils/backStack';
import { OptionPicker } from '../Common/OptionPicker';

interface WorldImportModalProps {
  open: boolean;
  onClose: () => void;
  targetWorldId?: string;
}

export const WorldImportModal: React.FC<WorldImportModalProps> = ({
  open,
  onClose,
  targetWorldId,
}) => {
  const {
    providers,
    settings,
    worlds,
    characters,
    timelineEvents,
    createWorld,
    appendWorldImportData,
    showToast,
  } = useAppStore(
    useShallow((s) => ({
      providers: s.providers,
      settings: s.settings,
      worlds: s.worlds,
      characters: s.characters,
      timelineEvents: s.timelineEvents,
      createWorld: s.createWorld,
      appendWorldImportData: s.appendWorldImportData,
      showToast: s.showToast,
    }))
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [titleInput, setTitleInput] = useState('');
  const [genreInput, setGenreInput] = useState('奇幻');
  const [rawText, setRawText] = useState('');
  const [detectedEncoding, setDetectedEncoding] = useState<string | null>(null);
  const [mode, setMode] = useState<'new' | 'merge'>(targetWorldId ? 'merge' : 'new');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [useAiSummaryDoc, setUseAiSummaryDoc] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedWorldData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const defaultReadyProvider = useMemo(
    () =>
      providers.find((p) => p.enabled && (!p.requiresKey || p.apiKey.trim().length > 0)) ||
      providers.find((p) => p.id === settings.defaultProviderId) ||
      providers[0],
    [providers, settings.defaultProviderId]
  );

  useEffect(() => {
    if (!open) return;
    return pushBackLayer(onClose);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setTitleInput('');
    setGenreInput('奇幻');
    setRawText('');
    setDetectedEncoding(null);
    setExtracted(null);
    setErrorMsg(null);
    setMode(targetWorldId ? 'merge' : 'new');
  }, [open, targetWorldId]);

  useEffect(() => {
    if (!open || !defaultReadyProvider) return;
    if (!selectedProviderId || !providers.some((p) => p.id === selectedProviderId)) {
      setSelectedProviderId(defaultReadyProvider.id);
      const nonReasoner = defaultReadyProvider.models.find(
        (m) => !/reasoner|\br1\b|^o[13]/i.test(m)
      );
      setSelectedModel(nonReasoner || defaultReadyProvider.selectedModel || defaultReadyProvider.models[0] || '');
    }
  }, [open, defaultReadyProvider, providers, selectedProviderId]);

  const activeProvider =
    providers.find((p) => p.id === selectedProviderId) || defaultReadyProvider;
  const activeModel =
    selectedModel || activeProvider?.selectedModel || activeProvider?.models[0] || '';
  const isReasoningSelected = /reasoner|\br1\b|^o[13]/i.test(activeModel);

  if (!open) return null;

  const targetWorld = targetWorldId ? worlds.find((w) => w.id === targetWorldId) : undefined;

  const handleFilePick = async (file: File) => {
    setErrorMsg(null);
    setExtracted(null);
    try {
      const { fileName, text, encoding } = await readWorldSourceFile(file);
      setRawText(text);
      setDetectedEncoding(encoding);
      if (!titleInput.trim()) {
        setTitleInput(fileName.replace(/\.(md|txt|docx|json)$/i, '').slice(0, 32));
      }
      showToast(`已读取「${fileName}」（${encoding} · ${text.length.toLocaleString()} 字）`, 'success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '读取文件失败');
    }
  };

  const handleInstantImport = async () => {
    if (!rawText.trim()) return;
    const formatted = normalizeTextToWorldMarkdown(rawText);
    if (mode === 'merge' && targetWorld) {
      await appendWorldImportData({
        worldId: targetWorld.id,
        document: formatted,
        mergeDocument: true,
        characters: [],
        events: [],
        relations: [],
      });
      showToast(`已将设定合并到《${targetWorld.name}》`, 'success');
    } else {
      const name = titleInput.trim() || '导入的世界观';
      await createWorld({ name, genre: genreInput, document: formatted });
      showToast(`已创建《${name}》`, 'success');
    }
    onClose();
  };

  const handleAiExtract = async () => {
    if (!rawText.trim() || !activeProvider) return;
    setExtracting(true);
    setErrorMsg(null);
    try {
      const res = await extractWorldWithAI({
        provider: activeProvider,
        model: activeModel,
        settings,
        rawText,
        hintName: titleInput.trim() || targetWorld?.name,
      });
      setExtracted(res);
      setUseAiSummaryDoc(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI 提取失败');
    } finally {
      setExtracting(false);
    }
  };

  const handleConfirmExtracted = async () => {
    if (!extracted) return;
    const chosenDoc =
      useAiSummaryDoc || !extracted.originalDocument
        ? extracted.document
        : extracted.originalDocument;

    let wid = targetWorld?.id;
    if (mode === 'new' || !wid) {
      wid = await createWorld({
        name: titleInput.trim() || extracted.name || '导入的作品',
        genre: extracted.genre || genreInput,
        document: chosenDoc,
      });
    }

    const existingChars =
      mode === 'merge' && targetWorld ? characters.filter((c) => c.worldId === targetWorld.id) : [];
    const existingEvents =
      mode === 'merge' && targetWorld
        ? timelineEvents.filter((e) => e.worldId === targetWorld.id)
        : [];

    const entities = materializeExtractedWorldEntities(
      wid,
      extracted,
      existingChars,
      existingEvents
    );
    await appendWorldImportData({
      worldId: wid,
      document: mode === 'merge' ? chosenDoc : undefined,
      mergeDocument: mode === 'merge',
      characters: entities.characters,
      events: entities.events,
      relations: entities.relations,
    });

    showToast(
      `导入完成：${entities.characters.length} 位角色 · ${entities.events.length} 个事件 · ${entities.relations.length} 条关系`,
      'success'
    );
    onClose();
  };

  return typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed inset-0 z-50 bg-[#111827]/45 flex items-center justify-center p-3 md:p-4 anim-overlay"
          onClick={onClose}
        >
      <div
        className="w-full max-w-2xl max-h-[88vh] rounded-xl bg-card border border-line shadow-2xl flex flex-col overflow-hidden anim-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" />
            <h2 className="text-[17px] font-semibold text-ink">导入已有设定文档 / 小说全文</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-[13px]">
          {targetWorld && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('merge')}
                className={`py-2 px-3 rounded-xl border text-left cursor-pointer ${
                  mode === 'merge'
                    ? 'bg-accent-soft border-accent text-accent font-medium'
                    : 'border-line text-secondary'
                }`}
              >
                合并导入到《{targetWorld.name}》
              </button>
              <button
                onClick={() => setMode('new')}
                className={`py-2 px-3 rounded-xl border text-left cursor-pointer ${
                  mode === 'new'
                    ? 'bg-accent-soft border-accent text-accent font-medium'
                    : 'border-line text-secondary'
                }`}
              >
                作为新作品导入
              </button>
            </div>
          )}

          {mode === 'new' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block mb-1 font-medium text-secondary">作品名称</label>
                <input
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="留空则自动根据文件名或 AI 提取"
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block mb-1 font-medium text-secondary">题材</label>
                <div className="flex flex-wrap gap-1.5">
                  {WORLD_GENRES.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGenreInput(g)}
                      className={`px-2.5 py-1 rounded-full border text-[13px] cursor-pointer ${
                        genreInput === g
                          ? 'bg-accent text-white border-transparent'
                          : 'border-line text-secondary'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="font-medium text-secondary">
                上传文件（支持 UTF-8 / GBK / GB18030 `.txt` `.md` `.docx`）或粘贴设定全文
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.docx,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFilePick(f);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted hover:bg-hover border border-line text-[13px] text-ink cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-accent" />
                <span>选择文件</span>
              </button>
            </div>

            <textarea
              rows={7}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setExtracted(null);
              }}
              placeholder="在这里粘贴你以前写好的大纲、人物表、世界观设定集或小说文本..."
              className="w-full p-3 rounded-xl bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
            />

            {rawText.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-dim">
                <span>
                  已载入 {rawText.length.toLocaleString()} 字
                  {detectedEncoding ? `（编码：${detectedEncoding}）` : ''}
                </span>
                {rawText.length > 42000 && (
                  <span className="px-2 py-0.5 rounded bg-amber-500/12 text-amber-500">
                    文本较长，AI 提取时将自动对前 / 中 / 后三段合计约 4.2 万字智能采样提炼
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Model selector for AI extraction */}
          {activeProvider && (
            <div className="p-3 rounded-xl bg-sidebar border border-line space-y-2">
              <div className="text-secondary font-medium text-[13px]">AI 提取模型</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <OptionPicker
                  compact
                  value={activeProvider.id}
                  items={providers.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(val) => {
                    const nextP = providers.find((p) => p.id === val);
                    if (nextP) {
                      setSelectedProviderId(nextP.id);
                      const nonReasoner = nextP.models.find(
                        (m) => !/reasoner|\br1\b|^o[13]/i.test(m)
                      );
                      setSelectedModel(
                        nonReasoner || nextP.selectedModel || nextP.models[0] || ''
                      );
                    }
                  }}
                />
                <OptionPicker
                  compact
                  value={activeModel}
                  items={activeProvider.models.map((m) => ({ value: m, label: m }))}
                  onChange={(val) => setSelectedModel(val)}
                  searchable={activeProvider.models.length > 8}
                  searchPlaceholder="搜索模型…"
                />
              </div>
              {isReasoningSelected && (
                <div className="flex items-center gap-1.5 text-[11.5px] text-amber-500">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    推理模型会先输出长段思考过程，做 JSON 抽取建议改用 deepseek-chat / 普通对话模型更稳定。
                  </span>
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="px-3.5 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-[13px]">
              {errorMsg}
            </div>
          )}

          {extracted && (
            <div className="p-4 rounded-xl bg-emerald-500/8 border border-emerald-500/30 space-y-2.5">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-500">
                <CheckCircle2 className="w-4 h-4" />
                <span>AI 提取完成：《{extracted.name}》（{extracted.genre}）</span>
              </div>
              <div className="text-[13px] text-secondary flex flex-wrap gap-3">
                <span>AI 提炼设定：{extracted.document.length} 字</span>
                <span>角色卡：{extracted.characters.length} 位</span>
                <span>时间线事件：{extracted.timelineEvents.length} 个</span>
                <span>跨时间关系：{extracted.relations.length} 条</span>
              </div>
              {extracted.characters.length > 0 && (
                <div className="text-[13px] text-dim">
                  识别角色：{extracted.characters.map((c) => c.name).join('、')}
                </div>
              )}

              {extracted.originalDocument && extracted.originalDocument.length > extracted.document.length && (
                <div className="flex flex-wrap gap-2 pt-1 text-[13px]">
                  <button
                    type="button"
                    onClick={() => setUseAiSummaryDoc(true)}
                    className={`px-2.5 py-1 rounded-lg border cursor-pointer ${
                      useAiSummaryDoc
                        ? 'border-accent bg-accent-soft text-accent font-medium'
                        : 'border-line text-secondary'
                    }`}
                  >
                    使用 AI 提炼的世界观摘要（推荐长篇小说）
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseAiSummaryDoc(false)}
                    className={`px-2.5 py-1 rounded-lg border cursor-pointer ${
                      !useAiSummaryDoc
                        ? 'border-accent bg-accent-soft text-accent font-medium'
                        : 'border-line text-secondary'
                    }`}
                  >
                    保留导入全文作为设定文档（{extracted.originalDocument.length.toLocaleString()} 字）
                  </button>
                </div>
              )}

              <button
                onClick={handleConfirmExtracted}
                className="w-full mt-2 py-2.5 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-500 cursor-pointer"
              >
                确认导入以上全部结构化设定
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-line">
            <button
              onClick={handleInstantImport}
              disabled={!rawText.trim()}
              className="px-4 py-2 rounded-xl border border-line text-ink hover:bg-hover disabled:opacity-40 cursor-pointer"
            >
              直接整理为设定文档（不耗 API）
            </button>
            <button
              onClick={handleAiExtract}
              disabled={!rawText.trim() || extracting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white font-medium disabled:opacity-40 hover:opacity-95 cursor-pointer"
            >
              {extracting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>AI 智能提取（文档 + 角色 + 时间线 + 关系）</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
    : null;
};
