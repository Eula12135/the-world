import { useEffect, useRef, useState } from 'react';

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return (el as HTMLElement).isContentEditable === true;
}

export function useMobileKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  const nativeAuthoritativeRef = useRef(false);
  const maxHeightRef = useRef(
    typeof window !== 'undefined' ? window.visualViewport?.height || window.innerHeight : 0
  );
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleNativeEvent = (ev: Event) => {
      const custom = ev as CustomEvent<{ visible?: boolean; height?: number }>;
      nativeAuthoritativeRef.current = true;
      setOpen(Boolean(custom.detail?.visible));
    };

    window.addEventListener('theworld-keyboard', handleNativeEvent);

    const vv = window.visualViewport;
    let focusTimer: number | undefined;

    const handleViewportResize = () => {
      if (nativeAuthoritativeRef.current) return;
      if (window.innerWidth >= 768) {
        setOpen(false);
        return;
      }
      const currentHeight = vv?.height || window.innerHeight;
      if (currentHeight > maxHeightRef.current) {
        maxHeightRef.current = currentHeight;
      }
      const baseline = Math.max(maxHeightRef.current, window.innerHeight);
      const drop = baseline - currentHeight;
      if (drop > 140 && isEditableElement(document.activeElement)) {
        setOpen(true);
      } else if (drop < 80) {
        setOpen(false);
      }
    };

    const handleFocusOut = () => {
      if (nativeAuthoritativeRef.current) return;
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        if (!isEditableElement(document.activeElement)) {
          setOpen(false);
        }
      }, 60);
    };

    vv?.addEventListener('resize', handleViewportResize);
    window.addEventListener('resize', handleViewportResize);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      window.removeEventListener('theworld-keyboard', handleNativeEvent);
      vv?.removeEventListener('resize', handleViewportResize);
      window.removeEventListener('resize', handleViewportResize);
      document.removeEventListener('focusout', handleFocusOut);
      window.clearTimeout(focusTimer);
    };
  }, []);

  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!justOpened) return;

    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (isEditableElement(active)) {
        (active as HTMLElement).scrollIntoView?.({
          block: 'nearest',
          behavior: 'smooth',
        });
      }
    }, 100);

    return () => window.clearTimeout(timer);
  }, [open]);

  return open;
}
