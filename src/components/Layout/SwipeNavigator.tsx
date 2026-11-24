import React, { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';

/** 触发切换的最小位移（跟手位移，不是手指位移） */
const TRIGGER = 60;
/** 最大跟手位移，超出后不再跟随 */
const MAX_DRAG = 240;
/** 阻尼：手指移动 1px，内容移动 0.6px，手感更轻 */
const RESIST = 0.6;
/** 左边缘这么多像素内不接管，避免和安卓系统返回手势打架 */
const EDGE_GUARD = 24;

/** 方向映射：改这两个布尔值即可反转手势方向 */
const SWIPE_RIGHT_OPENS_HISTORY = true;
const SWIPE_LEFT_GOES_TO_WORLDS = true;

/**
 * 主内容区的横向滑动导航：
 * - 右滑：打开左侧历史对话抽屉（抽屉与内容一起跟手推开）
 * - 左滑：切到「作品」视图（内容跟手左移）
 * - 在作品页右滑：退回「对话」
 * 松手未达阈值会弹性回弹，所以滑错了不用慌，滑回来就行。
 *
 * 用原生 touch 事件而不是 pointer：WebView 里 pointermove 经常被滚动容器
 * 判成滚动意图后取消，手指滑动收不到。
 */
export const SwipeNavigator: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen, setSwipeOffset, activeModal } =
    useAppStore(
      useShallow((s) => ({
        activeView: s.activeView,
        setActiveView: s.setActiveView,
        sidebarOpen: s.sidebarOpen,
        setSidebarOpen: s.setSidebarOpen,
        setSwipeOffset: s.setSwipeOffset,
        activeModal: s.activeModal,
      }))
    );
  const [dragX, setDragX] = useState(0);
  const [animating, setAnimating] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; active: boolean; horizontal: boolean } | null>(null);
  const dragRef = useRef(0);

  // 抽屉打开、或有弹窗时不做手势，避免和滚动/选择冲突
  const gesturesEnabled = activeModal === 'none' && !sidebarOpen;

  const hasHorizontallyScrollableAncestor = (el: HTMLElement | null, boundary: HTMLElement) => {
    let cur = el;
    while (cur && cur !== boundary) {
      if (cur.scrollWidth > cur.clientWidth + 2) {
        const overflowX = window.getComputedStyle(cur).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (!gesturesEnabled || e.touches.length !== 1) return;
      const touch = e.touches[0];
      // 左边缘交给系统返回手势
      if (touch.clientX <= EDGE_GUARD) return;

      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, audio, video, pre, code, table, [contenteditable="true"], [data-no-swipe="true"]'
        ) ||
        hasHorizontallyScrollableAncestor(target, el)
      ) {
        return;
      }
      start.current = { x: touch.clientX, y: touch.clientY, active: true, horizontal: false };
      setAnimating(false);
    };

    const onMove = (e: TouchEvent) => {
      const s = start.current;
      if (!s?.active) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - s.x;
      const dy = touch.clientY - s.y;

      if (!s.horizontal) {
        if (Math.abs(dx) < 10) return;
        // 竖向意图优先，交给列表滚动
        if (Math.abs(dx) < Math.abs(dy) * 1.2) {
          s.active = false;
          return;
        }
        s.horizontal = true;
      }

      if (e.cancelable) e.preventDefault();

      // 对话页：左滑去作品、右滑开抽屉；作品页：只允许右滑退回
      const allow = activeView === 'chat' ? dx : dx > 0 ? dx : 0;
      const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, allow));
      const offset = clamped * RESIST;
      dragRef.current = offset;
      setDragX(offset);
      // 右滑时把位移同步给抽屉，让它跟着手指一起推开
      setSwipeOffset(Math.max(0, offset));
    };

    const finish = () => {
      const s = start.current;
      start.current = null;
      const dx = dragRef.current;
      dragRef.current = 0;
      setSwipeOffset(0);
      setAnimating(true);
      setDragX(0);

      if (!s?.horizontal) return;

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

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', finish);
    el.addEventListener('touchcancel', finish);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', finish);
      el.removeEventListener('touchcancel', finish);
    };
  }, [activeView, gesturesEnabled, setActiveView, setSidebarOpen, setSwipeOffset]);

  // 抽屉一开就把位移归零，否则内容会停在右移位置露出底色
  useEffect(() => {
    if (sidebarOpen) {
      dragRef.current = 0;
      setDragX(0);
      setSwipeOffset(0);
      setAnimating(true);
    }
  }, [sidebarOpen, setSwipeOffset]);

  // 拖动时内容轻微缩放 + 阴影，增强"抽屉在下面"的空间感
  const progress = Math.min(1, Math.abs(dragX) / (MAX_DRAG * RESIST));

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0 w-full relative" style={{ touchAction: 'pan-y', background: 'var(--bg-canvas)' }}>
      <div
        className="flex-1 flex flex-col min-h-0 w-full"
        style={{
          transform: dragX !== 0 ? `translateX(${dragX}px) scale(${1 - progress * 0.02})` : undefined,
          transition: animating ? 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1)' : undefined,
          boxShadow: progress > 0.02 ? `0 0 24px rgba(0,0,0,${0.12 * progress})` : undefined,
          willChange: dragX !== 0 ? 'transform' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
};
