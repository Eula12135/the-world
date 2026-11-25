import React from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const ToastHost: React.FC = () => {
  const toasts = useAppStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-card border border-line shadow-lg text-[13px] text-ink"
        >
          {t.tone === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          ) : t.tone === 'error' ? (
            <XCircle className="w-4 h-4 text-danger shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-accent shrink-0" />
          )}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
};
