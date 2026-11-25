import React from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import type { Character, CharacterRelation, RelationType, TimelineEvent } from '../../types';
import { RELATION_TYPE_META } from '../../services/temporalGraph';
import { createId } from '../../utils/platform';

const ALL_RELATION_TYPES = Object.entries(RELATION_TYPE_META) as Array<
  [RelationType, { label: string; color: string }]
>;

interface RelationPhaseEditorProps {
  editing: CharacterRelation;
  setEditing: React.Dispatch<React.SetStateAction<CharacterRelation | null>>;
  isExisting: boolean;
  worldChars: Character[];
  orderedEvents: TimelineEvent[];
  onBack: () => void;
  onSave: () => void;
  onDelete: (rel: CharacterRelation) => void;
}

export const RelationPhaseEditor: React.FC<RelationPhaseEditorProps> = ({
  editing,
  setEditing,
  isExisting,
  worldChars,
  orderedEvents,
  onBack,
  onSave,
  onDelete,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0 rounded-xl bg-card border border-line overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-sidebar">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] font-medium text-secondary hover:text-ink cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回关系图谱</span>
        </button>
        <div className="flex items-center gap-2">
          {isExisting && (
            <button
              onClick={() => onDelete(editing)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[13px] text-danger border border-danger/30 hover:bg-danger/10 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>删除关系</span>
            </button>
          )}
          <button
            onClick={onSave}
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
                className="accent-[var(--accent)]"
              />
              <span>有向关系 (A → B)</span>
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-ink">跨时间演进阶段</div>
                <div className="text-[13px] text-dim">
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
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent-soft text-accent font-medium text-[13px] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加时间转折</span>
              </button>
            </div>

            {editing.phases.map((ph, idx) => (
              <div key={ph.id} className="p-4 rounded-xl bg-sidebar border border-line space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-accent">阶段 {idx + 1}</span>
                  {editing.phases.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          ...editing,
                          phases: editing.phases.filter((p) => p.id !== ph.id),
                        })
                      }
                      className="text-[13px] text-danger hover:underline cursor-pointer"
                    >
                      移除此阶段
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block mb-1 text-[13px] text-secondary">生效时间节点</label>
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
                    <label className="block mb-1 text-[13px] text-secondary">关系性质</label>
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
                    <label className="block mb-1 text-[13px] text-secondary">显示标签</label>
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
                  <label className="block mb-1 text-[13px] text-secondary">该阶段关系说明</label>
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
};
