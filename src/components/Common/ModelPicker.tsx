import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, KeyRound, Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import { pushBackLayer } from '../../utils/backStack';

interface ModelPickerProps {
  providerId: string;
  model: string;
  onSelect: (providerId: string, model: string) => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({ providerId, model, onSelect }) => {
  const { providers, setActiveModal } = useAppStore(
    useShallow((s) => ({
      providers: s.providers,
      setActiveModal: s.setActiveModal,
    }))
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropdownOffset, setDropdownOffset] = useState<number>(64);
  /** 触发点在屏幕下半部时向上展开，避免下拉跑到屏幕外 */
  const [openUp, setOpenUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 返回键先关下拉，而不是关掉整个页面或退出 App
  useEffect(() => {
    if (!open) return;
    return pushBackLayer(() => setOpen(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const preferUp = rect.bottom > window.innerHeight * 0.55;
        setOpenUp(preferUp);
        if (preferUp) {
          // 以触发点顶部为基准向上展开：记录距底部的距离
          setDropdownOffset(Math.round(window.innerHeight - rect.top + 8));
        } else {
          setDropdownOffset(Math.round(rect.bottom + 8));
        }
      }
    };

    updatePosition();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const currentProvider = providers.find((p) => p.id === providerId);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers
      .filter((p) => p.enabled && (!p.requiresKey || p.apiKey.trim().length > 0))
      .map((p) => {
        const models = p.models.filter(
          (m) => !q || m.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
        );
        return { provider: p, models };
      })
      .filter((g) => g.models.length > 0);
  }, [providers, query]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setQuery('');
          if (!open && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const preferUp = rect.bottom > window.innerHeight * 0.55;
            setOpenUp(preferUp);
            setDropdownOffset(
              preferUp
                ? Math.round(window.innerHeight - rect.top + 8)
                : Math.round(rect.bottom + 8)
            );
          }
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1 px-2 py-1 rounded-control border border-line text-caption text-ink hover:bg-hover transition cursor-pointer max-w-[220px] sm:max-w-[320px]"
        title={currentProvider ? `${currentProvider.name} · ${model}` : model}
      >
        <span className="truncate font-mono text-caption">
          {(model || '选择模型').replace(/^models\//i, '')}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-dim shrink-0" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[65] bg-black/20"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              ref={dropdownRef}
              style={openUp ? { bottom: dropdownOffset } : { top: dropdownOffset }}
              className="fixed left-1/2 z-[70] w-[min(92vw,22rem)] -translate-x-1/2 rounded-card bg-card border border-line shadow-2xl overflow-hidden flex flex-col max-h-[60vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
                <span className="text-[13px] font-semibold text-ink">选择模型</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1 text-dim hover:text-ink cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-2.5 border-b border-line">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted border border-line">
                  <Search className="w-3.5 h-3.5 text-dim shrink-0" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索模型或厂商..."
                    className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-dim"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-3">
                {grouped.length === 0 ? (
                  <div className="py-8 px-4 text-center text-[13px] text-dim">
                    {query.trim()
                      ? '没有匹配的模型'
                      : '尚未配置可用模型，请先前往管理模型厂商配置 API Key'}
                  </div>
                ) : (
                  grouped.map(({ provider, models }) => (
                    <div key={provider.id} className="space-y-1">
                      <div className="flex items-center justify-between px-2.5 py-1 text-[13px] font-medium text-dim">
                        <span>{provider.name}</span>
                        <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-500">
                          已就绪
                        </span>
                      </div>
                      {models.map((m) => {
                        const active = provider.id === providerId && m === model;
                        return (
                          <button
                            key={`${provider.id}::${m}`}
                            type="button"
                            onClick={() => {
                              onSelect(provider.id, m);
                              setOpen(false);
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[13px] text-left cursor-pointer transition ${
                              active
                                ? 'bg-accent-soft text-accent font-medium'
                                : 'text-ink hover:bg-hover'
                            }`}
                          >
                            <span className="truncate font-mono text-body" title={m}>
                              {m.replace(/^models\//i, '')}
                            </span>
                            {active && <Check className="w-4 h-4 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              <div className="p-2.5 border-t border-line bg-sidebar">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setActiveModal('providers');
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[13px] font-medium text-accent hover:bg-accent-soft transition cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>管理模型厂商与 API Key</span>
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
};
