import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Eye,
  Loader2,
  Pin,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { pushBackLayer } from '../../utils/backStack';
import { parseDocumentSections } from '../../data/worldTemplates';
import { buildSessionSystemPrompt } from '../../services/contextBuilder';
import { INITIAL_STORY_POINT, sortEventsChronologically } from '../../services/temporalGraph';

interface WorldContextPopoverProps {
  draftInput?: string;
}

export const WorldContextPopover: React.FC<WorldContextPopoverProps> = ({ draftInput = '' }) => {
  const {
    worlds,
    sessions,
    activeSessionId,
    draftConfig,
    updateDraftConfig,
    updateSession,
    updateWorld,
    characters,
    relations,
    timelineEvents,
    userPersonas,
    messages,
    isStreaming,
    settings,
    setActiveView,
    compressSessionMemory,
    showToast,
    setContextTokens,
  } = useAppStore(
    useShallow((s) => ({
      worlds: s.worlds,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      draftConfig: s.draftConfig,
      updateDraftConfig: s.updateDraftConfig,
      updateSession: s.updateSession,
      updateWorld: s.updateWorld,
      characters: s.characters,
      relations: s.relations,
      timelineEvents: s.timelineEvents,
      userPersonas: s.userPersonas,
      messages: s.messages,
      isStreaming: s.isStreaming,
      settings: s.settings,
      setActiveView: s.setActiveView,
      compressSessionMemory: s.compressSessionMemory,
      showToast: s.showToast,
      setContextTokens: s.setContextTokens,
    }))
  );

  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    return pushBackLayer(() => setOpen(false));
  }, [open]);
  const [tab, setTab] = useState<'world' | 'memory' | 'preview'>('world');
  const [compressing, setCompressing] = useState(false);

  // Debounce draftInput & pause heavy prompt recomputation per-token while streaming
  const [debouncedDraft, setDebouncedDraft] = useState(draftInput);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedDraft(draftInput), 220);
    return () => window.clearTimeout(timer);
  }, [draftInput]);

  const [evalMessages, setEvalMessages] = useState(messages);
  useEffect(() => {
    if (!isStreaming || open) {
      setEvalMessages(messages);
    }
  }, [isStreaming, open, messages]);

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const chatMode = (session ? session.chatMode : draftConfig.chatMode) || 'assistant';
  const roleCharacterId = session ? session.roleCharacterId : draftConfig.roleCharacterId;
  const rawWorldId = session ? session.worldId : draftConfig.worldId;
  const roleChar = roleCharacterId ? characters.find((c) => c.id === roleCharacterId) : undefined;
  const effectiveWorldId =
    rawWorldId || (chatMode === 'character_role' ? roleChar?.worldId : undefined);
  const enableWorldContext = session ? session.enableWorldContext : draftConfig.enableWorldContext;
  const storyPointEventId = session ? session.storyPointEventId : draftConfig.storyPointEventId;
  const boundWorld = effectiveWorldId
    ? worlds.find((w) => w.id === effectiveWorldId) ?? null
    : null;

  const worldChars = useMemo(
    () => (boundWorld ? characters.filter((c) => c.worldId === boundWorld.id) : []),
    [boundWorld, characters]
  );
  const worldRels = useMemo(
    () => (boundWorld ? relations.filter((r) => r.worldId === boundWorld.id) : []),
    [boundWorld, relations]
  );
  const worldEvents = useMemo(
    () =>
      boundWorld
        ? sortEventsChronologically(timelineEvents.filter((e) => e.worldId === boundWorld.id))
        : [],
    [boundWorld, timelineEvents]
  );
  const sections = useMemo(
    () => (boundWorld ? parseDocumentSections(boundWorld.document) : []),
    [boundWorld]
  );

  const unsummarizedCount = useMemo(() => {
    if (!session) return 0;
    const sumCount = session.rollingSummary ? session.summarizedCount || 0 : 0;
    return Math.max(0, messages.length - sumCount);
  }, [session, messages.length]);

  const isLongHistory = Boolean(session && unsummarizedCount > settings.contextMessagesLimit);

  const systemPromptOverride =
    (session ? session.systemPromptOverride : draftConfig.systemPromptOverride) || '';
  const effectiveChars = useMemo(() => {
    if (boundWorld) return worldChars;
    return roleChar ? [roleChar] : [];
  }, [boundWorld, worldChars, roleChar]);

  const built = useMemo(
    () =>
      buildSessionSystemPrompt({
        settings,
        session: {
          enableWorldContext: Boolean(boundWorld && enableWorldContext),
          storyPointEventId,
          rollingSummary: session?.rollingSummary,
          chatMode,
          roleCharacterId,
          // 与真实发送保持一致：预览里也要带上「我」的身份与关系覆盖
          userIdentity: session ? session.userIdentity : draftConfig.userIdentity,
          userRelationOverride: session
            ? session.userRelationOverride
            : draftConfig.userRelationOverride,
          systemPromptOverride,
        },
        world: boundWorld,
        characters: effectiveChars,
        relations: worldRels,
        events: worldEvents,
        personas: userPersonas,
        recentMessages: evalMessages,
        draftInput: debouncedDraft,
      }),
    [
      settings,
      boundWorld,
      enableWorldContext,
      storyPointEventId,
      session?.rollingSummary,
      chatMode,
      roleCharacterId,
      session?.userIdentity,
      session?.userRelationOverride,
      draftConfig.userIdentity,
      draftConfig.userRelationOverride,
      userPersonas,
      systemPromptOverride,
      effectiveChars,
      worldRels,
      worldEvents,
      evalMessages,
      debouncedDraft,
    ]
  );

  // 会话 token 估算写进 store，供消息操作行显示（不再单独占一行）
  useEffect(() => {
    setContextTokens(built ? built.stats.estimatedTokens : null);
  }, [built, setContextTokens]);

  const handleBindWorld = async (nextWorldId?: string) => {
    if (session) {
      await updateSession(session.id, {
        worldId: nextWorldId,
        enableWorldContext: Boolean(nextWorldId),
        storyPointEventId: undefined,
      });
    } else {
      updateDraftConfig({
        worldId: nextWorldId,
        enableWorldContext: Boolean(nextWorldId),
        storyPointEventId: undefined,
      });
    }
  };

  const handleStoryPointChange = async (eventId?: string) => {
    if (session) {
      await updateSession(session.id, { storyPointEventId: eventId });
    } else {
      updateDraftConfig({ storyPointEventId: eventId });
    }
  };

  const toggleSectionInFull = async (heading: string) => {
    if (!boundWorld) return;
    const allNames = sections.map((s) => s.heading);
    const current = boundWorld.selectedSections || [];
    const base = current.length === 0 ? allNames : current;
    const next = base.includes(heading)
      ? base.filter((h) => h !== heading)
      : [...base, heading];
    // `selectedSections: []` 的约定是「全部章节」，所以「一个都不选」无法表达。
    // 不拦住的话，用户取消最后一项会看到复选框全部重新勾上，像是点击无效。
    if (next.length === 0) {
      showToast('至少保留一个设定章节；若想完全不带入设定，请关闭上方的世界观上下文开关', 'info');
      return;
    }
    const normalized = next.length === allNames.length ? [] : next;
    await updateWorld(boundWorld.id, { selectedSections: normalized });
  };

  const togglePinnedSection = async (heading: string) => {
    if (!boundWorld) return;
    const cur = boundWorld.pinnedSections || [];
    const next = cur.includes(heading) ? cur.filter((h) => h !== heading) : [...cur, heading];
    await updateWorld(boundWorld.id, { pinnedSections: next });
  };

  const handleCompress = async () => {
    if (!session) return;
    setCompressing(true);
    try {
      await compressSessionMemory(session.id, 6);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '记忆压缩失败', 'error');
    } finally {
      setCompressing(false);
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 px-1 py-0.5 rounded-lg text-[12px] transition cursor-pointer ${
          boundWorld && enableWorldContext
            ? 'text-accent hover:text-accent'
            : 'text-dim hover:text-ink'
        }`}
      >
        <BookOpen className="w-3.5 h-3.5 shrink-0" />
        {boundWorld && enableWorldContext ? (
          <span className="truncate">
            《{boundWorld.name}》
            <span className="hidden sm:inline">
              · {boundWorld.contextMode === 'full' ? '全量' : '渐进披露'}
            </span>
          </span>
        ) : boundWorld ? (
          <span>已关联《{boundWorld.name}》（当前已暂停带入）</span>
        ) : (
          <span>关联作品设定与记忆</span>
        )}
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>

      {isLongHistory && (
        <button
          onClick={() => {
            setTab('memory');
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/12 text-amber-500 text-[11.5px] font-medium cursor-pointer"
        >
          <Sparkles className="w-3 h-3" />
          <span>对话较长 ({unsummarizedCount} 条)，建议压缩前情</span>
        </button>
      )}

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-end md:items-center justify-center p-0 md:p-4"
            onClick={() => setOpen(false)}
          >
          <div
            className="w-full md:max-w-xl rounded-t-2xl md:rounded-xl bg-card border border-line shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Tabs */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setTab('world')}
                  className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer ${
                    tab === 'world' ? 'bg-accent-soft text-accent' : 'text-secondary hover:bg-hover'
                  }`}
                >
                  世界观与时间点
                </button>
                <button
                  onClick={() => setTab('memory')}
                  className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer ${
                    tab === 'memory'
                      ? 'bg-accent-soft text-accent'
                      : 'text-secondary hover:bg-hover'
                  }`}
                >
                  前情摘要
                </button>
                <button
                  onClick={() => setTab('preview')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer ${
                    tab === 'preview'
                      ? 'bg-accent-soft text-accent'
                      : 'text-secondary hover:bg-hover'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>预览发给 AI</span>
                </button>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-dim hover:text-ink cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab 1: World & Anti-spoiler Timeline */}
            {tab === 'world' && (
              <div className="p-4 overflow-y-auto space-y-4 text-[13px]">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[13px] text-dim">
                    <span>选择关联作品</span>
                    <button
                      onClick={() => {
                        setOpen(false);
                        setActiveView('worlds');
                      }}
                      className="flex items-center gap-1 text-accent hover:underline cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>去作品工坊编辑</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => handleBindWorld(undefined)}
                      className={`px-3 py-1.5 rounded-xl border text-[13px] cursor-pointer ${
                        !boundWorld
                          ? 'bg-accent text-white border-transparent'
                          : 'border-line text-secondary hover:bg-hover'
                      }`}
                    >
                      不关联（纯对话）
                    </button>
                    {worlds.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => handleBindWorld(w.id)}
                        className={`px-3 py-1.5 rounded-xl border text-[13px] cursor-pointer ${
                          boundWorld?.id === w.id
                            ? 'bg-accent text-white border-transparent'
                            : 'border-line text-secondary hover:bg-hover'
                        }`}
                      >
                        《{w.name}》
                      </button>
                    ))}
                  </div>
                </div>

                {boundWorld && (
                  <>
                    <div className="flex items-center justify-between py-2 border-y border-line">
                      <span className="text-ink font-medium">在本次对话中带入设定</span>
                      <button
                        onClick={() =>
                          session
                            ? updateSession(session.id, { enableWorldContext: !enableWorldContext })
                            : updateDraftConfig({ enableWorldContext: !enableWorldContext })
                        }
                        className={`px-3 py-1 rounded-full text-[13px] font-medium cursor-pointer ${
                          enableWorldContext
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-muted text-dim'
                        }`}
                      >
                        {enableWorldContext ? '已开启' : '已暂停'}
                      </button>
                    </div>

                    {/* Context Mode */}
                    <div className="space-y-1.5">
                      <div className="text-[13px] text-dim">上下文加载模式</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => updateWorld(boundWorld.id, { contextMode: 'progressive' })}
                          className={`p-2.5 rounded-xl border text-left cursor-pointer ${
                            (boundWorld.contextMode || 'progressive') === 'progressive'
                              ? 'border-accent bg-accent-soft'
                              : 'border-line hover:bg-hover'
                          }`}
                        >
                          <div className="text-[13px] font-semibold text-ink">渐进式披露 (推荐)</div>
                          <div className="text-[11.5px] text-dim mt-0.5">
                            仅发目录索引 + 钉选章节 + 自动命中章节，省 Token 不易爆掉
                          </div>
                        </button>
                        <button
                          onClick={() => updateWorld(boundWorld.id, { contextMode: 'full' })}
                          className={`p-2.5 rounded-xl border text-left cursor-pointer ${
                            boundWorld.contextMode === 'full'
                              ? 'border-accent bg-accent-soft'
                              : 'border-line hover:bg-hover'
                          }`}
                        >
                          <div className="text-[13px] font-semibold text-ink">手动勾选全量</div>
                          <div className="text-[11.5px] text-dim mt-0.5">
                            将勾中的设定章节全部发给 AI（适合长上下文短设定）
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* Anti-spoiler story point */}
                    {worldEvents.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[13px] text-dim">
                          <Clock className="w-3.5 h-3.5" />
                          <span>当前创作所处时间点（防剧透 + 锁定该时刻人物关系）</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => handleStoryPointChange(undefined)}
                            className={`px-2.5 py-1 rounded-lg border text-[13px] cursor-pointer ${
                              !storyPointEventId
                                ? 'bg-accent text-white border-transparent'
                                : 'border-line text-secondary hover:bg-hover'
                            }`}
                          >
                            最新进度
                          </button>
                          <button
                            onClick={() => handleStoryPointChange(INITIAL_STORY_POINT)}
                            className={`px-2.5 py-1 rounded-lg border text-[13px] cursor-pointer ${
                              storyPointEventId === INITIAL_STORY_POINT
                                ? 'bg-accent text-white border-transparent'
                                : 'border-line text-secondary hover:bg-hover'
                            }`}
                          >
                            故事初始
                          </button>
                          {worldEvents.map((ev) => (
                            <button
                              key={ev.id}
                              onClick={() => handleStoryPointChange(ev.id)}
                              className={`px-2.5 py-1 rounded-lg border text-[13px] cursor-pointer ${
                                storyPointEventId === ev.id
                                  ? 'bg-accent text-white border-transparent'
                                  : 'border-line text-secondary hover:bg-hover'
                              }`}
                            >
                              {ev.timeLabel ? `${ev.timeLabel} · ` : ''}
                              {ev.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Sections list */}
                    {sections.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[13px] text-dim">
                          <span>
                            {boundWorld.contextMode === 'full'
                              ? '勾选要带入的设定章节'
                              : '钉选常驻章节（其余章节由渐进式披露按对话自动检索）'}
                          </span>
                        </div>
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                          {sections.map((sec) => {
                            const isFull = boundWorld.contextMode === 'full';
                            const checked = isFull
                              ? (boundWorld.selectedSections || []).length === 0 ||
                                (boundWorld.selectedSections || []).includes(sec.heading)
                              : (boundWorld.pinnedSections || []).includes(sec.heading);

                            return (
                              <button
                                key={sec.heading}
                                onClick={() =>
                                  isFull
                                    ? toggleSectionInFull(sec.heading)
                                    : togglePinnedSection(sec.heading)
                                }
                                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border text-left text-[13px] cursor-pointer ${
                                  checked
                                    ? 'border-accent/50 bg-accent-soft text-ink'
                                    : 'border-line text-dim hover:bg-hover'
                                }`}
                              >
                                <span className="flex items-center gap-2 truncate">
                                  {isFull ? (
                                    <span
                                      className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                                        checked ? 'bg-accent text-white' : 'border border-line'
                                      }`}
                                    >
                                      {checked && <Check className="w-3 h-3" />}
                                    </span>
                                  ) : (
                                    <Pin
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        checked ? 'text-accent' : 'opacity-40'
                                      }`}
                                    />
                                  )}
                                  <span className="truncate">{sec.heading}</span>
                                </span>
                                <span className="text-[11.5px] text-dim shrink-0">
                                  {sec.charCount} 字
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() =>
                          updateWorld(boundWorld.id, {
                            includeCharacters: !boundWorld.includeCharacters,
                          })
                        }
                        className={`px-3 py-2 rounded-xl border text-[13px] text-left cursor-pointer ${
                          boundWorld.includeCharacters
                            ? 'border-accent/50 bg-accent-soft text-ink'
                            : 'border-line text-dim'
                        }`}
                      >
                        附带角色卡：{boundWorld.includeCharacters ? '开' : '关'}
                      </button>
                      <button
                        onClick={() =>
                          updateWorld(boundWorld.id, {
                            includeTimeline: !boundWorld.includeTimeline,
                          })
                        }
                        className={`px-3 py-2 rounded-xl border text-[13px] text-left cursor-pointer ${
                          boundWorld.includeTimeline
                            ? 'border-accent/50 bg-accent-soft text-ink'
                            : 'border-line text-dim'
                        }`}
                      >
                        附带时间线：{boundWorld.includeTimeline ? '开' : '关'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Tab 2: Rolling Memory Summary */}
            {tab === 'memory' && (
              <div className="p-4 overflow-y-auto space-y-4 text-[13px]">
                {!session ? (
                  <div className="py-8 text-center text-dim">
                    发送第一条消息开始对话后，可在此管理和压缩早期对话记忆。
                  </div>
                ) : (
                  <>
                    <div className="p-3 rounded-xl bg-muted border border-line flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <div className="text-secondary">
                        当前总消息 <strong>{messages.length}</strong> 条 · 已归档前{' '}
                        <strong>{session.summarizedCount || 0}</strong> 条 · 保留最近{' '}
                        <strong>{unsummarizedCount}</strong> 条原文
                      </div>
                      <button
                        onClick={handleCompress}
                        disabled={compressing || messages.length <= 6}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white font-medium disabled:opacity-40 cursor-pointer"
                      >
                        {compressing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>用 AI 压缩早期对话</span>
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block font-medium text-secondary">
                        前情记忆摘要（发送消息时会自动带在系统提示中，你也可以手动微调）
                      </label>
                      <textarea
                        rows={7}
                        value={session.rollingSummary || ''}
                        onChange={(e) =>
                          updateSession(session.id, { rollingSummary: e.target.value })
                        }
                        placeholder="暂无前情摘要。当对话很长时点击上方「用 AI 压缩早期对话」，会自动浓缩早期的剧情决议、角色状态与伏笔。"
                        className="w-full p-3 rounded-xl bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Tab 3: Transparent Prompt Preview */}
            {tab === 'preview' && (
              <div className="p-4 overflow-y-auto space-y-3">
                <div className="flex flex-wrap gap-2 text-[13px] text-dim">
                  <span className="px-2 py-0.5 rounded bg-muted">
                    模式：{built.stats.mode === 'progressive' ? '渐进披露' : built.stats.mode === 'full' ? '全量' : '无'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-muted">
                    约 {built.stats.estimatedTokens} tokens（{built.stats.charCount} 字）
                  </span>
                  <span className="px-2 py-0.5 rounded bg-muted">
                    展开章节 {built.stats.includedSections.length}/{built.stats.totalSections}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-muted">
                    角色 {built.stats.characterCount} · 关系 {built.stats.relationCount} · 事件{' '}
                    {built.stats.eventCount}
                  </span>
                  {built.stats.truncated && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-500">
                      已按上限截断
                    </span>
                  )}
                </div>

                {built.stats.omittedSections.length > 0 && (
                  <div className="text-[11.5px] text-dim">
                    仅展示索引（未展开全文）：{built.stats.omittedSections.join('、')}
                  </div>
                )}

                <pre className="p-3 rounded-xl bg-muted border border-line text-[13px] leading-relaxed whitespace-pre-wrap text-secondary max-h-72 overflow-y-auto">
                  {built.prompt || '（当前 System Prompt 为空）'}
                </pre>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
