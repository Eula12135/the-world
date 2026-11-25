import React, { useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, Sparkles, X, ZoomIn } from 'lucide-react';
import type { Character, ImageFramingId, ProviderConfig, WorldProject } from '../../../types';
import {
  buildCharacterImagePrompt,
  compressImageDataToDataUrl,
  generateImage,
} from '../../../services/imageGenService';
import { generateImagePrompt } from '../../../services/imagePromptService';
import { IMAGE_FRAMINGS, getFramingById, resolveImageFraming } from '../../../utils/imageFraming';
import {
  IMAGE_STYLE_NONE_ID,
  IMAGE_STYLE_PRESETS,
  IMAGE_STYLE_QUICK_COUNT,
  resolveCharacterStylePrompt,
} from '../../../data/imageStyles';
import { isProviderReady } from '../../../utils/platform';
import type { AppSettings } from '../../../types';

function chipClass(active: boolean): string {
  return `rounded-full border px-1.5 py-0.5 text-[11.5px] cursor-pointer transition ${
    active
      ? 'border-accent bg-accent-soft text-accent font-medium'
      : 'border-line bg-canvas text-secondary hover:bg-hover'
  }`;
}

interface CharacterPortraitSectionProps {
  editing: Character;
  setEditing: React.Dispatch<React.SetStateAction<Character | null>>;
  editingWorld?: WorldProject;
  settings: AppSettings;
  providers: ProviderConfig[];
  imgPrompt: string;
  setImgPrompt: React.Dispatch<React.SetStateAction<string>>;
  imgPromptDirty: boolean;
  setImgPromptDirty: React.Dispatch<React.SetStateAction<boolean>>;
  imgPromptOpen: boolean;
  setImgPromptOpen: React.Dispatch<React.SetStateAction<boolean>>;
  imgError: string | null;
  setImgError: React.Dispatch<React.SetStateAction<string | null>>;
  onPreviewImage: (img: { src: string; alt: string }) => void;
  onOpenImageConfig: () => void;
  showToast: (text: string, tone?: 'info' | 'success' | 'error') => void;
}

