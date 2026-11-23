import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Undo2, Unlink, UserRound } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import { OptionPicker, type OptionPickerItem } from '../Common/OptionPicker';
import { RELATION_TYPE_META } from '../../services/temporalGraph';
import {
  resolveSessionUserRelation,
  resolveUserAddress,
  resolveUserIdentity,
} from '../../services/userIdentity';
import { createId } from '../../utils/platform';
import type {
  ChatSession,
  RelationType,
  SessionUserRelationOverride,
  UserIdentityRef,
  UserPersona,
} from '../../types';
import type { DraftSessionConfig } from '../../store/types';

interface UserIdentitySectionProps {
  session: ChatSession | null;
  draftConfig: DraftSessionConfig;
  roleCharacterId?: string;
  onPatch: (patch: {
    userIdentity?: UserIdentityRef;
    userRelationOverride?: SessionUserRelationOverride;
  }) => Promise<void> | void;
}

function parseIdentityValue(value: string): UserIdentityRef | undefined {
  if (!value) return undefined;
  const sep = value.indexOf(':');
  if (sep === -1) return undefined;
  const kind = value.slice(0, sep);
  const id = value.slice(sep + 1);
  if (!id || (kind !== 'persona' && kind !== 'character')) return undefined;
  return { kind, id };
}

