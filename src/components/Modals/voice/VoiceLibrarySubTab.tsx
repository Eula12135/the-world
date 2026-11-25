import React from 'react';
import { Check, Plus, Sliders, Square, Trash2, Volume2 } from 'lucide-react';
import type { VoiceConfig, VoiceProfile } from '../../../types';
import { extractSiliconFlowShortVoice } from '../../../services/voiceService';
import type { PendingVoiceBindTarget } from '../../../store/useAppStore';
import { getProviderDisplayName } from './constants';

interface VoiceLibrarySubTabProps {
  draftVoice: VoiceConfig;
  voiceProfiles: VoiceProfile[];
  pendingVoiceBindTarget: PendingVoiceBindTarget;
  previewText: string;
  setPreviewText: (value: string) => void;
  playingProfileId: string | null;
  onCreateNew: () => void;
  onGoToCreate: () => void;
  onPlayProfile: (vp: VoiceProfile) => void;
  onBindProfile: (profileId: string) => void;
  onSetDefaultProfile: (vp: VoiceProfile) => void;
  onClearDefaultProfile: () => void;
  onEditProfile: (vp: VoiceProfile) => void;
  onDeleteProfile: (vp: VoiceProfile) => void;
}

export const VoiceLibrarySubTab: React.FC<VoiceLibrarySubTabProps> = ({
  draftVoice,
  voiceProfiles,
  pendingVoiceBindTarget,
  previewText,
  setPreviewText,
  playingProfileId,
  onCreateNew,
  onGoToCreate,
  onPlayProfile,
  onBindProfile,
  onSetDefaultProfile,
  onClearDefaultProfile,
  onEditProfile,
  onDeleteProfile,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">已保存的声音档案</h3>
          <p className="text-[13px] text-dim">
            切换厂商或调整参数后可保存为独立声音档案；在角色卡或人设里可直接下拉选用。
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateNew}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-white text-[13px] font-medium hover:opacity-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>新建声音</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-canvas border border-line">
        <span className="text-[13px] text-dim shrink-0">试听台词：</span>
        <input
          value={previewText}
          onChange={(e) => setPreviewText(e.target.value)}
          className="flex-1 min-w-[180px] bg-transparent text-[13px] text-ink outline-none"
          placeholder="输入试听语句..."
        />
      </div>

      {voiceProfiles.length === 0 ? (
        <div className="py-12 px-4 text-center rounded-xl border border-dashed border-line space-y-3">
          <Volume2 className="w-9 h-9 mx-auto text-dim" />
          <div className="text-[15px] font-medium text-ink">还没有保存任何声音档案</div>
          <p className="text-[13px] text-dim max-w-md mx-auto">
            去「制作声音」选择硅基流动、Breeze、OpenAI 或系统原生语音，选好女声/男声底色并保存，就能在所有角色和会话里一键切换了。
          </p>
          <button
            type="button"
            onClick={onGoToCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white text-[13px] font-medium cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>立即制作第一个声音</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {voiceProfiles.map((vp) => {
            const isDefault = draftVoice.activeVoiceProfileId === vp.id;
            const isPlaying = playingProfileId === vp.id;
            const providerLabel = getProviderDisplayName(vp);
            const shortSf = extractSiliconFlowShortVoice(vp.voiceId || '');
            const voiceSummary = vp.isCloned
              ? '克隆音色'
              : shortSf
                ? `底色 ${shortSf}`
                : vp.voiceId || '默认音色';
            return (
              <div
                key={vp.id}
                className={`p-4 rounded-xl border flex flex-col justify-between gap-3 transition ${
                  isDefault ? 'border-accent bg-accent-soft/40' : 'border-line bg-sidebar'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-ink text-[15px] truncate">
                          {vp.name}
                        </span>
                        {isDefault && (
                          <span className="px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-accent text-white">
                            全局默认
                          </span>
                        )}
                        {vp.isCloned && (
                          <span className="px-2 py-0.5 rounded-full text-[11.5px] bg-purple-500/15 text-purple-400">
                            克隆
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-dim mt-1 truncate">
                        {providerLabel}
                        {vp.model ? ` · ${vp.model}` : ''} · {voiceSummary}
                      </div>
                    </div>
                  </div>
                  {vp.styleInstruction && (
                    <div className="text-[11.5px] text-secondary line-clamp-2 bg-canvas/80 px-2.5 py-1.5 rounded-lg border border-line/60">
                      语气：{vp.styleInstruction}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line/70">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onPlayProfile(vp)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-canvas text-[13px] text-ink hover:border-accent cursor-pointer"
                    >
                      {isPlaying ? (
                        <Square className="w-3 h-3 text-accent" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5 text-accent" />
                      )}
                      <span>{isPlaying ? '停止' : '试听'}</span>
                    </button>

                    {pendingVoiceBindTarget ? (
                      <button
                        type="button"
                        onClick={() => onBindProfile(vp.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent text-white text-[13px] font-medium hover:opacity-95 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>选用并绑定</span>
                      </button>
                    ) : isDefault ? (
                      <button
                        type="button"
                        onClick={onClearDefaultProfile}
                        className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[13px] text-secondary hover:text-ink cursor-pointer"
                        title="取消后，未绑定音色的角色不会自动使用这个声音"
                      >
                        取消默认
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSetDefaultProfile(vp)}
                        className="px-2.5 py-1 rounded-lg border border-line bg-canvas text-[13px] text-secondary hover:text-accent hover:border-accent cursor-pointer"
                      >
                        设为默认
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEditProfile(vp)}
                      className="p-1.5 rounded-lg text-secondary hover:text-ink hover:bg-hover cursor-pointer"
                      title="加载参数并编辑"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteProfile(vp)}
                      className="p-1.5 rounded-lg text-dim hover:text-danger hover:bg-danger/10 cursor-pointer"
                      title="删除此声音"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
