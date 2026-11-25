import React, { useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  MessageSquare,
  Plus,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import type {
  AppSettings,
  Character,
  ProviderConfig,
  RelationType,
  VoiceProfile,
  WorldProject,
} from '../../../types';
import { OptionPicker } from '../../Common/OptionPicker';
import { ImageLightbox } from '../../Common/ImageLightbox';
import {
  findTtsPresetByBaseUrl,
  speakText,
  stopSpeaking,
  TTS_PRESETS,
} from '../../../services/voiceService';
import { RELATION_TYPE_META } from '../../../services/temporalGraph';
import { CharacterPortraitSection } from './CharacterPortraitSection';

export const AVATAR_COLORS = [
  '#4d6bfe',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
];

/** 清掉空白字段；全空则整个钩子不落库，避免老卡被写入一堆空串 */
export function normalizeUserHook(hook?: Character['userRelation']): Character['userRelation'] {
  if (!hook) return undefined;
  const next = {
    defaultAddress: hook.defaultAddress?.trim() || undefined,
    defaultRelationType: hook.defaultRelationType,
    defaultRelationLabel: hook.defaultRelationLabel?.trim() || undefined,
    defaultRelationDesc: hook.defaultRelationDesc?.trim() || undefined,
    slotHint: hook.slotHint?.trim() || undefined,
  };
  return Object.values(next).some((v) => v !== undefined) ? next : undefined;
}

function formatVoiceProfileOption(vp: VoiceProfile): string {
  const provider =
    vp.engine === 'native'
      ? '系统原生'
      : (
          TTS_PRESETS.find((p) => p.id === vp.providerId) ||
          (vp.baseUrl ? findTtsPresetByBaseUrl(vp.baseUrl) : undefined)
        )?.name
          .split('（')[0]
          .trim() || 'API';
  return `${vp.name}（${vp.isCloned ? `${provider} · 克隆` : provider}）`;
}

interface CharacterEditorProps {
  editing: Character;
  setEditing: React.Dispatch<React.SetStateAction<Character | null>>;
  originalWorldId: string;
  isSaved: boolean;
  worlds: WorldProject[];
  editingWorld?: WorldProject;
  providers: ProviderConfig[];
  settings: AppSettings;
  voiceProfiles: VoiceProfile[];
  imgPrompt: string;
  setImgPrompt: React.Dispatch<React.SetStateAction<string>>;
  imgPromptDirty: boolean;
  setImgPromptDirty: React.Dispatch<React.SetStateAction<boolean>>;
  imgPromptOpen: boolean;
  setImgPromptOpen: React.Dispatch<React.SetStateAction<boolean>>;
  imgError: string | null;
  setImgError: React.Dispatch<React.SetStateAction<string | null>>;
  onBack: () => void;
  onSave: () => Promise<Character | null>;
  onDelete: (char: Character) => void;
  onStartRoleChat: (char: Character) => void;
  onOpenVoiceStudio: (subTab: 'library' | 'create') => void;
  onOpenImageConfig: () => void;
  onExportCard?: (char: Character) => void;
  showToast: (text: string, tone?: 'info' | 'success' | 'error') => void;
}

export const CharacterEditor: React.FC<CharacterEditorProps> = ({
  editing,
  setEditing,
  originalWorldId,
  isSaved,
  worlds,
  editingWorld,
  providers,
  settings,
  voiceProfiles,
  imgPrompt,
  setImgPrompt,
  imgPromptDirty,
  setImgPromptDirty,
  imgPromptOpen,
  setImgPromptOpen,
  imgError,
  setImgError,
  onBack,
  onSave,
  onDelete,
  onStartRoleChat,
  onOpenVoiceStudio,
  onOpenImageConfig,
  onExportCard,
  showToast,
}) => {
  const [showSystemPromptBox, setShowSystemPromptBox] = useState(() =>
    Boolean(editing.systemPrompt?.trim())
  );
  const [showUserHookBox, setShowUserHookBox] = useState(() =>
    Boolean(normalizeUserHook(editing.userRelation))
  );
  const [showCustomVoiceInput, setShowCustomVoiceInput] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);

  const updateUserHook = (patch: Partial<NonNullable<Character['userRelation']>>) => {
    setEditing({ ...editing, userRelation: { ...(editing.userRelation || {}), ...patch } });
  };

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0 rounded-xl bg-card border border-line overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line bg-sidebar">
          <button
            onClick={() => {
              setPreviewImage(null);
              onBack();
            }}
            className="flex items-center gap-1.5 text-[13px] font-medium text-secondary hover:text-ink cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回角色列表</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {editing.name.trim() && onExportCard && (
              <button
                type="button"
                onClick={() => onExportCard(editing)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[13px] border border-line bg-canvas text-secondary hover:text-ink hover:bg-hover cursor-pointer whitespace-nowrap"
                title="打包导出可分享角色卡（含立绘与音色信息，自动剥离 API Key）"
              >
                <Download className="w-3.5 h-3.5" />
                <span>分享卡片</span>
              </button>
            )}
            {editing.name.trim() && (
              <button
                type="button"
                onClick={() => onStartRoleChat(editing)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[13px] border border-accent/40 bg-accent-soft text-accent font-medium hover:opacity-90 cursor-pointer whitespace-nowrap"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>以该角色对话</span>
              </button>
            )}
            {isSaved && (
              <button
                onClick={() => onDelete(editing)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[13px] text-danger border border-danger/30 hover:bg-danger/10 cursor-pointer whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除</span>
              </button>
            )}
            <button
              onClick={() => void onSave()}
              disabled={!editing.name.trim()}
              className="px-4 py-1.5 rounded-xl text-[13px] font-medium bg-accent text-white disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              保存角色
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-2xl mx-auto space-y-4 text-[13px]">
            <CharacterPortraitSection
              editing={editing}
              setEditing={setEditing}
              editingWorld={editingWorld}
              settings={settings}
              providers={providers}
              imgPrompt={imgPrompt}
              setImgPrompt={setImgPrompt}
              imgPromptDirty={imgPromptDirty}
              setImgPromptDirty={setImgPromptDirty}
              imgPromptOpen={imgPromptOpen}
              setImgPromptOpen={setImgPromptOpen}
              imgError={imgError}
              setImgError={setImgError}
              onPreviewImage={setPreviewImage}
              onOpenImageConfig={onOpenImageConfig}
              showToast={showToast}
            />

            <div>
              <label className="block mb-1.5 font-medium text-secondary">所属作品</label>
              <OptionPicker
                value={editing.worldId}
                items={[
                  { value: '', label: '不绑定作品（独立角色）' },
                  ...worlds.map((w) => ({
                    value: w.id,
                    label: `《${w.name}》${w.genre ? ` · ${w.genre}` : ''}`,
                  })),
                ]}
                onChange={(value) => setEditing({ ...editing, worldId: value })}
              />
              {originalWorldId && originalWorldId !== editing.worldId && (
                <p className="mt-1 text-[11.5px] text-amber-500">
                  更改所属作品后，保存时将自动移除该角色在原作品中的关系连线与时间线出场标记。
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block mb-1.5 font-medium text-secondary">姓名 *</label>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例如：林澈"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block mb-1.5 font-medium text-secondary">身份 / 定位</label>
                <input
                  value={editing.identity}
                  onChange={(e) => setEditing({ ...editing, identity: e.target.value })}
                  placeholder="例如：主角 · 边境调查员"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block mb-1.5 font-medium text-secondary">标识色</label>
                <div className="flex items-center gap-2.5 pt-1">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditing({ ...editing, avatarColor: c })}
                      className={`w-7 h-7 rounded-full cursor-pointer transition ${
                        editing.avatarColor === c ? 'ring-2 ring-accent scale-110' : 'opacity-80'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`选择颜色 ${c}`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="font-medium text-secondary">绑定角色声音（可选）</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenVoiceStudio('library')}
                      className="text-[11.5px] text-secondary hover:text-accent hover:underline cursor-pointer"
                    >
                      管理声音库
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenVoiceStudio('create')}
                      className="flex items-center gap-0.5 text-[11.5px] text-accent font-medium hover:underline cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>新建声音</span>
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <OptionPicker
                      value={editing.voiceProfileId || ''}
                      items={[
                        { value: '', label: '跟随全局默认声音' },
                        ...voiceProfiles.map((vp) => ({
                          value: vp.id,
                          label: formatVoiceProfileOption(vp),
                        })),
                      ]}
                      onChange={(value) =>
                        setEditing({ ...editing, voiceProfileId: value || undefined })
                      }
                      searchable={voiceProfiles.length > 8}
                      searchPlaceholder="搜索声音档案…"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (previewingVoice) {
                        stopSpeaking();
                        setPreviewingVoice(false);
                        return;
                      }
                      const profile = editing.voiceProfileId
                        ? voiceProfiles.find((vp) => vp.id === editing.voiceProfileId)
                        : undefined;
                      setPreviewingVoice(true);
                      await speakText({
                        text: `你好，我是${editing.name.trim() || '角色'}。`,
                        config: settings.voice,
                        providers,
                        profile,
                        voiceOverride: profile ? undefined : editing.voiceName?.trim() || undefined,
                        onEnd: () => setPreviewingVoice(false),
                        onError: (msg) => {
                          setPreviewingVoice(false);
                          showToast(msg, 'error');
                        },
                      });
                    }}
                    className="flex items-center gap-1 px-2.5 py-2 rounded-xl border border-line bg-canvas text-[13px] text-ink hover:border-accent cursor-pointer shrink-0"
                    title="试听当前选中的角色声音"
                  >
                    {previewingVoice ? (
                      <Square className="w-3.5 h-3.5 text-accent" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-accent" />
                    )}
                    <span>{previewingVoice ? '停止' : '试听'}</span>
                  </button>
                </div>

                <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={() => setShowCustomVoiceInput((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11.5px] text-dim hover:text-secondary cursor-pointer"
                  >
                    {showCustomVoiceInput || editing.voiceName ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    <span>高级：直接填写外部音色 ID（仅未选声音库档案时生效）</span>
                  </button>
                  {(showCustomVoiceInput || Boolean(editing.voiceName)) && (
                    <input
                      value={editing.voiceName || ''}
                      onChange={(e) => setEditing({ ...editing, voiceName: e.target.value })}
                      placeholder="例如 FunAudioLLM/CosyVoice2-0.5B:anna"
                      className="w-full mt-1.5 px-3 py-1.5 rounded-xl bg-canvas border border-line text-[13px] font-mono text-ink outline-none focus:border-accent"
                    />
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">性格特点</label>
              <textarea
                rows={3}
                value={editing.personality}
                onChange={(e) => setEditing({ ...editing, personality: e.target.value })}
                placeholder="例如：表面冷静克制，实则对旧日誓言极为执着，说话简洁少废话。"
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">目前状态</label>
              <input
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                placeholder="例如：正在前往北境调查失踪案，负轻伤"
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">人物关系简记</label>
              <textarea
                rows={3}
                value={editing.relationsNote}
                onChange={(e) => setEditing({ ...editing, relationsNote: e.target.value })}
                placeholder="例如：与苏岚：旧日搭档，因三年前事故产生隔阂；与沈老：师徒，受其暗中庇护。"
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div className="rounded-xl bg-sidebar border border-line overflow-hidden">
              <button
                type="button"
                onClick={() => setShowUserHookBox((v) => !v)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-[13px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  {showUserHookBox || Boolean(normalizeUserHook(editing.userRelation)) ? (
                    <ChevronDown className="w-4 h-4 text-accent" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-dim" />
                  )}
                  <span>与「我」的关系钩子（可选 · 独立角色尤其有用）</span>
                </span>
                {Boolean(normalizeUserHook(editing.userRelation)) && (
                  <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                    已启用
                  </span>
                )}
              </button>
              {(showUserHookBox || Boolean(normalizeUserHook(editing.userRelation))) && (
                <div className="p-3.5 pt-2 border-t border-line space-y-2">
                  <p className="text-[11.5px] text-dim">
                    这张卡被当成对话对象时的默认设定：默认怎么称呼「我」、默认是什么关系。用户在对话里随时能覆盖，
                    不会改到卡本身。
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={editing.userRelation?.defaultAddress || ''}
                      onChange={(e) => updateUserHook({ defaultAddress: e.target.value })}
                      placeholder="默认称呼，例如：旅人"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                    />
                    <select
                      value={editing.userRelation?.defaultRelationType || ''}
                      onChange={(e) =>
                        updateUserHook({
                          defaultRelationType: (e.target.value || undefined) as
                            | RelationType
                            | undefined,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                    >
                      <option value="">默认关系类型：不指定</option>
                      {(Object.keys(RELATION_TYPE_META) as RelationType[]).map((t) => (
                        <option key={t} value={t}>
                          {RELATION_TYPE_META[t].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    value={editing.userRelation?.defaultRelationLabel || ''}
                    onChange={(e) => updateUserHook({ defaultRelationLabel: e.target.value })}
                    placeholder="默认关系标签，例如：点头之交"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                  />
                  <input
                    value={editing.userRelation?.defaultRelationDesc || ''}
                    onChange={(e) => updateUserHook({ defaultRelationDesc: e.target.value })}
                    placeholder="默认关系描述，例如：在渡口见过几面"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                  />
                  <input
                    value={editing.userRelation?.slotHint || ''}
                    onChange={(e) => updateUserHook({ slotHint: e.target.value })}
                    placeholder="可选项提示，例如：用户可以是他的同门 / 他早年失散的宿敌"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block mb-1.5 font-medium text-secondary">
                补充备注（外貌、习惯、背景）
              </label>
              <textarea
                rows={4}
                value={editing.notes}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                placeholder="任何想让 AI 注意的角色细节..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas border border-line text-[15px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div className="rounded-xl bg-sidebar border border-line overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSystemPromptBox((v) => !v)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-[13px] font-medium text-secondary hover:text-ink hover:bg-hover cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  {showSystemPromptBox || Boolean(editing.systemPrompt?.trim()) ? (
                    <ChevronDown className="w-4 h-4 text-accent" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-dim" />
                  )}
                  <span>自定义系统提示词（可选 · 适合工具型/自由人设）</span>
                </span>
                {Boolean(editing.systemPrompt?.trim()) && (
                  <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                    已启用
                  </span>
                )}
              </button>
              {(showSystemPromptBox || Boolean(editing.systemPrompt?.trim())) && (
                <div className="p-3.5 pt-2 border-t border-line space-y-1.5">
                  <p className="text-[11.5px] text-dim">
                    留空时将按上方角色档案自动生成第一人称扮演提示词；填写后将直接使用这里的内容作为完整系统提示词（仍可保留声音绑定和立绘）。
                  </p>
                  <textarea
                    rows={4}
                    value={editing.systemPrompt || ''}
                    onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
                    placeholder="例如：你是一位冷静毒舌的剑修师兄…… 或 你是我的中英小说润色编辑……"
                    className="w-full px-3 py-2 rounded-xl bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {previewImage && (
        <ImageLightbox
          src={previewImage.src}
          alt={previewImage.alt}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </>
  );
};
