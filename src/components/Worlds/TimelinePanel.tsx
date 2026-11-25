import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Clock,
  MessageSquarePlus,
  Plus,
  Trash2,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import type { TimelineEvent } from '../../types';
import { createId } from '../../utils/platform';

export const TimelinePanel: React.FC<{ worldId: string }> = ({ worldId }) => {
  const {
    timelineEvents,
    characters,
    upsertTimelineEvent,
    deleteTimelineEvent,
    startNewDraft,
    requestConfirm,
    showToast,
  } = useAppStore(
    useShallow((s) => ({
      timelineEvents: s.timelineEvents,
      characters: s.characters,
      upsertTimelineEvent: s.upsertTimelineEvent,
      deleteTimelineEvent: s.deleteTimelineEvent,
      startNewDraft: s.startNewDraft,
      requestConfirm: s.requestConfirm,
      showToast: s.showToast,
    }))
  );

  const [editing, setEditing] = useState<TimelineEvent | null>(null);

  const worldChars = useMemo(
    () => characters.filter((c) => c.worldId === worldId),
    [characters, worldId]
  );
  const charById = useMemo(() => new Map(worldChars.map((c) => [c.id, c])), [worldChars]);

  const sorted = useMemo(
    () =>
      timelineEvents
        .filter((e) => e.worldId === worldId)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [timelineEvents, worldId]
  );

  const openNew = () => {
    const maxOrder = sorted.reduce((m, e) => Math.max(m, e.orderIndex), 0);
    setEditing({
      id: createId('ev'),
      worldId,
      timeLabel: '',
      title: '',
      details: '',
      characterIds: [],
      orderIndex: maxOrder + 10,
      updatedAt: Date.now(),
    });
  };

  const handleSave = async () => {
    if (!editing || !editing.title.trim()) return;
    const saved: TimelineEvent = {
      ...editing,
      title: editing.title.trim(),
      updatedAt: Date.now(),
    };
    await upsertTimelineEvent(saved);
    setEditing(null);
    showToast('时间线事件已保存', 'success');
  };

  const handleMove = async (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);
    for (let i = 0; i < reordered.length; i++) {
      const expectedOrder = (i + 1) * 10;
      if (reordered[i].orderIndex !== expectedOrder) {
        await upsertTimelineEvent({ ...reordered[i], orderIndex: expectedOrder });
      }
    }
  };

  const handleDelete = (ev: TimelineEvent) => {
    requestConfirm({
      title: '删除事件',
      message: `确定要从时间线移除「${ev.title}」吗？`,
      onConfirm: async () => {
        await deleteTimelineEvent(ev.id);
        if (editing?.id === ev.id) setEditing(null);
        showToast('事件已删除');
      },
    });
  };

  const handleChatFromEvent = async (ev: TimelineEvent) => {
    const who = ev.characterIds.map((id) => charById.get(id)?.name).filter(Boolean).join('、');
    const prompt = `请结合作品设定，围绕时间线事件「${ev.title}」${
      ev.timeLabel ? `（时间：${ev.timeLabel}）` : ''
    }${who ? `（涉及角色：${who}）` : ''}帮我细化场景冲突与后续走向：\n${ev.details || ''}`;
    await startNewDraft({ worldId, initialPrompt: prompt });
  };

  if (editing) {
    return (
      <div className="flex-1 flex flex-col min-h-0 rounded-xl bg-card border border-line overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-sidebar">
          <button
            onClick={() => setEditing(null)}
            className="flex items-center gap-1.5 text-[13px] font-medium text-secondary hover:text-ink cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回时间线</span>
          </button>

          <div className="flex items-center gap-2">
            {sorted.some((e) => e.id === editing.id) && (
              <button
                onClick={() => handleDelete(editing)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[13px] text-danger border border-danger/30 hover:bg-danger/10 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除</span>
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!editing.title.trim()}
              className="px-4 py-1.5 rounded-xl text-[13px] font-medium bg-accent text-white disabled:opacity-40 cursor-pointer"
            >
              保存事件
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-2xl mx-auto space-y-4 text-[13px]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block mb-1.5 font-medium text-secondary">时间标注</label>
                <input
                  value={editing.timeLabel}
                  onChange={(e) => setEditing({ ...editing, timeLabel: e.target.value })}
                  placeholder="例如：星海历 302 年秋 / 第一卷第三章"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-secondary">事件名称 *</label>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="例如：星落城密谈"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
                />
              </div>
            </div>

            {worldChars.length > 0 && (
              <div>
                <label className="block mb-1.5 font-medium text-secondary">涉及角色</label>
                <div className="flex flex-wrap gap-2">
                  {worldChars.map((c) => {
                    const active = editing.characterIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            characterIds: active
                              ? editing.characterIds.filter((id) => id !== c.id)
                              : [...editing.characterIds, c.id],
                          })
                        }
                        className={`px-3 py-1.5 rounded-full border text-[13px] cursor-pointer transition ${
                          active
                            ? 'text-white border-transparent'
                            : 'border-line text-secondary hover:bg-hover'
                        }`}
                        style={active ? { backgroundColor: c.avatarColor || '#4d6bfe' } : undefined}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="block mb-1.5 font-medium text-secondary">事件经过与影响</label>
              <textarea
                rows={5}
                value={editing.details}
                onChange={(e) => setEditing({ ...editing, details: e.target.value })}
                placeholder="简述发生了什么、核心转折以及对后续剧情造成了什么影响..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-secondary">共 {sorted.length} 个关键事件节点</span>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium bg-accent text-white hover:opacity-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>添加事件</span>
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="py-16 text-center rounded-xl border border-dashed border-line space-y-2">
          <Clock className="w-8 h-8 mx-auto text-dim" />
          <div className="text-[15px] text-secondary">时间线还是空的</div>
          <p className="text-[13px] text-dim">
            记录关键故事节点的时间顺序与参与人物，创作对话时会自动带给 AI 作为先后参考。
          </p>
        </div>
      ) : (
        <div className="relative pl-6 space-y-3">
          <div className="absolute left-2.5 top-3 bottom-3 w-0.5 bg-line" />
          {sorted.map((ev, idx) => (
            <div key={ev.id} className="relative">
              <span className="absolute -left-[19px] top-4 w-3 h-3 rounded-full bg-accent ring-4 ring-canvas" />
              <div
                onClick={() => setEditing({ ...ev })}
                className="p-4 rounded-xl bg-card border border-line hover:border-accent/50 transition cursor-pointer space-y-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    {ev.timeLabel && (
                      <span className="inline-block text-[13px] font-mono px-2 py-0.5 rounded-md bg-accent-soft text-accent">
                        {ev.timeLabel}
                      </span>
                    )}
                    <h4 className="text-[15px] font-semibold text-ink">{ev.title}</h4>
                  </div>

                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleChatFromEvent(ev)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line text-[13px] text-accent hover:bg-accent-soft cursor-pointer"
                      title="以此事件开启 AI 对话"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                      <span>以此写作</span>
                    </button>
                    <button
                      onClick={() => handleMove(idx, -1)}
                      disabled={idx === 0}
                      className="p-1.5 rounded-lg text-dim hover:text-ink disabled:opacity-30 cursor-pointer"
                      aria-label="上移"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 1)}
                      disabled={idx === sorted.length - 1}
                      className="p-1.5 rounded-lg text-dim hover:text-ink disabled:opacity-30 cursor-pointer"
                      aria-label="下移"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(ev)}
                      className="p-1.5 rounded-lg text-dim hover:text-danger cursor-pointer"
                      aria-label="删除事件"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {ev.details && (
                  <p className="text-[13px] text-secondary leading-relaxed line-clamp-3">
                    {ev.details}
                  </p>
                )}

                {ev.characterIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {ev.characterIds.map((cid) => {
                      const c = charById.get(cid);
                      if (!c) return null;
                      return (
                        <span
                          key={cid}
                          className="text-[11.5px] px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: c.avatarColor || '#4d6bfe' }}
                        >
                          {c.name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
