import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const ConfirmDialog: React.FC = () => {
  const { confirmRequest, requestConfirm } = useAppStore();
  if (!confirmRequest) return null;

  const handleConfirm = async () => {
    const fn = confirmRequest.onConfirm;
    requestConfirm(null);
    await fn();
  };

  const handleSecondary = async () => {
    const fn = confirmRequest.onSecondary;
    requestConfirm(null);
    if (fn) await fn();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => requestConfirm(null)}
    >
      <div
        className="w-full max-w-md rounded-xl bg-card border border-line shadow-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {confirmRequest.danger !== false && (
              <div className="w-9 h-9 rounded-xl bg-red-500/12 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4.5 h-4.5" />
              </div>
            )}
            <h3 className="text-[17px] font-semibold text-ink">{confirmRequest.title}</h3>
          </div>
          <button
            onClick={() => requestConfirm(null)}
            className="p-1 rounded-lg text-dim hover:text-ink hover:bg-hover cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[13px] leading-relaxed text-secondary">{confirmRequest.message}</p>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            onClick={() => requestConfirm(null)}
            className="px-4 py-2 rounded-xl text-[13px] font-medium border border-line text-secondary hover:bg-hover cursor-pointer"
          >
            取消
          </button>
          {confirmRequest.secondaryLabel && confirmRequest.onSecondary && (
            <button
              onClick={handleSecondary}
              className="px-4 py-2 rounded-xl text-[13px] font-medium border border-accent/40 bg-accent-soft text-accent hover:opacity-90 cursor-pointer"
            >
              {confirmRequest.secondaryLabel}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 rounded-xl text-[13px] font-medium text-white cursor-pointer ${
              confirmRequest.danger !== false
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-accent hover:opacity-90'
            }`}
          >
            {confirmRequest.confirmLabel || '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
};
