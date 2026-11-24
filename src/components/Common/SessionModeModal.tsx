import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Plus,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { resolveUserAddress, resolveUserIdentity } from '../../services/userIdentity';
import { UserIdentitySection } from '../Chat/UserIdentitySection';
import type { ChatMode, SessionUserRelationOverride, UserIdentityRef } from '../../types';

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
    userPersonas,
    inheritUserRelationOverride,
    selectWorld,
    setActiveView,
    openStandaloneCharacters,
  } = useAppStore();

  const [open, setOpen] = useState(false);
  const [charFilter, setCharFilter] = useState<string>('all');
  const [assistantPromptOpen, setAssistantPromptOpen] = useState(false);
  const [roleExtraOpen, setRoleExtraOpen] = useState(false);

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const chatMode: ChatMode = (session ? session.chatMode : draftConfig.chatMode) || 'assistant';
  const personaPresetId = session ? session.personaPresetId : draftConfig.personaPresetId;
  const roleCharacterId = session ? session.roleCharacterId : draftConfig.roleCharacterId;
  const worldId = session ? session.worldId : draftConfig.worldId;
  const promptOverride =
    (session ? session.systemPromptOverride : draftConfig.systemPromptOverride) || '';

  useEffect(() => {
    if (!open) return;
    setAssistantPromptOpen(Boolean(chatMode === 'assistant' && promptOverride.trim()));
    setRoleExtraOpen(Boolean(chatMode === 'character_role' && promptOverride.trim()));
    if (worldId && characters.some((c) => c.worldId === worldId)) {
      setCharFilter(worldId);
    } else {
      setCharFilter('all');
    }
  }, [open, worldId, chatMode, promptOverride, characters]);

  const activePreset = useMemo(
    () => (personaPresetId ? personaPresets.find((p) => p.id === personaPresetId) : undefined),
    [personaPresets, personaPresetId]
  );

  const activeRoleChar = useMemo(
    () => (roleCharacterId ? characters.find((c) => c.id === roleCharacterId) : undefined),
    [characters, roleCharacterId]
  );

  const worldNameMap = useMemo(
    () => new Map(worlds.map((w) => [w.id, w.name])),
    [worlds]
  );

  const standaloneChars = useMemo(
    () => characters.filter((c) => !c.worldId),
    [characters]
  );

  const worldBuckets = useMemo(
    () =>
      worlds
        .map((w) => ({
          world: w,
          count: characters.filter((c) => c.worldId === w.id).length,
        }))
        .filter((b) => b.count > 0),
    [worlds, characters]
  );

  const filteredChars = useMemo(() => {
    const list =
      charFilter === 'all'
        ? characters
        : charFilter === 'standalone'
          ? standaloneChars
          : characters.filter((c) => c.worldId === charFilter);
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [characters, standaloneChars, charFilter]);

  const patchSessionOrDraft = async (patch: {
    chatMode?: ChatMode;
    personaPresetId?: string;
    roleCharacterId?: string;
    userIdentity?: UserIdentityRef;
    userRelationOverride?: SessionUserRelationOverride;
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

  const handleManageChars = () => {
    setOpen(false);
    if (charFilter !== 'all' && charFilter !== 'standalone') {
      void selectWorld(charFilter);
      setActiveView('worlds');
    } else {
      openStandaloneCharacters(false);
    }
  };

  const isRoleMode = chatMode === 'character_role';
  const isLegacyPersona = chatMode === 'custom_persona';

  const activeUserIdentityRef = session ? session.userIdentity : draftConfig.userIdentity;
  const activeUserRelationOverride = session
    ? session.userRelationOverride
    : draftConfig.userRelationOverride;

  const resolvedUserIdentity = useMemo(
    () =>
      isRoleMode
        ? resolveUserIdentity(activeUserIdentityRef, userPersonas, characters)
        : null,
    [isRoleMode, activeUserIdentityRef, userPersonas, characters]
  );

  const userDisplayName = useMemo(
    () =>
      resolveUserAddress({
        identity: resolvedUserIdentity,
        roleCharacter: activeRoleChar,
        override: activeUserRelationOverride,
      }),
    [resolvedUserIdentity, activeRoleChar, activeUserRelationOverride]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="session-mode-trigger"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] transition cursor-pointer ${
          chatMode === 'assistant'
            ? 'bg-muted text-secondary hover:bg-hover'
            : 'bg-accent-soft text-accent font-medium'
        }`}
      >
        {isRoleMode ? (
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
            {resolvedUserIdentity && (
              <>
                <span className="text-dim">↔</span>
                <UserRound className="w-3.5 h-3.5 shrink-0" />
                <span>我：{userDisplayName || resolvedUserIdentity.name}</span>
              </>
            )}
          </>
        ) : isLegacyPersona ? (
          <>
            <UserRound className="w-3.5 h-3.5 shrink-0" />
            <span>人设：{activePreset?.name || '自定义人设'}</span>
          </>
        ) : (
          <>
            <Bot className="w-3.5 h-3.5 shrink-0" />
            <span>通用助手</span>
            {promptOverride.trim() && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title="已设临时指令" />
            )}
          </>
        )}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-end md:items-center justify-center p-0 md:p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="w-full md:max-w-xl rounded-t-2xl md:rounded-xl bg-card border border-line shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <span className="text-[15px] font-semibold text-ink">对话模式</span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 text-dim hover:text-ink cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto space-y-4 text-[13px]">
                {/* 2 Mode Cards */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      patchSessionOrDraft({
                        chatMode: 'assistant',
                        roleCharacterId: undefined,
                        personaPresetId: undefined,
                        ...(chatMode !== 'assistant' ? { systemPromptOverride: '' } : {}),
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
                    <div className="text-[11.5px] text-dim mt-1">
                      日常问答、写作顾问，支持随时附加临时指令
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      patchSessionOrDraft({
                        chatMode: 'character_role',
                        personaPresetId: undefined,
                        ...(chatMode !== 'character_role' ? { systemPromptOverride: '' } : {}),
                      })
                    }
                    className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                      isRoleMode
                        ? 'border-accent bg-accent-soft'
                        : 'border-line hover:bg-hover'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-ink text-[13px]">
                      <Users className="w-4 h-4 text-accent shrink-0" />
                      <span>角色对话</span>
                    </div>
                    <div className="text-[11.5px] text-dim mt-1">
                      独立角色或作品角色，支持立绘、语音与专属人设
                    </div>
                  </button>
                </div>

                {/* Assistant Details */}
                {chatMode === 'assistant' && (
                  <div className="rounded-xl bg-sidebar border border-line overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setAssistantPromptOpen((v) => !v)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 text-[13px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        {assistantPromptOpen ? (
                          <ChevronDown className="w-4 h-4 text-accent" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-dim" />
                        )}
                        <span>本次对话临时指令（可选）</span>
                      </span>
                      {promptOverride.trim() && (
                        <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                          已设置
                        </span>
                      )}
                    </button>
                    {assistantPromptOpen && (
                      <div className="p-3.5 pt-2 border-t border-line space-y-1.5">
                        <p className="text-[11.5px] text-dim">
                          仅对当前会话生效，留空则使用全局设置中的系统提示词。
                        </p>
                        <textarea
                          rows={3}
                          value={promptOverride}
                          onChange={(e) =>
                            patchSessionOrDraft({ systemPromptOverride: e.target.value })
                          }
                          placeholder="例如：请充当中英双语润色编辑，用简洁要点体给出修改建议..."
                          className="w-full p-2.5 rounded-xl bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Unified Character Role Details */}
                {(isRoleMode || isLegacyPersona) && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-secondary text-[13px]">
                        选择角色卡（点击立即切换）
                      </span>
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={handleManageChars}
                          className="text-[13px] text-secondary hover:text-ink hover:underline cursor-pointer"
                        >
                          管理角色卡
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            openStandaloneCharacters(true);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-soft text-accent text-[13px] font-medium hover:opacity-90 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>新建独立角色</span>
                        </button>
                      </div>
                    </div>

                    {characters.length === 0 ? (
                      <div className="p-5 rounded-xl border border-dashed border-line text-center space-y-2.5">
                        <div className="text-secondary text-[13px]">还没有任何角色卡</div>
                        <p className="text-[11.5px] text-dim">
                          可以直接新建不绑定作品的独立角色（支持 AI 生图、绑定音色和自由提示词），或在作品中创建角色。
                        </p>
                        <div className="flex flex-wrap justify-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              openStandaloneCharacters(true);
                            }}
                            className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-accent text-white text-[13px] font-medium cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>新建独立角色</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              setActiveView('worlds');
                            }}
                            className="px-3.5 py-1.5 rounded-xl border border-line text-secondary text-[13px] hover:bg-hover cursor-pointer"
                          >
                            去作品工坊
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Filter Pills */}
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setCharFilter('all')}
                            className={`px-2.5 py-1 rounded-lg border text-[11.5px] cursor-pointer transition ${
                              charFilter === 'all'
                                ? 'bg-accent text-white border-transparent font-medium'
                                : 'border-line text-secondary hover:bg-hover'
                            }`}
                          >
                            全部 ({characters.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setCharFilter('standalone')}
                            className={`px-2.5 py-1 rounded-lg border text-[11.5px] cursor-pointer transition ${
                              charFilter === 'standalone'
                                ? 'bg-accent text-white border-transparent font-medium'
                                : 'border-line text-secondary hover:bg-hover'
                            }`}
                          >
                            独立角色 ({standaloneChars.length})
                          </button>
                          {worldBuckets.map(({ world, count }) => (
                            <button
                              key={world.id}
                              type="button"
                              onClick={() => setCharFilter(world.id)}
                              className={`px-2.5 py-1 rounded-lg border text-[11.5px] cursor-pointer transition ${
                                charFilter === world.id
                                  ? 'bg-accent text-white border-transparent font-medium'
                                  : 'border-line text-secondary hover:bg-hover'
                              }`}
                            >
                              《{world.name}》({count})
                            </button>
                          ))}
                        </div>

                        {filteredChars.length === 0 ? (
                          <div className="p-4 rounded-xl border border-dashed border-line text-center text-[13px] text-dim">
                            该分类下暂无角色卡
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                            {filteredChars.map((c) => {
                              const selected = roleCharacterId === c.id;
                              const boundWorldName = c.worldId ? worldNameMap.get(c.worldId) : undefined;
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={async () => {
                                    // 组合键变了：旧关系覆盖作废，按新组合重新继承
                                    const inherited = inheritUserRelationOverride(
                                      c.id,
                                      activeUserIdentityRef,
                                      session?.id
                                    );
                                    await patchSessionOrDraft({
                                      chatMode: 'character_role',
                                      roleCharacterId: c.id,
                                      personaPresetId: undefined,
                                      userRelationOverride: inherited,
                                      ...(c.worldId
                                        ? { worldId: c.worldId, enableWorldContext: true }
                                        : { worldId: undefined, enableWorldContext: false }),
                                    });
                                    setOpen(false);
                                  }}
                                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left cursor-pointer transition ${
                                    selected
                                      ? 'border-accent bg-accent-soft'
                                      : 'border-line hover:bg-hover'
                                  }`}
                                >
                                  {c.avatarImage ? (
                                    <img
                                      src={c.avatarImage}
                                      alt={c.name}
                                      className="w-9 h-9 rounded-full object-cover shrink-0 border border-line"
                                    />
                                  ) : (
                                    <div
                                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                                      style={{ backgroundColor: c.avatarColor || '#4d6bfe' }}
                                    >
                                      {c.name.slice(0, 1)}
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-1.5">
                                      <span className="text-[13px] font-medium text-ink truncate">
                                        {c.name}
                                      </span>
                                      <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-muted text-dim shrink-0">
                                        {boundWorldName ? `《${boundWorldName}》` : '独立'}
                                      </span>
                                    </div>
                                    <div className="text-[11.5px] text-dim truncate mt-0.5">
                                      {c.identity || c.personality || c.systemPrompt || '角色卡'}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}

                    {/* 「我」以谁的身份进入这次对话 */}
                    {isRoleMode && (
                      <UserIdentitySection
                        session={session}
                        draftConfig={draftConfig}
                        roleCharacterId={roleCharacterId}
                        onPatch={patchSessionOrDraft}
                      />
                    )}

                    {/* Collapsible per-session scenario note */}
                    <div className="rounded-xl bg-sidebar border border-line overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setRoleExtraOpen((v) => !v)}
                        className="w-full flex items-center justify-between px-3.5 py-2 text-[13px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5">
                          {roleExtraOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-accent" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-dim" />
                          )}
                          <span>补充情境与要求（仅本次对话生效）</span>
                        </span>
                        {promptOverride.trim() && (
                          <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                            已设置
                          </span>
                        )}
                      </button>
                      {roleExtraOpen && (
                        <div className="p-3 pt-2 border-t border-line">
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
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
