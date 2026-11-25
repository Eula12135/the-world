import React, { useEffect, useState } from 'react';
import type { ModalKind } from '../../store/types';

const EXIT_DURATION_MS = 165;

interface AnimatedModalHostProps {
  activeModal: ModalKind;
  renderModal: (displayedModal: Exclude<ModalKind, 'none'>, closing: boolean) => React.ReactNode;
}

/**
 * 全局弹窗动画宿主：
 * - 当 `activeModal` 变为 `'none'` 时，不立即卸载 DOM，而是先播放 165ms 丝滑退出动画再卸载；
 * - 当从 `'settings'` 切进 `'providers'`（或反向退回）时，共用同一层平滑遮罩（不黑屏闪烁），仅切换内部面板并触发微转场。
 */
export const AnimatedModalHost: React.FC<AnimatedModalHostProps> = ({
  activeModal,
  renderModal,
}) => {
  const [displayed, setDisplayed] = useState<ModalKind>(activeModal);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (activeModal !== 'none') {
      setDisplayed(activeModal);
      setClosing(false);
      return;
    }
    if (displayed === 'none') return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setDisplayed('none');
      setClosing(false);
    }, EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [activeModal, displayed]);

  useEffect(() => {
    if (displayed === 'none') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 交给顶层统一按层级返回或关闭
        const ev = new CustomEvent('theworld-modal-esc');
        window.dispatchEvent(ev);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [displayed]);

  if (displayed === 'none') return null;

  return <>{renderModal(displayed, closing)}</>;
};
