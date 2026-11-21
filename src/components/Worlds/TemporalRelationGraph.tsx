import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Clock,
  GitBranch,
  List,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { CharacterRelation, RelationType } from '../../types';
import {
  INITIAL_STORY_POINT,
  RELATION_TYPE_META,
  resolveRelationAtPoint,
  sortEventsChronologically,
} from '../../services/temporalGraph';
import { createId } from '../../utils/platform';

const ALL_RELATION_TYPES = Object.entries(RELATION_TYPE_META) as Array<
  [RelationType, { label: string; color: string }]
>;

export const TemporalRelationGraph: React.FC<{ worldId: string }> = ({ worldId }) => {
  const {
    characters,
    relations,
    timelineEvents,
    upsertRelation,
    deleteRelation,
    upsertCharacter,
    requestConfirm,
    showToast,
  } = useAppStore();

  const worldChars = useMemo(
    () => characters.filter((c) => c.worldId === worldId),
    [characters, worldId]
  );
  const worldRels = useMemo(
    () => relations.filter((r) => r.worldId === worldId),
    [relations, worldId]
  );
  const orderedEvents = useMemo(
    () => sortEventsChronologically(timelineEvents.filter((e) => e.worldId === worldId)),
    [timelineEvents, worldId]
  );

  // Time scrubber points: ['__initial__', ...eventIds, '__latest__']
  const timePoints = useMemo(
    () => [
      { id: INITIAL_STORY_POINT, label: '故事初始', sub: '事件前' },
      ...orderedEvents.map((e) => ({
        id: e.id,
        label: e.title,
        sub: e.timeLabel || `#${e.orderIndex}`,
      })),
      { id: '__latest__', label: '最新状态', sub: '全部事件后' },
    ],
    [orderedEvents]
  );

  const [activePointId, setActivePointId] = useState<string>('__latest__');
  const [playing, setPlaying] = useState(false);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CharacterRelation | null>(null);

  // Pan/Zoom/Drag
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [localCoords, setLocalCoords] = useState<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<{
    kind: 'none' | 'pan' | 'node';
    charId?: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ kind: 'none', startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setActivePointId((cur) => {
        const idx = timePoints.findIndex((p) => p.id === cur);
        const nextIdx = idx === -1 || idx >= timePoints.length - 1 ? 0 : idx + 1;
        return timePoints[nextIdx].id;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [playing, timePoints]);

  const resolvedPointId = activePointId === '__latest__' ? undefined : activePointId;

  const charById = useMemo(() => new Map(worldChars.map((c) => [c.id, c])), [worldChars]);
  const eventById = useMemo(() => new Map(orderedEvents.map((e) => [e.id, e])), [orderedEvents]);

  const resolvedRelations = useMemo(() => {
    return worldRels
      .filter((r) =>
        selectedCharId ? r.sourceId === selectedCharId || r.targetId === selectedCharId : true
      )
      .map((r) => resolveRelationAtPoint(r, orderedEvents, resolvedPointId))
      .filter((res) => res.activePhase !== null);
  }, [worldRels, selectedCharId, orderedEvents, resolvedPointId]);

  const nodePositions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const count = Math.max(1, worldChars.length);
    const radius = Math.max(130, Math.min(230, count * 28));
    worldChars.forEach((c, idx) => {
      if (localCoords[c.id]) {
        pos[c.id] = localCoords[c.id];
      } else if (typeof c.posX === 'number' && typeof c.posY === 'number') {
        pos[c.id] = { x: c.posX, y: c.posY };
      } else {
        const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
        pos[c.id] = {
          x: Math.round(340 + Math.cos(angle) * radius),
          y: Math.round(210 + Math.sin(angle) * radius * 0.78),
        };
      }
    });
    return pos;
  }, [worldChars, localCoords]);

  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const out = new Map<string, number>();
    for (const r of resolvedRelations) {
      const key = [r.relation.sourceId, r.relation.targetId].sort().join('::');
      const i = counts.get(key) || 0;
      counts.set(key, i + 1);
      out.set(r.relation.id, i);
    }
    return { counts, out };
  }, [resolvedRelations]);

  const openNewRelation = () => {
    if (worldChars.length < 2) return;
    const src = selectedCharId || worldChars[0].id;
    const dst = worldChars.find((c) => c.id !== src)?.id || worldChars[1].id;
    setEditing({
      id: createId('rel'),
      worldId,
      sourceId: src,
      targetId: dst,
      directed: true,
      phases: [
        {
          id: createId('phase'),
          fromEventId: undefined,
          type: 'friend',
          label: '好友',
          strength: 2,
          description: '',
        },
      ],
      updatedAt: Date.now(),
    });
  };

  const handleSaveRelation = async () => {
    if (!editing || editing.sourceId === editing.targetId || editing.phases.length === 0) return;
    await upsertRelation({ ...editing, updatedAt: Date.now() });
    setEditing(null);
    showToast('跨时间人物关系已保存', 'success');
  };

  const handleDeleteRelation = (rel: CharacterRelation) => {
    const a = charById.get(rel.sourceId)?.name || '?';
    const b = charById.get(rel.targetId)?.name || '?';
    requestConfirm({
      title: '删除人物关系',
      message: `确定要删除「${a}」与「${b}」的整条跨时间关系演进记录吗？`,
      onConfirm: async () => {
        await deleteRelation(rel.id);
        if (editing?.id === rel.id) setEditing(null);
        showToast('关系已删除');
      },
    });
  };

  const svgRef = useRef<SVGSVGElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);

  useEffect(() => {
    if (scrubberRef.current && activePointId === '__latest__') {
      scrubberRef.current.scrollLeft = scrubberRef.current.scrollWidth;
    }
  }, [timePoints.length, activePointId]);

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d.kind === 'none') return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) {
      didDragRef.current = true;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    const scaleX = rect && rect.width > 0 ? 680 / rect.width : 1;
    const scaleY = rect && rect.height > 0 ? 440 / rect.height : 1;
    const viewScale = Math.max(scaleX, scaleY);
    if (d.kind === 'node' && d.charId) {
      setLocalCoords((prev) => ({
        ...prev,
        [d.charId!]: {
          x: d.origX + ((e.clientX - d.startX) * viewScale) / zoom,
          y: d.origY + ((e.clientY - d.startY) * viewScale) / zoom,
        },
      }));
    } else if (d.kind === 'pan') {
      setPan({
        x: d.origX + (e.clientX - d.startX) * viewScale,
        y: d.origY + (e.clientY - d.startY) * viewScale,
      });
    }
  };

  const handlePointerUp = async () => {
    const d = dragRef.current;
    if (d.kind === 'node' && d.charId && localCoords[d.charId]) {
      const ch = charById.get(d.charId);
      if (ch) {
        await upsertCharacter({
          ...ch,
          posX: Math.round(localCoords[d.charId].x),
          posY: Math.round(localCoords[d.charId].y),
        });
      }
    }
    dragRef.current = { kind: 'none', startX: 0, startY: 0, origX: 0, origY: 0 };
  };

  if (worldChars.length < 2) {
    return (
      <div className="py-16 text-center rounded-2xl border border-dashed border-line space-y-2">
        <GitBranch className="w-8 h-8 mx-auto text-dim" />
        <div className="text-[14px] text-secondary">请先创建至少 2 位角色</div>
        <p className="text-[12px] text-dim">
          在「角色卡」添加角色后，即可在此绘制随时间线演变的多维度人物关系图谱。
        </p>
      </div>
    );
  }

  // Full-panel multi-phase relation editor (no nested modal-on-modal)
  if (editing) {
    return (
      <div className="flex-1 flex flex-col min-h-0 rounded-2xl bg-card border border-line overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-sidebar">
          <button
            onClick={() => setEditing(null)}
            className="flex items-center gap-1.5 text-[13px] font-medium text-secondary hover:text-ink cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回关系图谱</span>
          </button>
          <div className="flex items-center gap-2">
            {worldRels.some((r) => r.id === editing.id) && (
              <button
                onClick={() => handleDeleteRelation(editing)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] text-red-500 border border-red-500/30 hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除关系</span>
              </button>
            )}
            <button
              onClick={handleSaveRelation}
              disabled={editing.sourceId === editing.targetId || editing.phases.length === 0}
              className="px-4 py-1.5 rounded-xl text-[13px] font-medium bg-accent text-white disabled:opacity-40 cursor-pointer"
            >
              保存演进关系
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-2xl mx-auto space-y-5 text-[13px]">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block mb-1.5 font-medium text-secondary">角色 A</label>
                <select
                  value={editing.sourceId}
                  onChange={(e) => setEditing({ ...editing, sourceId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none"
                >
                  {worldChars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-secondary">角色 B</label>
                <select
                  value={editing.targetId}
                  onChange={(e) => setEditing({ ...editing, targetId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none"
                >
                  {worldChars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 py-2 cursor-pointer text-ink">
                <input
                  type="checkbox"
                  checked={editing.directed}
                  onChange={(e) => setEditing({ ...editing, directed: e.target.checked })}
                />
                <span>有向关系 (A → B)</span>
              </label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-ink">跨时间演进阶段</div>
                  <div className="text-[12px] text-dim">
                    可设置「故事初始」及「某时间线事件发生后」的关系变化（如：好友 → 背叛之夜后变为敌对）
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      phases: [
                        ...editing.phases,
                        {
                          id: createId('phase'),
                          fromEventId: orderedEvents[0]?.id,
                          type: 'hostile',
                          label: '敌对',
                          strength: 3,
                          description: '',
                        },
                      ],
                    })
                  }
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent-soft text-accent font-medium text-[12px] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加时间转折</span>
                </button>
              </div>

              {editing.phases.map((ph, idx) => (
                <div
                  key={ph.id}
                  className="p-4 rounded-2xl bg-sidebar border border-line space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-accent">
                      阶段 {idx + 1}
                    </span>
                    {editing.phases.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            phases: editing.phases.filter((p) => p.id !== ph.id),
                          })
                        }
                        className="text-[12px] text-red-500 hover:underline cursor-pointer"
                      >
                        移除此阶段
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">生效时间节点</label>
                      <select
                        value={ph.fromEventId || ''}
                        onChange={(e) => {
                          const nextVal = e.target.value || undefined;
                          setEditing({
                            ...editing,
                            phases: editing.phases.map((p) =>
                              p.id === ph.id ? { ...p, fromEventId: nextVal } : p
                            ),
                          });
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none"
                      >
                        <option value="">故事初始状态</option>
                        {orderedEvents.map((ev) => (
                          <option key={ev.id} value={ev.id}>
                            事件「{ev.title}」之后
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">关系性质</label>
                      <select
                        value={ph.type}
                        onChange={(e) => {
                          const t = e.target.value as RelationType;
                          const defLabel = RELATION_TYPE_META[t].label;
                          setEditing({
                            ...editing,
                            phases: editing.phases.map((p) =>
                              p.id === ph.id ? { ...p, type: t, label: defLabel } : p
                            ),
                          });
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none"
                      >
                        {ALL_RELATION_TYPES.map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block mb-1 text-[12px] text-secondary">显示标签</label>
                      <input
                        value={ph.label}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            phases: editing.phases.map((p) =>
                              p.id === ph.id ? { ...p, label: e.target.value } : p
                            ),
                          })
                        }
                        placeholder="如：挚友 / 死敌"
                        className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block mb-1 text-[12px] text-secondary">该阶段关系说明</label>
                    <input
                      value={ph.description}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          phases: editing.phases.map((p) =>
                            p.id === ph.id ? { ...p, description: e.target.value } : p
                          ),
                        })
                      }
                      placeholder="描述在这个时间节点两人如何相处或为何反目..."
                      className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-ink outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      {/* Timeline Scrubber Bar */}
      <div className="p-3 rounded-2xl bg-card border border-line space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
            <Clock className="w-4 h-4 text-accent" />
            <span>跨时间轴切片（点选事件观察人物关系如何随剧情演变）</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {timePoints.length > 2 && (
              <button
                onClick={() => setPlaying((v) => !v)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[12px] whitespace-nowrap shrink-0 cursor-pointer ${
                  playing
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-secondary hover:bg-hover'
                }`}
              >
                {playing ? <Pause className="w-3.5 h-3.5 shrink-0" /> : <Play className="w-3.5 h-3.5 shrink-0" />}
                <span>{playing ? '暂停演变' : '播放演变'}</span>
              </button>
            )}

            <div className="inline-flex rounded-xl bg-muted p-0.5 border border-line text-[12px] shrink-0">
              <button
                onClick={() => setViewMode('graph')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg whitespace-nowrap cursor-pointer ${
                  viewMode === 'graph' ? 'bg-card text-ink font-medium shadow-xs' : 'text-secondary'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5 shrink-0" />
                <span>图谱</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg whitespace-nowrap cursor-pointer ${
                  viewMode === 'list' ? 'bg-card text-ink font-medium shadow-xs' : 'text-secondary'
                }`}
              >
                <List className="w-3.5 h-3.5 shrink-0" />
                <span>演进列表</span>
              </button>
            </div>

            <button
              onClick={openNewRelation}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent text-white text-[12px] font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>添加关系</span>
            </button>
          </div>
        </div>

        {/* Horizontal timeline nodes */}
        <div ref={scrubberRef} className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {timePoints.map((pt, idx) => {
            const active = pt.id === activePointId;
            return (
              <React.Fragment key={pt.id}>
                <button
                  onClick={() => {
                    setPlaying(false);
                    setActivePointId(pt.id);
                  }}
                  className={`shrink-0 px-3 py-1.5 rounded-xl border text-left transition cursor-pointer ${
                    active
                      ? 'bg-accent text-white border-transparent'
                      : 'bg-sidebar border-line text-secondary hover:bg-hover hover:text-ink'
                  }`}
                >
                  <div className="text-[12px] font-medium whitespace-nowrap">{pt.label}</div>
                  <div className={`text-[10px] whitespace-nowrap ${active ? 'text-white/80' : 'text-dim'}`}>
                    {pt.sub}
                  </div>
                </button>
                {idx < timePoints.length - 1 && (
                  <span className="text-dim text-xs shrink-0">→</span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Main Graph or List */}
      {viewMode === 'graph' ? (
        <div
          data-no-swipe="true"
          className="relative flex-1 min-h-[380px] rounded-2xl bg-card border border-line overflow-hidden select-none"
        >
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
            {selectedCharId && (
              <button
                onClick={() => setSelectedCharId(null)}
                className="px-2.5 py-1 rounded-lg bg-sidebar border border-line text-[12px] text-ink cursor-pointer"
              >
                取消聚焦
              </button>
            )}
            <button
              onClick={() => setZoom((z) => Math.min(2, Number((z + 0.15).toFixed(2))))}
              className="p-1.5 rounded-lg bg-sidebar border border-line text-ink cursor-pointer"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))))}
              className="p-1.5 rounded-lg bg-sidebar border border-line text-ink cursor-pointer"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
          </div>

          <div className="absolute bottom-3 left-3 z-10 px-2.5 py-1 rounded-lg bg-sidebar/90 border border-line text-[11px] text-dim">
            拖拽节点可调整位置 · 点击节点聚焦 · 点击连线编辑跨时间转折
          </div>

          <svg
            ref={svgRef}
            viewBox="0 0 680 440"
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full touch-none"
            onPointerDown={(e) => {
              e.stopPropagation();
              didDragRef.current = false;
              if ((e.target as Element).tagName === 'svg') {
                dragRef.current = {
                  kind: 'pan',
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: pan.x,
                  origY: pan.y,
                };
              }
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <defs>
              {ALL_RELATION_TYPES.map(([id, meta]) => (
                <marker
                  key={id}
                  id={`arrow-v2-${id}`}
                  viewBox="0 0 10 10"
                  refX="26"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill={meta.color} />
                </marker>
              ))}
            </defs>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {resolvedRelations.map(({ relation, activePhase, changedAtCurrentEvent, previousPhase }) => {
                if (!activePhase) return null;
                const p1 = nodePositions[relation.sourceId];
                const p2 = nodePositions[relation.targetId];
                if (!p1 || !p2) return null;

                const color = RELATION_TYPE_META[activePhase.type]?.color || '#64748b';
                const pairKey = [relation.sourceId, relation.targetId].sort().join('::');
                const total = pairCounts.counts.get(pairKey) || 1;
                const idx = pairCounts.out.get(relation.id) || 0;
                const offset = total > 1 ? (idx - (total - 1) / 2) * 38 : 0;

                const mx = (p1.x + p2.x) / 2;
                const my = (p1.y + p2.y) / 2;
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const len = Math.hypot(dx, dy) || 1;
                const cx = mx - (dy / len) * offset;
                const cy = my + (dx / len) * offset;
                const d =
                  offset === 0
                    ? `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`
                    : `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;
                const lx = offset === 0 ? mx : (p1.x + 2 * cx + p2.x) / 4;
                const ly = offset === 0 ? my : (p1.y + 2 * cy + p2.y) / 4;

                const badgeText =
                  changedAtCurrentEvent && previousPhase
                    ? `✦ ${previousPhase.label}→${activePhase.label}`
                    : activePhase.label;

                const badgeW = Math.max(56, Math.min(130, badgeText.length * 12 + 16));

                return (
                  <g
                    key={relation.id}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ ...relation, phases: relation.phases.map((p) => ({ ...p })) });
                    }}
                  >
                    <path
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={changedAtCurrentEvent ? 3.5 : activePhase.strength === 3 ? 2.6 : 1.8}
                      strokeDasharray={activePhase.type === 'secret' ? '5 4' : undefined}
                      markerEnd={relation.directed ? `url(#arrow-v2-${activePhase.type})` : undefined}
                      opacity={0.9}
                    />
                    <rect
                      x={lx - badgeW / 2}
                      y={ly - 11}
                      width={badgeW}
                      height={22}
                      rx={7}
                      fill="var(--bg-card)"
                      stroke={color}
                      strokeWidth={changedAtCurrentEvent ? 2 : 1.2}
                    />
                    <text
                      x={lx}
                      y={ly + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight={changedAtCurrentEvent ? '700' : '500'}
                      fill="var(--text-ink)"
                    >
                      {badgeText}
                    </text>
                  </g>
                );
              })}

              {worldChars.map((c) => {
                const p = nodePositions[c.id];
                if (!p) return null;
                const isSelected = selectedCharId === c.id;
                const dim =
                  selectedCharId !== null &&
                  !isSelected &&
                  !resolvedRelations.some(
                    (r) => r.relation.sourceId === c.id || r.relation.targetId === c.id
                  );
                return (
                  <g
                    key={c.id}
                    transform={`translate(${p.x}, ${p.y})`}
                    className="cursor-grab active:cursor-grabbing"
                    opacity={dim ? 0.35 : 1}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      didDragRef.current = false;
                      dragRef.current = {
                        kind: 'node',
                        charId: c.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: p.x,
                        origY: p.y,
                      };
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (didDragRef.current) {
                        didDragRef.current = false;
                        return;
                      }
                      setSelectedCharId((prev) => (prev === c.id ? null : c.id));
                    }}
                  >
                    <circle
                      r={24}
                      fill={c.avatarColor || '#4d6bfe'}
                      stroke={isSelected ? 'var(--text-ink)' : 'var(--bg-canvas)'}
                      strokeWidth={isSelected ? 3 : 2}
                    />
                    <text
                      textAnchor="middle"
                      dy="5"
                      fontSize="14"
                      fontWeight="700"
                      fill="#ffffff"
                      pointerEvents="none"
                    >
                      {c.name.slice(0, 1)}
                    </text>
                    <text
                      textAnchor="middle"
                      y={38}
                      fontSize="12"
                      fontWeight="600"
                      fill="var(--text-ink)"
                      pointerEvents="none"
                    >
                      {c.name}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2.5">
          {worldRels.length === 0 ? (
            <div className="py-12 text-center rounded-2xl border border-dashed border-line text-[13px] text-dim">
              暂无跨时间关系记录，点击「添加关系」开始建立人物羁绊与转折。
            </div>
          ) : (
            worldRels.map((rel) => {
              const src = charById.get(rel.sourceId)?.name || '未知';
              const dst = charById.get(rel.targetId)?.name || '未知';
              const resolved = resolveRelationAtPoint(rel, orderedEvents, resolvedPointId);
              return (
                <div
                  key={rel.id}
                  onClick={() =>
                    setEditing({ ...rel, phases: rel.phases.map((p) => ({ ...p })) })
                  }
                  className="p-4 rounded-2xl bg-card border border-line hover:border-accent/50 transition cursor-pointer space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-[14px] font-semibold text-ink flex items-center gap-2">
                      <span>
                        {src} {rel.directed ? '→' : '↔'} {dst}
                      </span>
                      {resolved.changedAtCurrentEvent && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-soft text-accent text-[11px]">
                          <Sparkles className="w-3 h-3" />
                          <span>当前节点发生转折</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {rel.phases.map((ph, idx) => {
                      const meta = RELATION_TYPE_META[ph.type];
                      const ev = ph.fromEventId ? eventById.get(ph.fromEventId) : undefined;
                      const isActivePhase = resolved.activePhase?.id === ph.id;
                      return (
                        <React.Fragment key={ph.id}>
                          <div
                            className={`px-2.5 py-1.5 rounded-xl border text-[12px] ${
                              isActivePhase ? 'border-accent bg-accent-soft' : 'border-line bg-sidebar'
                            }`}
                          >
                            <div className="text-[10.5px] text-dim">
                              {ev ? `事件「${ev.title}」后` : '故事初始'}
                            </div>
                            <div
                              className="font-medium flex items-center gap-1.5"
                              style={{ color: meta?.color || '#64748b' }}
                            >
                              <span>{ph.label}</span>
                            </div>
                          </div>
                          {idx < rel.phases.length - 1 && (
                            <span className="text-dim text-xs">→</span>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
