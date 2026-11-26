import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

export interface SortableCardMeta {
  id: string;
  pinned?: boolean;
}

interface UseSmoothGridSortOptions<T extends SortableCardMeta> {
  items: readonly T[];
  enabled: boolean;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  onReorder: (orderedIds: string[]) => void;
}

interface ActiveDragSession {
  pointerId: number;
  draggedOrigIdx: number;
  currentSlot: number;
  draggedPinned: boolean;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  originRect: DOMRect;
  slotRects: DOMRect[];
  itemEls: HTMLElement[];
  itemIds: string[];
  pinnedFlags: boolean[];
  order: number[];
  ghost: HTMLElement;
  initialScrollTop: number;
  rafId: number | null;
}

/**
 * 60/120fps 网格卡片拖拽与置顶 FLIP 动画引擎：
 * - 拖拽全程零 React 重渲染、零 `elementFromPoint` 强制重排：
 *   浮起克隆卡片走 GPU 合成层 `translate3d`，其余卡片按缓存槽位坐标用 `translate3d` 平滑让位；
 * - 松手时浮起卡片平滑落入目标槽位，随后通过 `flushSync` 在同一帧内完成真实 DOM 换位并清除内联矩阵，零闪烁；
 * - 置顶 / 取消置顶时通过 `captureFlipSnapshot` 记录旧坐标，在 `useLayoutEffect` 中执行 FLIP 平滑飞入动画。
 */
