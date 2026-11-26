import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  GitBranch,
  List,
  Pause,
  Play,
  Plus,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import type { CharacterRelation, RelationType } from '../../types';
import {
  INITIAL_STORY_POINT,
  RELATION_TYPE_META,
  resolveRelationAtPoint,
  sortEventsChronologically,
} from '../../services/temporalGraph';
import { createId } from '../../utils/platform';
import { RelationPhaseEditor } from './RelationPhaseEditor';

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
  } = useAppStore(
    useShallow((s) => ({
      characters: s.characters,
      relations: s.relations,
      timelineEvents: s.timelineEvents,
      upsertRelation: s.upsertRelation,
      deleteRelation: s.deleteRelation,
      upsertCharacter: s.upsertCharacter,
      requestConfirm: s.requestConfirm,
      showToast: s.showToast,
    }))
  );

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
  const [isPortraitCanvas, setIsPortraitCanvas] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640
  );
  const graphWrapRef = useRef<HTMLDivElement>(null);
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
        if (idx === -1 || idx >= timePoints.length - 1) {
          setPlaying(false);
          return cur;
        }
        const nextIdx = idx + 1;
        if (nextIdx >= timePoints.length - 1) {
          setPlaying(false);
        }
        return timePoints[nextIdx].id;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [playing, timePoints]);

  const handleTogglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const idx = timePoints.findIndex((p) => p.id === activePointId);
    if (idx === -1 || idx >= timePoints.length - 1) {
      setActivePointId(timePoints[0].id);
    }
    setPlaying(true);
  };

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

  useEffect(() => {
    const el = graphWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setIsPortraitCanvas(rect.height > rect.width * 1.05 || rect.width < 500);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode]);

  const baseVbWidth = isPortraitCanvas ? 440 : 680;
  const baseVbHeight = isPortraitCanvas ? 520 : 440;

  const viewBoxSpec = useMemo(() => {
    let minX = 0;
    let minY = 0;
    let maxX = baseVbWidth;
    let maxY = baseVbHeight;
    for (const c of worldChars) {
      if (typeof c.posX === 'number' && typeof c.posY === 'number') {
        minX = Math.min(minX, c.posX - 54);
        minY = Math.min(minY, c.posY - 54);
        maxX = Math.max(maxX, c.posX + 54);
        maxY = Math.max(maxY, c.posY + 62);
      }
    }
    return {
      minX: Math.round(minX),
      minY: Math.round(minY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
    };
  }, [worldChars, baseVbWidth, baseVbHeight]);

  const nodePositions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const count = Math.max(1, worldChars.length);
    const rx = isPortraitCanvas
      ? Math.max(110, Math.min(162, count * 24))
      : Math.max(130, Math.min(230, count * 28));
    const ry = isPortraitCanvas
      ? Math.max(130, Math.min(198, count * 28))
      : Math.round(rx * 0.78);
    const centerX = baseVbWidth / 2;
    const centerY = baseVbHeight / 2 - 12;

    worldChars.forEach((c, idx) => {
      if (localCoords[c.id]) {
        pos[c.id] = localCoords[c.id];
      } else if (typeof c.posX === 'number' && typeof c.posY === 'number') {
        pos[c.id] = { x: c.posX, y: c.posY };
      } else {
        const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
        pos[c.id] = {
          x: Math.round(centerX + Math.cos(angle) * rx),
          y: Math.round(centerY + Math.sin(angle) * ry),
        };
      }
    });
    return pos;
  }, [worldChars, localCoords, isPortraitCanvas, baseVbWidth, baseVbHeight]);

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
    const scaleX = rect && rect.width > 0 ? viewBoxSpec.width / rect.width : 1;
    const scaleY = rect && rect.height > 0 ? viewBoxSpec.height / rect.height : 1;
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
      <div className="py-16 text-center rounded-xl border border-dashed border-line space-y-2">
        <GitBranch className="w-8 h-8 mx-auto text-dim" />
        <div className="text-[15px] text-secondary">请先创建至少 2 位角色</div>
        <p className="text-[13px] text-dim">
          在「角色卡」添加角色后，即可在此绘制随时间线演变的多维度人物关系图谱。
        </p>
      </div>
    );
  }

  // Full-panel multi-phase relation editor (no nested modal-on-modal)
  if (editing) {
    return (
      <RelationPhaseEditor
        editing={editing}
        setEditing={setEditing}
        isExisting={worldRels.some((r) => r.id === editing.id)}
        worldChars={worldChars}
        orderedEvents={orderedEvents}
        onBack={() => setEditing(null)}
        onSave={() => void handleSaveRelation()}
        onDelete={handleDeleteRelation}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2.5 overflow-hidden">
      {/* Timeline Scrubber Bar */}
      <div className="p-2.5 md:p-3 rounded-xl bg-card border border-line space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink min-w-0">
            <Clock className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="truncate">时间轴演进（点选节点查看关系变化）</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {timePoints.length > 1 && (
              <button
                type="button"
                onClick={handleTogglePlay}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-xl border text-[13px] whitespace-nowrap shrink-0 cursor-pointer transition ${
                  playing
                    ? 'border-accent bg-accent-soft text-accent font-medium'
                    : 'border-line text-secondary hover:bg-hover hover:text-ink'
                }`}
                title={playing ? '暂停演变' : '从头播放一遍关系演变'}
              >
                {playing ? (
                  <Pause className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Play className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{playing ? '暂停' : '播放演变'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setViewMode((m) => (m === 'graph' ? 'list' : 'graph'))}
              className="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-line bg-canvas text-[13px] text-secondary hover:bg-hover hover:text-ink whitespace-nowrap shrink-0 cursor-pointer transition"
              title={viewMode === 'graph' ? '切换到关系演进列表' : '切换到关系图谱'}
            >
              {viewMode === 'graph' ? (
                <>
                  <List className="w-3.5 h-3.5 shrink-0 text-accent" />
                  <span>演进列表</span>
                </>
              ) : (
                <>
                  <GitBranch className="w-3.5 h-3.5 shrink-0 text-accent" />
                  <span>关系图谱</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={openNewRelation}
              className="w-7 h-7 rounded-xl bg-accent text-white flex items-center justify-center hover:opacity-95 shrink-0 cursor-pointer transition"
              title="添加人物关系"
              aria-label="添加人物关系"
            >
              <Plus className="w-4 h-4" />
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
                  <div className="text-[13px] font-medium whitespace-nowrap">{pt.label}</div>
                  <div className={`text-[11.5px] whitespace-nowrap ${active ? 'text-white/80' : 'text-dim'}`}>
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
          ref={graphWrapRef}
          data-no-swipe={zoom > 1 ? 'true' : undefined}
          className="relative flex-1 min-h-[260px] rounded-xl bg-card border border-line overflow-hidden select-none"
        >
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
            {selectedCharId && (
              <button
                onClick={() => setSelectedCharId(null)}
                className="px-2.5 py-1 rounded-lg bg-sidebar border border-line text-[13px] text-ink cursor-pointer"
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

          <div className="absolute bottom-3 left-3 right-3 sm:right-auto z-10 px-2.5 py-1 rounded-lg bg-sidebar/90 border border-line text-[11.5px] text-dim truncate">
            拖拽节点调整位置 · 点节点聚焦 · 点连线编辑转折
          </div>

          <svg
            ref={svgRef}
            viewBox={`${viewBoxSpec.minX} ${viewBoxSpec.minY} ${viewBoxSpec.width} ${viewBoxSpec.height}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full"
            onPointerDown={(e) => {
              didDragRef.current = false;
              if ((e.target as Element).tagName === 'svg' && (zoom > 1 || e.pointerType !== 'touch')) {
                e.stopPropagation();
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
                  refX="28"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill={meta.color} />
                </marker>
              ))}
              {worldChars.map((c) =>
                c.avatarImage ? (
                  <clipPath key={`clip-${c.id}`} id={`char-node-clip-${c.id}`}>
                    <circle r={24} cx={0} cy={0} />
                  </clipPath>
                ) : null
              )}
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
                    data-no-swipe="true"
                    transform={`translate(${p.x}, ${p.y})`}
                    className="cursor-grab active:cursor-grabbing touch-none"
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
                      fill={c.avatarImage ? 'var(--bg-sidebar)' : c.avatarColor || '#4d6bfe'}
                    />
                    {c.avatarImage ? (
                      <image
                        href={c.avatarImage}
                        x={-24}
                        y={-24}
                        width={48}
                        height={48}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#char-node-clip-${c.id})`}
                        pointerEvents="none"
                      />
                    ) : (
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
                    )}
                    <circle
                      r={24}
                      fill="none"
                      stroke={
                        isSelected
                          ? 'var(--accent)'
                          : c.avatarImage
                            ? c.avatarColor || 'var(--border-line)'
                            : 'var(--bg-canvas)'
                      }
                      strokeWidth={isSelected ? 3 : 2.2}
                      pointerEvents="none"
                    />
                    <text
                      textAnchor="middle"
                      y={40}
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
            <div className="py-12 text-center rounded-xl border border-dashed border-line text-[13px] text-dim">
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
                  className="p-4 rounded-xl bg-card border border-line hover:border-accent/50 transition cursor-pointer space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-[15px] font-semibold text-ink flex items-center gap-2">
                      <span>
                        {src} {rel.directed ? '→' : '↔'} {dst}
                      </span>
                      {resolved.changedAtCurrentEvent && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-soft text-accent text-[11.5px]">
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
                            className={`px-2.5 py-1.5 rounded-xl border text-[13px] ${
                              isActivePhase ? 'border-accent bg-accent-soft' : 'border-line bg-sidebar'
                            }`}
                          >
                            <div className="text-[11.5px] text-dim">
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
