import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;

/**
 * 全屏图片预览。用 Portal 渲染到 body，避免被父级 transform / filter 的
 * 包含块限制（弹窗里直接写 position:fixed 会被锁在弹窗内）。
 *
 * 交互：
 * - 双指捏合 / 滚轮 / 双击：缩放
 * - 放大后可单指拖动
 * - 未放大时点击任意处关闭；放大时点击图片复位
 * - 底部有下载/保存按钮
 */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({ src, alt = '图片预览', onClose }) => {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saveState, setSaveState] = useState<'idle' | 'done' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // 原生保存完成后由 MainActivity 派发
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ ok: boolean; message?: string }>).detail;
      if (!detail) return;
      setSaveState(detail.ok ? 'done' : 'error');
      setSaveMessage(detail.message || '');
    };
    window.addEventListener('theworld-image-saved', handler);
    return () => window.removeEventListener('theworld-image-saved', handler);
  }, []);

  const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => {
      const next = clamp(prev * (e.deltaY < 0 ? 1.12 : 0.89));
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;

    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStart.current = { dist, scale };
      panStart.current = null;
    } else if (pointers.current.size === 1 && scale > 1) {
      panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart.current.dist > 0) {
        const next = clamp((dist / pinchStart.current.dist) * pinchStart.current.scale);
        if (Math.abs(next - scale) > 0.01) {
          moved.current = true;
          setScale(next);
          if (next === 1) setOffset({ x: 0, y: 0 });
        }
      }
      return;
    }

    if (panStart.current && pointers.current.size === 1) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
      setOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) panStart.current = null;
  };

  const handleStageClick = () => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    // 缩放状态下点一下先复位；已经是原始大小则关闭
    if (scale > 1.05) resetView();
    else onClose();
  };

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moved.current) {
      moved.current = false;
      return;
    }
    if (scale > 1.05) resetView();
    else onClose();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1.05) resetView();
    else setScale(2.5);
  };

  const handleSave = () => {
    const filename = `the-world-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    try {
      // 必须通过对象调用：把桥方法取出来单独调用会丢失 this，
      // Android 的 addJavascriptInterface 会抛异常。
      const bridge = window.TheWorldAndroid;
      if (bridge && typeof bridge.saveImageToGallery === 'function') {
        bridge.saveImageToGallery(src, filename);
        return;
      }
      const a = document.createElement('a');
      a.href = src;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setSaveState('done');
      setSaveMessage('已下载');
    } catch (err) {
      setSaveState('error');
      setSaveMessage(err instanceof Error ? `保存失败：${err.message}` : '保存失败');
    }
  };

  const content = (
    <div
      className="fixed inset-0 z-[999] bg-black/95 flex flex-col select-none"
      onClick={handleStageClick}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      {/* 顶部：关闭 */}
      <div className="flex items-center justify-end px-4 py-3 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/12 hover:bg-white/22 text-white cursor-pointer"
          aria-label="关闭预览"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 图片舞台 */}
      <div
        className="flex-1 min-h-0 flex items-center justify-center overflow-hidden"
        style={{ touchAction: 'none' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onClick={handleImageClick}
          onDoubleClick={handleDoubleClick}
          className="max-w-none max-h-none object-contain rounded-xl"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: pointers.current.size === 0 ? 'transform 160ms ease-out' : 'none',
            maxWidth: '100%',
            maxHeight: '100%',
            willChange: 'transform',
          }}
        />
      </div>

      {/* 底部：下载 */}
      <div className="shrink-0 flex flex-col items-center gap-1.5 pb-6 pt-3" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-white text-black text-[13px] font-semibold cursor-pointer active:opacity-80"
        >
          <Download className="w-4 h-4" />
          <span>{saveState === 'done' ? '已保存' : saveState === 'error' ? '保存失败' : '下载图片'}</span>
        </button>
        <div className={`text-[11px] ${saveState === 'error' ? 'text-red-300' : 'text-white/45'}`}>
          {saveMessage || '双击或双指放大 · 点击任意处关闭'}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
};