export function useSmoothGridSort<T extends SortableCardMeta>({
  items,
  enabled,
  scrollContainerRef,
  onReorder,
}: UseSmoothGridSortOptions<T>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const activeDragRef = useRef<ActiveDragSession | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const settleCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickUntilRef = useRef<number>(0);

  // FLIP 快照（用于置顶 / 取消置顶时的平滑位移过渡）
  const flipSnapshotRef = useRef<{
    rects: Map<string, DOMRect>;
    elevatedId?: string;
  } | null>(null);
  const skipNextFlipRef = useRef(false);

  const captureFlipSnapshot = useCallback((elevatedId?: string) => {
    const grid = gridRef.current;
    if (!grid) return;
    // 若上一次落位过渡尚未收尾，立即同步归位
    if (settleCleanupRef.current) {
      settleCleanupRef.current();
    }
    const rects = new Map<string, DOMRect>();
    const cards = grid.querySelectorAll<HTMLElement>('[data-char-card-id]');
    cards.forEach((el) => {
      const id = el.dataset.charCardId;
      if (id) rects.set(id, el.getBoundingClientRect());
    });
    flipSnapshotRef.current = { rects, elevatedId };
  }, []);

  const orderSignature = items.map((c) => `${c.id}:${c.pinned ? 1 : 0}`).join('|');

  useLayoutEffect(() => {
    if (skipNextFlipRef.current) {
      skipNextFlipRef.current = false;
      flipSnapshotRef.current = null;
      return;
    }
    const snap = flipSnapshotRef.current;
    flipSnapshotRef.current = null;
    const grid = gridRef.current;
    if (!snap || !grid) return;

    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-char-card-id]'));
    const movedEls: HTMLElement[] = [];

    for (const el of cards) {
      const id = el.dataset.charCardId;
      if (!id) continue;
      const prev = snap.rects.get(id);
      if (!prev) continue;
      const next = el.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      el.style.transition = 'none';
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      if (snap.elevatedId === id) {
        el.style.zIndex = '25';
      }
      movedEls.push(el);
    }

    if (movedEls.length === 0) return;

    // 触发一次读取以提交初始反向位移，再切入 GPU 缓动归位
    void grid.offsetHeight;

    for (const el of movedEls) {
      el.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translate3d(0, 0, 0)';
      const clear = (ev?: TransitionEvent) => {
        if (ev && (ev.target !== el || ev.propertyName !== 'transform')) return;
        el.style.transition = '';
        el.style.transform = '';
        el.style.zIndex = '';
        el.removeEventListener('transitionend', clear);
      };
      el.addEventListener('transitionend', clear);
      window.setTimeout(() => clear(), 300);
    }
  }, [orderSignature]);

  const abortOrCleanupAll = useCallback(() => {
    if (settleCleanupRef.current) {
      settleCleanupRef.current();
    }
    const sess = activeDragRef.current;
    if (!sess) return;
    if (sess.rafId !== null) cancelAnimationFrame(sess.rafId);
    sess.ghost.remove();
    for (const el of sess.itemEls) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      el.style.borderStyle = '';
      el.style.borderColor = '';
    }
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    delete document.body.dataset.cardDragging;
    activeDragRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      abortOrCleanupAll();
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
    };
  }, [abortOrCleanupAll]);

  const startActiveDrag = useCallback(
    (charId: string, pointerId: number, startX: number, startY: number, curX: number, curY: number) => {
      if (!enabledRef.current) return false;
      if (settleCleanupRef.current) {
        settleCleanupRef.current();
      }
      const grid = gridRef.current;
      if (!grid) return false;

      const curItems = itemsRef.current;
      if (curItems.length < 2) return false;

      const cardMap = new Map<string, HTMLElement>();
      grid.querySelectorAll<HTMLElement>('[data-char-card-id]').forEach((el) => {
        const cid = el.dataset.charCardId;
        if (cid) cardMap.set(cid, el);
      });

      const itemEls: HTMLElement[] = [];
      const itemIds: string[] = [];
      const pinnedFlags: boolean[] = [];

      for (const item of curItems) {
        const el = cardMap.get(item.id);
        if (!el) return false;
        itemEls.push(el);
        itemIds.push(item.id);
        pinnedFlags.push(Boolean(item.pinned));
      }

      const draggedOrigIdx = itemIds.indexOf(charId);
      if (draggedOrigIdx === -1) return false;

      const slotRects = itemEls.map((el) => el.getBoundingClientRect());
      const originRect = slotRects[draggedOrigIdx];
      const draggedEl = itemEls[draggedOrigIdx];

      // 构建 1:1 浮起卡片克隆层，完全脱离文档流走 GPU 合成
      const ghost = draggedEl.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-char-card-id');
      Object.assign(ghost.style, {
        position: 'fixed',
        left: `${originRect.left}px`,
        top: `${originRect.top}px`,
        width: `${originRect.width}px`,
        height: `${originRect.height}px`,
        margin: '0',
        zIndex: '9999',
        pointerEvents: 'none',
        willChange: 'transform',
        boxSizing: 'border-box',
        borderColor: 'var(--accent)',
        boxShadow:
          '0 20px 40px -12px rgba(17, 24, 39, 0.28), 0 6px 16px -4px rgba(59, 87, 232, 0.18)',
        transform: `translate3d(${curX - startX}px, ${curY - startY}px, 0) scale(1.025)`,
        transition: 'box-shadow 150ms ease',
      });
      document.body.appendChild(ghost);

      // 原位卡片变为柔和的虚线落点占位槽
      draggedEl.style.opacity = '0.24';
      draggedEl.style.borderStyle = 'dashed';
      draggedEl.style.borderColor = 'var(--accent)';

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      document.body.dataset.cardDragging = 'true';

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(10);
        } catch {
          // ignore
        }
      }

      activeDragRef.current = {
        pointerId,
        draggedOrigIdx,
        currentSlot: draggedOrigIdx,
        draggedPinned: pinnedFlags[draggedOrigIdx],
        startX,
        startY,
        pointerX: curX,
        pointerY: curY,
        originRect,
        slotRects,
        itemEls,
        itemIds,
        pinnedFlags,
        order: curItems.map((_, i) => i),
        ghost,
        initialScrollTop: scrollContainerRef.current?.scrollTop ?? 0,
        rafId: null,
      };
      suppressClickUntilRef.current = performance.now() + 400;
      return true;
    },
    [scrollContainerRef]
  );

  const runDragFrame = useCallback(() => {
    const sess = activeDragRef.current;
    if (!sess) return;
    sess.rafId = null;

    const dx = sess.pointerX - sess.startX;
    const dy = sess.pointerY - sess.startY;
    sess.ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.025)`;

    // 边缘自动滚动支持
    const scroller = scrollContainerRef.current;
    let scrolled = false;
    if (scroller) {
      const sRect = scroller.getBoundingClientRect();
      const edgeZone = 56;
      if (sess.pointerY < sRect.top + edgeZone && scroller.scrollTop > 0) {
        const speed = Math.ceil(((sRect.top + edgeZone - sess.pointerY) / edgeZone) * 10);
        scroller.scrollTop = Math.max(0, scroller.scrollTop - speed);
        scrolled = true;
      } else if (
        sess.pointerY > sRect.bottom - edgeZone &&
        scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight
      ) {
        const speed = Math.ceil(((sess.pointerY - (sRect.bottom - edgeZone)) / edgeZone) * 10);
        scroller.scrollTop = Math.min(
          scroller.scrollHeight - scroller.clientHeight,
          scroller.scrollTop + speed
        );
        scrolled = true;
      }
    }

    const scrollDelta = (scroller?.scrollTop ?? 0) - sess.initialScrollTop;
    const centerX = sess.originRect.left + dx + sess.originRect.width / 2;
    const centerY = sess.originRect.top + dy + sess.originRect.height / 2;

    let hitSlot = -1;
    for (let s = 0; s < sess.slotRects.length; s++) {
      // 置顶组与普通组严格隔离，跨组不触发挤压换位
      if (sess.pinnedFlags[s] !== sess.draggedPinned) continue;
      const r = sess.slotRects[s];
      const top = r.top - scrollDelta;
      const bottom = r.bottom - scrollDelta;
      const padX = r.width * 0.12;
      const padY = r.height * 0.12;
      if (
        centerX >= r.left + padX &&
        centerX <= r.right - padX &&
        centerY >= top + padY &&
        centerY <= bottom - padY
      ) {
        hitSlot = s;
        break;
      }
    }

    if (hitSlot !== -1 && hitSlot !== sess.currentSlot) {
      const moved = sess.order.splice(sess.currentSlot, 1)[0];
      sess.order.splice(hitSlot, 0, moved);
      sess.currentSlot = hitSlot;

      for (let slot = 0; slot < sess.order.length; slot++) {
        const origIdx = sess.order[slot];
        const el = sess.itemEls[origIdx];
        const sx = sess.slotRects[slot].left - sess.slotRects[origIdx].left;
        const sy = sess.slotRects[slot].top - sess.slotRects[origIdx].top;
        el.style.transition = 'transform 220ms cubic-bezier(0.2, 0, 0, 1)';
        el.style.transform = sx === 0 && sy === 0 ? '' : `translate3d(${sx}px, ${sy}px, 0)`;
      }
    }

    if (scrolled && activeDragRef.current === sess) {
      sess.rafId = requestAnimationFrame(runDragFrame);
    }
  }, [scrollContainerRef]);

  const finishActiveDrag = useCallback(() => {
    const sess = activeDragRef.current;
    if (!sess) return;
    activeDragRef.current = null;
    if (sess.rafId !== null) {
      cancelAnimationFrame(sess.rafId);
      sess.rafId = null;
    }

    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    delete document.body.dataset.cardDragging;
    suppressClickUntilRef.current = performance.now() + 260;

    const scrollDelta = (scrollContainerRef.current?.scrollTop ?? 0) - sess.initialScrollTop;
    const targetRect = sess.slotRects[sess.currentSlot];
    const settleDx = targetRect.left - sess.originRect.left;
    const settleDy = targetRect.top - scrollDelta - sess.originRect.top;

    // 浮起卡片平滑吸附回目标槽位
    sess.ghost.style.transition =
      'transform 175ms cubic-bezier(0.2, 0, 0, 1), box-shadow 175ms ease';
    sess.ghost.style.transform = `translate3d(${settleDx}px, ${settleDy}px, 0) scale(1)`;
    sess.ghost.style.boxShadow = '0 2px 6px rgba(17, 24, 39, 0.06)';

    const finalOrderedIds = sess.order.map((origIdx) => sess.itemIds[origIdx]);
    const didChange = finalOrderedIds.some((id, idx) => id !== sess.itemIds[idx]);

    const commitDrop = () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      settleCleanupRef.current = null;

      if (didChange) {
        skipNextFlipRef.current = true;
        flushSync(() => {
          onReorderRef.current(finalOrderedIds);
        });
      }

      for (const el of sess.itemEls) {
        el.style.transition = 'none';
        el.style.transform = '';
        el.style.opacity = '';
        el.style.borderStyle = '';
        el.style.borderColor = '';
      }
      sess.ghost.remove();
      // 下一帧恢复默认内联样式干净状态
      requestAnimationFrame(() => {
        for (const el of sess.itemEls) {
          el.style.transition = '';
        }
      });
    };

    settleCleanupRef.current = commitDrop;
    settleTimerRef.current = window.setTimeout(commitDrop, 180);
  }, [scrollContainerRef]);

  const bindCardDragProps = useCallback(
    (charId: string) => {
      const handleCardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!enabledRef.current) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const targetEl = e.target as HTMLElement;
        const fromHandle = Boolean(targetEl.closest('[data-drag-handle="true"]'));
        // 点击置顶、分享、删除、对话按钮时绝不拦截
        if (!fromHandle && targetEl.closest('button, a, input, textarea')) {
          return;
        }

        const isTouch = e.pointerType !== 'mouse';
        const pointerId = e.pointerId;
        const startX = e.clientX;
        const startY = e.clientY;
        let lastX = startX;
        let lastY = startY;
        let longPressTimer: number | null = null;

        const blockContextMenu = (ce: Event) => {
          if (activeDragRef.current) {
            ce.preventDefault();
          }
        };

        const cleanupWindowListeners = () => {
          if (longPressTimer !== null) {
            window.clearTimeout(longPressTimer);
            longPressTimer = null;
          }
          window.removeEventListener('pointermove', onWindowPointerMove);
          window.removeEventListener('pointerup', onWindowPointerUp);
          window.removeEventListener('pointercancel', onWindowPointerCancel);
          window.removeEventListener('touchmove', onWindowTouchMove);
          window.removeEventListener('touchend', onWindowTouchEnd);
          window.removeEventListener('touchcancel', onWindowTouchEnd);
          window.removeEventListener('contextmenu', blockContextMenu, true);
        };

        const handleCoordsMove = (nx: number, ny: number, rawEv: Event) => {
          lastX = nx;
          lastY = ny;
          const dist = Math.hypot(lastX - startX, lastY - startY);

          if (activeDragRef.current) {
            if (rawEv.cancelable) rawEv.preventDefault();
            activeDragRef.current.pointerX = lastX;
            activeDragRef.current.pointerY = lastY;
            if (activeDragRef.current.rafId === null) {
              activeDragRef.current.rafId = requestAnimationFrame(runDragFrame);
            }
            return;
          }

          if (fromHandle) {
            if (rawEv.cancelable) rawEv.preventDefault();
            if (dist >= 3) {
              startActiveDrag(charId, pointerId, startX, startY, lastX, lastY);
            }
          } else if (!isTouch) {
            if (dist >= 6) {
              startActiveDrag(charId, pointerId, startX, startY, lastX, lastY);
            }
          } else if (dist > 8 && longPressTimer !== null) {
            // 手指在长按生效前已明显滑动：放行给原生列表滚动或页面左右滑
            cleanupWindowListeners();
          }
        };

        const onWindowPointerMove = (ev: PointerEvent) => {
          if (isTouch) return; // 触屏交由原生 touchmove 处理，避免 WebView pointercancel 断触
          if (ev.pointerId !== pointerId) return;
          handleCoordsMove(ev.clientX, ev.clientY, ev);
        };

        const onWindowPointerUp = (ev: PointerEvent) => {
          if (isTouch) return;
          if (ev.pointerId !== pointerId) return;
          cleanupWindowListeners();
          if (activeDragRef.current) {
            finishActiveDrag();
          }
        };

        const onWindowPointerCancel = (ev: PointerEvent) => {
          if (isTouch) return; // 安卓 WebView 常误发 pointercancel，由 touchend/touchcancel 兜底
          if (ev.pointerId !== pointerId) return;
          cleanupWindowListeners();
          if (activeDragRef.current) {
            finishActiveDrag();
          }
        };

        const onWindowTouchMove = (te: TouchEvent) => {
          const t = te.touches[0];
          if (!t) return;
          handleCoordsMove(t.clientX, t.clientY, te);
        };

        const onWindowTouchEnd = () => {
          cleanupWindowListeners();
          if (activeDragRef.current) {
            finishActiveDrag();
          }
        };

        if (isTouch) {
          window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
          window.addEventListener('touchend', onWindowTouchEnd);
          window.addEventListener('touchcancel', onWindowTouchEnd);
          window.addEventListener('contextmenu', blockContextMenu, true);
          if (!fromHandle) {
            longPressTimer = window.setTimeout(() => {
              longPressTimer = null;
              startActiveDrag(charId, pointerId, startX, startY, lastX, lastY);
            }, 220);
          }
        } else {
          window.addEventListener('pointermove', onWindowPointerMove, { passive: false });
          window.addEventListener('pointerup', onWindowPointerUp);
          window.addEventListener('pointercancel', onWindowPointerCancel);
        }
      };

      return {
        onPointerDown: handleCardPointerDown,
      };
    },
    [finishActiveDrag, runDragFrame, startActiveDrag]
  );

  const shouldSuppressCardClick = useCallback(() => {
    return Boolean(activeDragRef.current) || performance.now() < suppressClickUntilRef.current;
  }, []);

  return {
    gridRef,
    captureFlipSnapshot,
    bindCardDragProps,
    shouldSuppressCardClick,
  };
}