export const UserIdentitySection: React.FC<UserIdentitySectionProps> = ({
  session,
  draftConfig,
  roleCharacterId,
  onPatch,
}) => {
  const {
    characters,
    userPersonas,
    relations,
    timelineEvents,
    voiceProfiles,
    worlds,
    upsertUserPersona,
    deleteUserPersona,
    createUserPersonaFromCharacter,
    inheritUserRelationOverride,
    requestConfirm,
    showToast,
  } = useAppStore(
    useShallow((s) => ({
      characters: s.characters,
      userPersonas: s.userPersonas,
      relations: s.relations,
      timelineEvents: s.timelineEvents,
      voiceProfiles: s.voiceProfiles,
      worlds: s.worlds,
      upsertUserPersona: s.upsertUserPersona,
      deleteUserPersona: s.deleteUserPersona,
      createUserPersonaFromCharacter: s.createUserPersonaFromCharacter,
      inheritUserRelationOverride: s.inheritUserRelationOverride,
      requestConfirm: s.requestConfirm,
      showToast: s.showToast,
    }))
  );

  const [relationOpen, setRelationOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formId, setFormId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftAddress, setDraftAddress] = useState('');
  const [draftIdentity, setDraftIdentity] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftVoice, setDraftVoice] = useState('');

  const identityRef = session ? session.userIdentity : draftConfig.userIdentity;
  const override = session ? session.userRelationOverride : draftConfig.userRelationOverride;
  const pointEventId = session?.storyPointEventId;

  const roleCharacter = useMemo(
    () => (roleCharacterId ? characters.find((c) => c.id === roleCharacterId) : undefined),
    [characters, roleCharacterId]
  );

  const resolved = useMemo(
    () => resolveUserIdentity(identityRef, userPersonas, characters),
    [identityRef, userPersonas, characters]
  );

  const relation = useMemo(
    () =>
      resolveSessionUserRelation({
        roleCharacter,
        userIdentity: identityRef,
        override,
        characters,
        relations,
        events: timelineEvents,
        pointEventId,
      }),
    [roleCharacter, identityRef, override, characters, relations, timelineEvents, pointEventId]
  );

  const resolvedAddress = useMemo(
    () =>
      resolveUserAddress({ identity: resolved, roleCharacter, override }),
    [resolved, roleCharacter, override]
  );

  const selectValue = identityRef ? `${identityRef.kind}:${identityRef.id}` : '';
  const identityIsCharacter = identityRef?.kind === 'character';

  const characterOptions = useMemo(
    () => characters.filter((c) => c.id !== roleCharacterId),
    [characters, roleCharacterId]
  );

  // 身份候选按「我的身份 / 独立角色 / 每个作品」分组，避免一长条平铺
  const identityItems = useMemo<OptionPickerItem[]>(() => {
    const items: OptionPickerItem[] = [
      { value: '', label: '不指定身份', hint: '角色只面对一个匿名「你」' },
    ];

    for (const persona of userPersonas) {
      items.push({
        value: `persona:${persona.id}`,
        label: persona.name,
        hint: persona.identity || undefined,
        group: '我的身份',
        color: persona.avatarColor,
        image: persona.avatarImage,
      });
    }

    const standalone = characterOptions.filter((c) => !c.worldId);
    for (const c of standalone) {
      items.push({
        value: `character:${c.id}`,
        label: c.name,
        hint: c.identity || '独立角色',
        group: '独立角色',
        color: c.avatarColor,
        image: c.avatarImage,
      });
    }

    const placed = new Set<string>();
    for (const world of worlds) {
      const inWorld = characterOptions.filter((c) => c.worldId === world.id);
      if (inWorld.length === 0) continue;
      for (const c of inWorld) {
        placed.add(c.id);
        items.push({
          value: `character:${c.id}`,
          label: c.name,
          hint: c.identity || undefined,
          group: `《${world.name}》`,
          color: c.avatarColor,
          image: c.avatarImage,
        });
      }
    }

    // 作品被删掉的角色，兜底归到「其他」
    for (const c of characterOptions) {
      if (!c.worldId || placed.has(c.id)) continue;
      items.push({
        value: `character:${c.id}`,
        label: c.name,
        hint: c.identity || '未归属作品',
        group: '其他',
        color: c.avatarColor,
        image: c.avatarImage,
      });
    }

    return items;
  }, [userPersonas, characterOptions, worlds]);

  const relationTypeItems = useMemo<OptionPickerItem[]>(
    () => [
      { value: '', label: '跟随默认' },
      ...(Object.keys(RELATION_TYPE_META) as RelationType[]).map((t) => ({
        value: t,
        label: RELATION_TYPE_META[t].label,
      })),
    ],
    []
  );

  const handleIdentityChange = async (value: string) => {
    const ref = parseIdentityValue(value);
    // 组合键变了，旧的关系覆盖立即失效，再按新组合继承最近一次
    const inherited = ref
      ? inheritUserRelationOverride(roleCharacterId, ref, session?.id)
      : undefined;
    await onPatch({ userIdentity: ref, userRelationOverride: inherited });
  };

  const setOverrideField = async (
    key: keyof SessionUserRelationOverride,
    value: string
  ) => {
    const next: SessionUserRelationOverride = { ...(override || {}) };
    if (value.trim()) {
      if (key === 'type') next.type = value as RelationType;
      else next[key] = value;
    } else {
      delete next[key];
    }
    await onPatch({
      userRelationOverride: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  const openCreateForm = () => {
    setFormId(null);
    setDraftName('');
    setDraftAddress('');
    setDraftIdentity('');
    setDraftDesc('');
    setDraftVoice('');
    setFormOpen(true);
  };

  const openEditForm = () => {
    if (!resolved || resolved.kind !== 'persona') return;
    const persona = userPersonas.find((p) => p.id === resolved.sourceId);
    if (!persona) return;
    setFormId(persona.id);
    setDraftName(persona.name);
    setDraftAddress(persona.addressAs);
    setDraftIdentity(persona.identity);
    setDraftDesc(persona.description);
    setDraftVoice(persona.voiceProfileId || '');
    setFormOpen(true);
  };

  const handleSubmitPersona = async () => {
    const name = draftName.trim();
    if (!name) return;
    const existing = formId ? userPersonas.find((p) => p.id === formId) : undefined;
    const now = Date.now();
    const persona: UserPersona = {
      id: existing?.id ?? createId('up'),
      name,
      addressAs: draftAddress.trim(),
      identity: draftIdentity.trim(),
      description: draftDesc.trim(),
      avatarImage: existing?.avatarImage,
      avatarColor: existing?.avatarColor || '#4d6bfe',
      voiceProfileId: draftVoice || undefined,
      sourceCharacterId: existing?.sourceCharacterId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await upsertUserPersona(persona);
    setFormOpen(false);
    if (!existing) await handleIdentityChange(`persona:${persona.id}`);
    showToast(existing ? `已更新身份「${name}」` : `已创建身份「${name}」`, 'success');
  };

  const handleSeparate = async () => {
    if (!identityRef || identityRef.kind !== 'character') return;
    const newId = await createUserPersonaFromCharacter(identityRef.id);
    if (!newId) {
      showToast('分离失败：原角色卡不存在', 'error');
      return;
    }
    await onPatch({ userIdentity: { kind: 'persona', id: newId }, userRelationOverride: override });
    showToast('已分离为独立身份，其它会话仍引用原角色卡', 'success');
  };

  const handleDeletePersona = () => {
    if (!resolved || resolved.kind !== 'persona') return;
    const target = resolved;
    requestConfirm({
      title: '删除身份',
      message: `确定删除「${target.name}」吗？引用它的会话会退回匿名。`,
      onConfirm: async () => {
        await deleteUserPersona(target.sourceId);
        showToast('身份已删除');
      },
    });
  };

  const relationHint = relation
    ? relation.source === 'graph'
      ? '关系取自人物关系图'
      : relation.source === 'card'
        ? '关系来自角色卡默认值'
        : '关系已由你自定义'
    : '尚未设定关系';

  return (
    <div className="rounded-xl border border-line bg-sidebar overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-line">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-secondary">
          <UserRound className="w-3.5 h-3.5 text-accent" />
          <span>我以谁的身份对话</span>
        </span>
        <span className="text-[11px] text-dim shrink-0">{relationHint}</span>
      </div>

      <div className="p-3.5 space-y-2.5">
        <OptionPicker
          value={selectValue}
          items={identityItems}
          onChange={(value) => void handleIdentityChange(value)}
          placeholder="不指定身份"
          searchable={characterOptions.length + userPersonas.length >= 5}
          searchPlaceholder="搜索角色或身份…"
          emptyText="没有匹配的角色或身份"
        />

        {!resolved && roleCharacter?.userRelation?.slotHint && (
          <p className="text-[11.5px] text-dim">
            这张卡预设：{roleCharacter.userRelation.slotHint}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-dim">
          {resolved ? (
            <span>
              角色会称呼你：<b className="text-secondary font-medium">{resolvedAddress}</b>
            </span>
          ) : identityRef ? (
            <span className="text-amber-500">原身份已不存在（源角色卡或身份被删了），请重新选择</span>
          ) : (
            <span>未设定身份时，行为与原来完全一致</span>
          )}

          {identityIsCharacter && (
            <button
              type="button"
              onClick={() => void handleSeparate()}
              className="inline-flex items-center gap-1 text-accent hover:underline cursor-pointer"
              title="把当前角色卡复制成一份独立的「我」，之后改原卡不再影响这个会话"
            >
              <Unlink className="w-3 h-3" />
              <span>分离为独立身份</span>
            </button>
          )}

          {resolved?.kind === 'persona' && (
            <>
              <button
                type="button"
                onClick={openEditForm}
                className="text-dim hover:text-accent hover:underline cursor-pointer"
              >
                编辑
              </button>
              <button
                type="button"
                onClick={handleDeletePersona}
                className="text-dim hover:text-red-500 hover:underline cursor-pointer"
              >
                删除该身份
              </button>
            </>
          )}

          {identityIsCharacter && resolved?.voiceProfileId && (
            <span className="text-[11px] text-dim">朗读音色跟随该角色卡</span>
          )}
        </div>

        {formOpen ? (
          <div className="rounded-xl border border-line bg-canvas p-2.5 space-y-2">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="名字（必填），例如：小澈"
              className="w-full px-2.5 py-1.5 rounded-lg bg-sidebar border border-line text-[12.5px] text-ink outline-none focus:border-accent"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                value={draftAddress}
                onChange={(e) => setDraftAddress(e.target.value)}
                placeholder="角色怎么称呼我（可留空）"
                className="w-full px-2.5 py-1.5 rounded-lg bg-sidebar border border-line text-[12.5px] text-ink outline-none focus:border-accent"
              />
              <input
                value={draftIdentity}
                onChange={(e) => setDraftIdentity(e.target.value)}
                placeholder="一句话身份，例如：大学同学"
                className="w-full px-2.5 py-1.5 rounded-lg bg-sidebar border border-line text-[12.5px] text-ink outline-none focus:border-accent"
              />
            </div>
            <textarea
              rows={2}
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="更细的人设（可选）：外貌、性格、与角色的过往……"
              className="w-full px-2.5 py-1.5 rounded-lg bg-sidebar border border-line text-[12.5px] text-ink outline-none focus:border-accent"
            />
            <div>
              <OptionPicker
                value={draftVoice}
                items={[
                  { value: '', label: '朗读音色：跟随全局默认' },
                  ...voiceProfiles.map((vp) => ({
                    value: vp.id,
                    label: `${vp.name}${vp.isCloned ? '（克隆）' : ''}`,
                  })),
                ]}
                onChange={setDraftVoice}
                searchable={voiceProfiles.length > 8}
                searchPlaceholder="搜索声音档案…"
              />
              <p className="mt-1 text-[11px] text-dim">
                「我」的台词可以用这张身份的音色朗读。选项来自声音库，去「设置 → 声音」可以新建音色。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-2.5 py-1 rounded-lg text-[12px] border border-line text-secondary cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSubmitPersona()}
                disabled={!draftName.trim()}
                className="px-3 py-1 rounded-lg text-[12px] bg-accent text-white disabled:opacity-40 cursor-pointer"
              >
                {formId ? '保存修改' : '创建并选用'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center gap-1 text-[12px] text-accent font-medium hover:underline cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建一个「我」</span>
          </button>
        )}

        {resolved && (
          <div className="rounded-xl border border-line overflow-hidden">
            <button
              type="button"
              onClick={() => setRelationOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                {relationOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-accent" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-dim" />
                )}
                <span>你我关系（仅本次对话）</span>
              </span>
              {(relation?.label || relation?.description) && (
                <span className="text-[11px] text-dim truncate max-w-[45%]">
                  {relation?.label || relation?.description}
                </span>
              )}
            </button>

            {relationOpen && (
              <div className="px-3 pb-3 pt-1 border-t border-line space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={override?.label || ''}
                    onChange={(e) => void setOverrideField('label', e.target.value)}
                    placeholder={
                      relation?.source === 'graph' || relation?.source === 'card'
                        ? `关系标签，默认：${relation?.label || '未设定'}`
                        : '关系标签，例如：同门师兄妹'
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                  <input
                    value={override?.address || ''}
                    onChange={(e) => void setOverrideField('address', e.target.value)}
                    placeholder={`角色怎么叫你，默认：${resolvedAddress}`}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                </div>
                <textarea
                  rows={2}
                  value={override?.description || ''}
                  onChange={(e) => void setOverrideField('description', e.target.value)}
                  placeholder={
                    relation?.description
                      ? `关系细节，默认：${relation.description}`
                      : '关系细节：怎么认识的、有什么过往……'
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[12.5px] text-ink outline-none focus:border-accent"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="w-full sm:w-52">
                    <OptionPicker
                      value={override?.type || ''}
                      items={relationTypeItems}
                      onChange={(value) => void setOverrideField('type', value)}
                      placeholder="跟随默认"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void onPatch({ userRelationOverride: undefined })}
                    className="inline-flex items-center gap-1 text-[11.5px] text-dim hover:text-accent hover:underline cursor-pointer"
                  >
                    <Undo2 className="w-3 h-3" />
                    <span>回到默认</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
