import React, { useEffect, useMemo, useState } from 'react';
import { Bot, Check, Plus, Sparkles, Trash2, UserRound, Users, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ChatMode, PersonaPreset } from '../../types';
import { createId } from '../../utils/platform';

const AVATAR_COLORS = ['#4d6bfe', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444'];

export const SessionModeModal: React.FC = () => {
  const {
    sessions,
    activeSessionId,
    draftConfig,
    updateDraftConfig,
    updateSession,
    worlds,
    characters,
    personaPresets,
    upsertPersonaPreset,
    deletePersonaPreset,
    setActiveView,
    showToast,
  } = useAppStore();

  const [open, setOpen] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDesc, setPresetDesc] = useState('');

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const chatMode: ChatMode = (session ? session.chatMode : draftConfig.chatMode) || 'assistant';
  const personaPresetId = session ? session.personaPresetId : draftConfig.personaPresetId;
  const roleCharacterId = session ? session.roleCharacterId : draftConfig.roleCharacterId;
  const worldId = session ? session.worldId : draftConfig.worldId;
  const promptOverride =
    (session ? session.systemPromptOverride : draftConfig.systemPromptOverride) || '';

  const [selectedRoleWorldId, setSelectedRoleWorldId] = useState<string>(worldId || worlds[0]?.id || '');

  useEffect(() => {
    if (open) {
      setSelectedRoleWorldId(worldId || worlds[0]?.id || '');
    }
  }, [open, worldId, worlds]);

  const activePreset = useMemo(
    () => (personaPresetId ? personaPresets.find((p) => p.id === personaPresetId) : undefined),
    [personaPresets, personaPresetId]
  );

  const activeRoleChar = useMemo(
    () => (roleCharacterId ? characters.find((c) => c.id === roleCharacterId) : undefined),
    [characters, roleCharacterId]
  );

  const roleWorldChars = useMemo(
    () => (selectedRoleWorldId ? characters.filter((c) => c.worldId === selectedRoleWorldId) : []),
    [characters, selectedRoleWorldId]
  );

  const patchSessionOrDraft = async (patch: {
    chatMode?: ChatMode;
    personaPresetId?: string;
    roleCharacterId?: string;
    systemPromptOverride?: string;
    worldId?: string;
    enableWorldContext?: boolean;
  }) => {
    if (session) {
      await updateSession(session.id, patch);
    } else {
      updateDraftConfig(patch);
    }
  };

  const handleSavePreset = async () => {
    const name = presetName.trim();
    const sys = promptOverride.trim();
    if (!name || !sys) {
      showToast('请填写人设名称和提示词内容', 'error');
      return;
    }
    const now = Date.now();
    const preset: PersonaPreset = {
      id: createId('preset'),
      name,
      description: presetDesc.trim(),
      systemPrompt: sys,
      avatarColor: AVATAR_COLORS[personaPresets.length % AVATAR_COLORS.length],
      createdAt: now,
      updatedAt: now,
    };
    await upsertPersonaPreset(preset);
    await patchSessionOrDraft({
      chatMode: 'custom_persona',
      personaPresetId: preset.id,
    });
    setSavingPreset(false);
    setPresetName('');
    setPresetDesc('');
    showToast(`已保存常用人设「${name}」`, 'success');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="session-mode-trigger"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] transition cursor-pointer ${
          chatMode === 'assistant'
            ? 'bg-muted text-secondary hover:bg-hover'
            : 'bg-accent-soft text-accent font-medium'
        }`}
      >
        {chatMode === 'character_role' ? (
          <>
            {activeRoleChar?.avatarImage ? (
              <img
                src={activeRoleChar.avatarImage}
                alt={activeRoleChar.name}
                className="w-3.5 h-3.5 rounded-full object-cover shrink-0"
              />
            ) : (
              <Users className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>扮演：{activeRoleChar?.name || '选择角色'}</span>
          </>
        ) : chatMode === 'custom_persona' ? (
          <>
            <UserRound className="w-3.5 h-3.5 shrink-0" />
            <span>人设：{activePreset?.name || '自定义人设'}</span>
          </>
        ) : (
          <>
            <Bot className="w-3.5 h-3.5 shrink-0" />
            <span>通用助手</span>
          </>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-end md:items-center justify-center p-0 md:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full md:max-w-xl rounded-t-2xl md:rounded-2xl bg-card border border-line shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-[15px] font-semibold text-ink">对话用途与人设模式</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-dim hover:text-ink cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-[13px]">
              {/* 3 Mode Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    patchSessionOrDraft({
                      chatMode: 'assistant',
                      roleCharacterId: undefined,
                      personaPresetId: undefined,
                    })
                  }
                  className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                    chatMode === 'assistant'
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:bg-hover'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-ink text-[13px]">
                    <Bot className="w-4 h-4 text-accent shrink-0" />
                    <span>通用助手</span>
                  </div>
                  <div className="text-[11px] text-dim mt-1">
                    带全局“AI助手”系统提示，适合日常问答与小说写作顾问
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    patchSessionOrDraft({
                      chatMode: 'custom_persona',
                      roleCharacterId: undefined,
                    })
                  }
                  className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                    chatMode === 'custom_persona'
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:bg-hover'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-ink text-[13px]">
                    <UserRound className="w-4 h-4 text-accent shrink-0" />
                    <span>自定义人设</span>
                  </div>
                  <div className="text-[11px] text-dim mt-1">
                    屏蔽默认助手前缀，纯按你自写的人设/对象提示词对话
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    patchSessionOrDraft({
                      chatMode: 'character_role',
                      personaPresetId: undefined,
                    })
                  }
                  className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                    chatMode === 'character_role'
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:bg-hover'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-ink text-[13px]">
                    <Users className="w-4 h-4 text-accent shrink-0" />
                    <span>扮演作品角色</span>
                  </div>
                  <div className="text-[11px] text-dim mt-1">
                    绑定自建角色卡，以第一人称视角及当下关系网互动
                  </div>
                </button>
              </div>

              {/* Assistant Details */}
              {chatMode === 'assistant' && (
                <div className="space-y-2">
                  <label className="block font-medium text-secondary text-[12px]">
                    本次对话附加系统提示词（可选，留空则使用全局设置中的系统提示词）
                  </label>
                  <textarea
                    rows={3}
                    value={promptOverride}
                    onChange={(e) => patchSessionOrDraft({ systemPromptOverride: e.target.value })}
                    placeholder="例如：请用更简练的要点体回答..."
                    className="w-full p-3 rounded-xl bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                  />
                </div>
              )}

              {/* Custom Persona Details */}
              {chatMode === 'custom_persona' && (
                <div className="space-y-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/25 text-[11.5px] text-emerald-500">
                    已自动屏蔽默认的“AI 助手”提示词，模型将纯粹遵循你在下方编写的人设设定与对话要求。
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-medium text-secondary text-[12px]">
                        会话专属人设提示词 (System Prompt)
                      </label>
                      <button
                        type="button"
                        onClick={() => setSavingPreset((v) => !v)}
                        className="flex items-center gap-1 text-[12px] text-accent hover:underline cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>保存为常用人设</span>
                      </button>
                    </div>
                    <textarea
                      rows={5}
                      value={promptOverride}
                      onChange={(e) =>
                        patchSessionOrDraft({
                          systemPromptOverride: e.target.value,
                          personaPresetId: undefined,
                        })
                      }
                      placeholder="在这里填写你想让模型扮演的性格、背景、说话习惯、互动风格..."
                      className="w-full p-3 rounded-xl bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                    />
                  </div>

                  {savingPreset && (
                    <div className="p-3 rounded-xl bg-sidebar border border-line space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          value={presetName}
                          onChange={(e) => setPresetName(e.target.value)}
                          placeholder="人设名称（如：毒舌剑修师兄）"
                          className="px-3 py-1.5 rounded-lg bg-canvas border border-line text-ink text-[12px] outline-none focus:border-accent"
                        />
                        <input
                          value={presetDesc}
                          onChange={(e) => setPresetDesc(e.target.value)}
                          placeholder="简短备注（可选）"
                          className="px-3 py-1.5 rounded-lg bg-canvas border border-line text-ink text-[12px] outline-none focus:border-accent"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSavingPreset(false)}
                          className="px-2.5 py-1 rounded-lg border border-line text-[12px] text-secondary cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={handleSavePreset}
                          className="flex items-center gap-1 px-3 py-1 rounded-lg bg-accent text-white text-[12px] font-medium cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>保存人设</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="text-[12px] font-medium text-secondary">
                      我的本地人设预设（默认完全空白，仅存本机）
                    </div>
                    {personaPresets.length === 0 ? (
                      <div className="py-4 text-center rounded-xl border border-dashed border-line text-[12px] text-dim">
                        暂未保存常用人设，编写好上方提示词后可点击「保存为常用人设」复用
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {personaPresets.map((p) => {
                          const selected = personaPresetId === p.id;
                          return (
                            <div
                              key={p.id}
                              onClick={() =>
                                patchSessionOrDraft({
                                  chatMode: 'custom_persona',
                                  personaPresetId: p.id,
                                  systemPromptOverride: p.systemPrompt,
                                })
                              }
                              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border cursor-pointer transition ${
                                selected
                                  ? 'border-accent bg-accent-soft'
                                  : 'border-line hover:bg-hover'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-[13px] font-medium text-ink truncate">
                                  {p.name}
                                </div>
                                <div className="text-[11px] text-dim truncate">
                                  {p.description || p.systemPrompt}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deletePersonaPreset(p.id);
                                }}
                                className="p-1 text-dim hover:text-red-500 cursor-pointer shrink-0"
                                title="删除预设"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Character Role Details */}
              {chatMode === 'character_role' && (
                <div className="space-y-3">
                  {worlds.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-line text-center space-y-2">
                      <div className="text-secondary text-[13px]">还没有创建作品与角色卡</div>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          setActiveView('worlds');
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-accent text-white text-[12px] font-medium cursor-pointer"
                      >
                        去「作品工坊」创建作品和角色
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <label className="block font-medium text-secondary text-[12px]">
                          1. 选择所属作品
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {worlds.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => setSelectedRoleWorldId(w.id)}
                              className={`px-3 py-1.5 rounded-xl border text-[12px] cursor-pointer ${
                                selectedRoleWorldId === w.id
                                  ? 'bg-accent text-white border-transparent'
                                  : 'border-line text-secondary hover:bg-hover'
                              }`}
                            >
                              《{w.name}》
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="font-medium text-secondary text-[12px]">
                            2. 选择由 AI 扮演的角色卡
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              setActiveView('worlds');
                            }}
                            className="text-[12px] text-accent hover:underline cursor-pointer"
                          >
                            去管理角色卡
                          </button>
                        </div>
                        {roleWorldChars.length === 0 ? (
                          <div className="p-3 rounded-xl border border-dashed border-line text-[12px] text-dim text-center">
                            该作品下还没有角色卡，请先在「作品 → 角色卡」中添加角色。
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                            {roleWorldChars.map((c) => {
                              const selected = roleCharacterId === c.id;
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() =>
                                    patchSessionOrDraft({
                                      chatMode: 'character_role',
                                      worldId: c.worldId,
                                      roleCharacterId: c.id,
                                    })
                                  }
                                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left cursor-pointer ${
                                    selected
                                      ? 'border-accent bg-accent-soft'
                                      : 'border-line hover:bg-hover'
                                  }`}
                                >
                                  {c.avatarImage ? (
                                    <img
                                      src={c.avatarImage}
                                      alt={c.name}
                                      className="w-8 h-8 rounded-full object-cover shrink-0 border border-line"
                                    />
                                  ) : (
                                    <div
                                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                                      style={{ backgroundColor: c.avatarColor || '#4d6bfe' }}
                                    >
                                      {c.name.slice(0, 1)}
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <div className="text-[13px] font-medium text-ink truncate">
                                      {c.name}
                                    </div>
                                    <div className="text-[11px] text-dim truncate">
                                      {c.identity || c.personality || '角色卡'}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label className="block font-medium text-secondary text-[12px]">
                          3. 补充当前场景指令（可选）
                        </label>
                        <textarea
                          rows={2}
                          value={promptOverride}
                          onChange={(e) =>
                            patchSessionOrDraft({ systemPromptOverride: e.target.value })
                          }
                          placeholder="例如：此时我们刚在酒馆重逢，气氛有些僵持..."
                          className="w-full p-2.5 rounded-xl bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
