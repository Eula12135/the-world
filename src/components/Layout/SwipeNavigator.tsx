import React, { useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

/** 触发切换的最小位移（跟手位移，不是手指位移） */
const TRIGGER = 70;
/** 最大跟手位移，超出后不再跟随 */
const MAX_DRAG = 240;
/** 阻尼：手指移动 1px，内容移动 0.6px，手感更轻 */
const RESIST = 0.6;

/** 方向映射：改这两个布尔值即可反转手势方向 */
const SWIPE_RIGHT_OPENS_HISTORY = true;
const SWIPE_LEFT_GOES_TO_WORLDS = true;

/**
 * 主内容区的横向滑动导航：
 * - 右滑：打开左侧历史对话抽屉（内容跟手右移）
 * - 左滑：切到「作品」视图（内容跟手左移）
 * - 在作品页右滑：退回「对话」
 * 松手未达阈值会弹性回弹，所以滑错了不用慌，滑回来就行。
 */
export const SwipeNavigator: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen, activeModal } = useAppStore();
  const [dragX, setDragX] = useState(0);
  const [animating, setAnimating] = useState(true);
  const start = useRef<{ x: number; y: number; active: boolean; horizontal: boolean } | null>(null);

  // 抽屉打开、或有弹窗时不做手势，避免和滚动/选择冲突
  const gesturesEnabled = activeModal === 'none' && !sidebarOpen;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!gesturesEnabled) return;
    const target = e.target as HTMLElement | null;
    // 表单控件上不拦截横向滑动（否则滑块、输入框选字会失效）
    if (target?.closest('input, textarea, select, audio, video, [contenteditable="true"]')) return;
    start.current = { x: e.clientX, y: e.clientY, active: true, horizontal: false };
    setAnimating(false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s?.active) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;

    if (!s.horizontal) {
      if (Math.abs(dx) < 12) return;
      // 竖向意图优先，交给列表滚动
      if (Math.abs(dx) < Math.abs(dy) * 1.3) {
        s.active = false;
        return;
      }
      s.horizontal = true;
    }

    // 对话页：左滑去作品、右滑开抽屉；作品页：只允许右滑退回
    const allow = activeView === 'chat' ? dx : dx > 0 ? dx : 0;
    const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, allow));
    setDragX(clamped * RESIST);
  };

  const finish = () => {
    const s = start.current;
    start.current = null;
    if (!s?.horizontal) {
      setDragX(0);
      setAnimating(true);
      return;
    }

    const dx = dragX;
    setAnimating(true);
    setDragX(0);

    if (activeView === 'worlds') {
      if (dx > TRIGGER) setActiveView('chat');
      return;
    }

    if (dx > TRIGGER) {
      if (SWIPE_RIGHT_OPENS_HISTORY) setSidebarOpen(true);
    } else if (dx < -TRIGGER) {
      if (SWIPE_LEFT_GOES_TO_WORLDS) setActiveView('worlds');
    }
  };

  // 拖动时内容轻微缩放 + 阴影，增强"抽屉在下面"的空间感
  const progress = Math.min(1, Math.abs(dragX) / (MAX_DRAG * RESIST));

  return (
    <div
      className="flex-1 flex flex-col min-h-0 w-full relative"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={finish}
      style={{ touchAction: 'pan-y' }}
    >
      <div
        className="flex-1 flex flex-col min-h-0 w-full"
        style={{
          transform: `translateX(${dragX}px) scale(${1 - progress * 0.02})`,
          transition: animating ? 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none',
          boxShadow: progress > 0.02 ? `0 0 24px rgba(0,0,0,${0.12 * progress})` : 'none',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
};