export const CharacterPortraitSection: React.FC<CharacterPortraitSectionProps> = ({
  editing,
  setEditing,
  editingWorld,
  settings,
  providers,
  imgPrompt,
  setImgPrompt,
  imgPromptDirty,
  setImgPromptDirty,
  imgPromptOpen,
  setImgPromptOpen,
  imgError,
  setImgError,
  onPreviewImage,
  onOpenImageConfig,
  showToast,
}) => {
  const [showAllStyles, setShowAllStyles] = useState(false);
  const [generatingImg, setGeneratingImg] = useState(false);
  const [refiningPrompt, setRefiningPrompt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const visibleStyles = showAllStyles
    ? IMAGE_STYLE_PRESETS
    : IMAGE_STYLE_PRESETS.slice(0, IMAGE_STYLE_QUICK_COUNT);

  const activeFraming = useMemo(
    () =>
      editing.imageFramingId
        ? getFramingById(editing.imageFramingId)
        : resolveImageFraming(settings.imageGen.size),
    [editing.imageFramingId, settings.imageGen.size]
  );

  const stylePrompt = useMemo(
    () => resolveCharacterStylePrompt(editing.imageStyleId, settings.imageGen.styleHint),
    [editing.imageStyleId, settings.imageGen.styleHint]
  );

  const handleUploadAvatar = async (file: File) => {
    setImgError(null);
    try {
      const dataUrl = await compressImageDataToDataUrl(file, 512, 0.85);
      setEditing((prev) => (prev ? { ...prev, avatarImage: dataUrl } : prev));
      showToast('角色图片已压缩载入，记得点击「保存角色」', 'success');
    } catch (err) {
      setImgError(err instanceof Error ? err.message : '读取图片失败');
    }
  };

  const handleAiRefinePrompt = async () => {
    const readyProviders = providers.filter((p) => p.enabled && isProviderReady(p));
    const provider =
      readyProviders.find((p) => p.id === settings.defaultProviderId) || readyProviders[0];
    if (!provider) {
      showToast('没有已配置 API Key 的可用文本模型，请先在「模型」页填写密钥', 'error');
      return;
    }
    const model = provider.selectedModel || provider.models[0];
    setRefiningPrompt(true);
    setImgError(null);
    try {
      const text = await generateImagePrompt({
        provider,
        model,
        character: editing,
        world: editingWorld,
        size: activeFraming.size,
      });
      if (!text) {
        showToast('模型没有返回有效的画面描述，请重试', 'error');
        return;
      }
      const prefix = stylePrompt.trim();
      setImgPrompt(prefix ? `${prefix}，${text}` : text);
      setImgPromptDirty(false);
      showToast('已用 AI 提炼画面描述，可再手动微调', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI 提炼画面描述失败', 'error');
    } finally {
      setRefiningPrompt(false);
    }
  };

  const handleGenerateAvatar = async () => {
    const promptToUse =
      imgPrompt.trim() ||
      buildCharacterImagePrompt(editing, editingWorld, stylePrompt, activeFraming.size);
    if (!imgPrompt.trim()) setImgPrompt(promptToUse);

    setGeneratingImg(true);
    setImgError(null);
    try {
      const dataUrl = await generateImage({
        config: { ...settings.imageGen, size: activeFraming.size },
        providers,
        prompt: promptToUse,
      });
      setEditing((prev) => (prev ? { ...prev, avatarImage: dataUrl } : prev));
      showToast('AI 角色图生成完成，请点击「保存角色」', 'success');
    } catch (err) {
      setImgError(err instanceof Error ? err.message : '生成角色图失败');
    } finally {
      setGeneratingImg(false);
    }
  };

  const applyFramingChoice = (framingId: ImageFramingId) => {
    const next: Character = { ...editing, imageFramingId: framingId };
    setEditing(next);
    if (!imgPromptDirty) {
      setImgPrompt(
        buildCharacterImagePrompt(next, editingWorld, stylePrompt, getFramingById(framingId).size)
      );
    }
  };

  const applyStyleChoice = (styleId: string | undefined) => {
    const next: Character = { ...editing, imageStyleId: styleId };
    setEditing(next);
    if (!imgPromptDirty) {
      setImgPrompt(
        buildCharacterImagePrompt(
          next,
          editingWorld,
          resolveCharacterStylePrompt(styleId, settings.imageGen.styleHint),
          activeFraming.size
        )
      );
    }
  };

  return (
    <div className="p-3.5 rounded-xl bg-sidebar border border-line space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          {editing.avatarImage ? (
            <button
              type="button"
              onClick={() =>
                onPreviewImage({
                  src: editing.avatarImage!,
                  alt: `${editing.name || '角色'} 立绘`,
                })
              }
              className="relative group block cursor-zoom-in rounded-xl"
              title="点击查看大图"
            >
              <img
                src={editing.avatarImage}
                alt={editing.name || '角色立绘'}
                className="w-14 h-14 rounded-xl object-cover border border-line"
              />
              <span className="absolute bottom-0.5 right-0.5 p-0.5 rounded-md bg-black/60 text-white/90 backdrop-blur-xs group-hover:bg-accent transition">
                <ZoomIn className="w-2.5 h-2.5" />
              </span>
            </button>
          ) : (
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-xl font-bold"
              style={{ backgroundColor: editing.avatarColor || '#4d6bfe' }}
            >
              {(editing.name || '?').slice(0, 1)}
            </div>
          )}
          {editing.avatarImage && (
            <button
              type="button"
              onClick={() => setEditing({ ...editing, avatarImage: undefined })}
              className="absolute -right-1.5 -top-1.5 p-0.5 rounded-full bg-canvas border border-line text-dim hover:text-danger cursor-pointer"
              title="清除角色图"
              aria-label="清除角色图"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">角色形象</div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUploadAvatar(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1 text-[11.5px] text-secondary hover:bg-hover cursor-pointer"
        >
          <ImagePlus className="w-3.5 h-3.5" />
          <span>上传</span>
        </button>
        <button
          type="button"
          onClick={() => {
            const nextOpen = !imgPromptOpen;
            setImgPromptOpen(nextOpen);
            if (nextOpen && !imgPrompt.trim()) {
              setImgPrompt(
                buildCharacterImagePrompt(editing, editingWorld, stylePrompt, activeFraming.size)
              );
            }
          }}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:opacity-95 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>生成</span>
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="w-6 shrink-0 text-[11.5px] text-dim">取景</span>
        <div className="flex flex-wrap gap-1">
          {IMAGE_FRAMINGS.map((framing) => (
            <button
              key={framing.id}
              type="button"
              onClick={() => applyFramingChoice(framing.id)}
              className={chipClass(activeFraming.id === framing.id)}
            >
              {framing.short}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="w-6 shrink-0 text-[11.5px] text-dim">风格</span>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => applyStyleChoice(undefined)}
            className={chipClass(!editing.imageStyleId)}
          >
            默认
          </button>
          <button
            type="button"
            onClick={() => applyStyleChoice(IMAGE_STYLE_NONE_ID)}
            className={chipClass(editing.imageStyleId === IMAGE_STYLE_NONE_ID)}
          >
            不指定
          </button>
          {visibleStyles.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyStyleChoice(preset.id)}
              className={chipClass(editing.imageStyleId === preset.id)}
            >
              {preset.label}
            </button>
          ))}
          {IMAGE_STYLE_PRESETS.length > IMAGE_STYLE_QUICK_COUNT && (
            <button
              type="button"
              onClick={() => setShowAllStyles((prev) => !prev)}
              className="rounded-full px-1.5 py-0.5 text-[11.5px] text-dim hover:text-accent cursor-pointer"
            >
              {showAllStyles ? '收起' : '更多'}
            </button>
          )}
        </div>
      </div>

      {!imgPromptOpen ? (
        <button
          type="button"
          onClick={() => {
            setImgPromptOpen(true);
            if (!imgPrompt.trim()) {
              setImgPrompt(
                buildCharacterImagePrompt(editing, editingWorld, stylePrompt, activeFraming.size)
              );
            }
          }}
          className="flex w-full items-center justify-between gap-2 border-t border-line pt-2 text-left cursor-pointer"
        >
          <span className="min-w-0 truncate text-[11.5px] text-dim">
            提示词 · {imgPrompt || '按设定自动拼装'}
          </span>
          <span className="shrink-0 text-[11.5px] font-medium text-accent">编辑</span>
        </button>
      ) : (
        <div className="space-y-2 border-t border-line pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11.5px] text-dim">
              {settings.imageGen.model} · {activeFraming.label}
            </span>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => void handleAiRefinePrompt()}
                disabled={refiningPrompt}
                className="flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline disabled:opacity-50 cursor-pointer"
                title="用文本模型从角色卡里提炼，会剔除台词与剧情"
              >
                {refiningPrompt ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                <span>{refiningPrompt ? '提炼中…' : 'AI 提炼'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setImgPrompt(
                    buildCharacterImagePrompt(editing, editingWorld, stylePrompt, activeFraming.size)
                  );
                  setImgPromptDirty(false);
                }}
                className="text-[11.5px] text-dim hover:text-accent hover:underline cursor-pointer"
                title="本地按关键词拼装，不调用模型"
              >
                快速拼装
              </button>
              <button
                type="button"
                onClick={() => setImgPromptOpen(false)}
                className="text-[11.5px] text-dim hover:text-ink cursor-pointer"
              >
                收起
              </button>
            </div>
          </div>
          <textarea
            rows={3}
            value={imgPrompt}
            onChange={(e) => {
              setImgPrompt(e.target.value);
              setImgPromptDirty(true);
            }}
            placeholder="描述角色外貌、服装、神态与背景光影..."
            className="w-full p-2.5 rounded-lg bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={onOpenImageConfig}
              className="text-[11.5px] text-dim hover:text-accent underline cursor-pointer"
            >
              配置生图模型 / API Key
            </button>
            <button
              type="button"
              onClick={() => void handleGenerateAvatar()}
              disabled={generatingImg}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-accent text-white text-[11.5px] font-medium disabled:opacity-50 cursor-pointer"
            >
              {generatingImg ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{generatingImg ? '生成中...' : '立即生成'}</span>
            </button>
          </div>
        </div>
      )}

      {imgError && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-[11.5px]">
          <span>{imgError}</span>
          <button
            type="button"
            onClick={onOpenImageConfig}
            className="underline font-medium shrink-0 cursor-pointer"
          >
            前往配置生图 Key
          </button>
        </div>
      )}
    </div>
  );
};
