import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, KeyRound, Search, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface ModelPickerProps {
  providerId: string;
  model: string;
  onSelect: (providerId: string, model: string) => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({ providerId, model, onSelect }) => {
  const { providers, setActiveModal } = useAppStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const currentProvider = providers.find((p) => p.id === providerId);
  const isReady = currentProvider
    ? !currentProvider.requiresKey || currentProvider.apiKey.trim().length > 0
    : false;

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = providers
      .filter((p) => p.enabled)
      .map((p) => {
        const ready = !p.requiresKey || p.apiKey.trim().length > 0;
        const models = p.models.filter(
          (m) => !q || m.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
        );
        return { provider: p, ready, models };
      })
      .filter((g) => g.models.length > 0);

    return list.sort((a, b) => Number(b.ready) - Number(a.ready));
  }, [providers, query]);

  return (
    <div className="relative">
      <button
        onClick={() => {
          setQuery('');
          setOpen((v) => !v);
        }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/90 hover:bg-hover border border-line text-[13px] font-medium text-ink transition cursor-pointer max-w-[200px] sm:max-w-[280px]"
        title={currentProvider ? `${currentProvider.name} · ${model}` : model}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isReady ? 'bg-emerald-500' : 'bg-amber-400'
          }`}
        />
        <span className="truncate font-mono text-[12.5px]">{model || '选择模型'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-dim shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute left-1/2 top-full z-50 mt-2 w-[min(92vw,22rem)] -translate-x-1/2 rounded-2xl bg-card border border-line shadow-2xl overflow-hidden flex flex-col max-h-[60vh]">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
              <span className="text-[13px] font-semibold text-ink">选择模型</span>
              <button onClick={() => setOpen(false)} className="p-1 text-dim hover:text-ink cursor-pointer">
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
                <div className="py-8 text-center text-[13px] text-dim">没有匹配的模型</div>
              ) : (
                grouped.map(({ provider, ready, models }) => (
                  <div key={provider.id} className="space-y-1">
                    <div className="flex items-center justify-between px-2.5 py-1 text-[12px] font-medium text-dim">
                      <span>{provider.name}</span>
                      <span
                        className={`text-[11px] px-1.5 py-0.5 rounded ${
                          ready
                            ? 'bg-emerald-500/12 text-emerald-500'
                            : 'bg-amber-500/12 text-amber-500'
                        }`}
                      >
                        {ready ? '已就绪' : '未填 Key'}
                      </span>
                    </div>
                    {models.map((m) => {
                      const active = provider.id === providerId && m === model;
                      return (
                        <button
                          key={`${provider.id}::${m}`}
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
                          <span className="truncate font-mono text-[12.5px]">{m}</span>
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
        </>
      )}
    </div>
  );
};
