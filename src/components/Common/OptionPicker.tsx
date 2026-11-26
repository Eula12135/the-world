import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { pushBackLayer } from '../../utils/backStack';

export interface OptionPickerItem {
  value: string;
  label: string;
  hint?: string;
  /** 分组标题；空字符串表示不加分组标题 */
  group?: string;
  /** 左侧色点或头像，二选一 */
  color?: string;
  image?: string;
}

interface OptionPickerProps {
  value: string;
  items: OptionPickerItem[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** 选项多时才需要搜索，由调用方决定 */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** 紧凑高度样式（用于工具栏或内联双列行） */
  compact?: boolean;
}

/**
 * 自绘下拉选择器。
 * 原生 select 在安卓上会弹出系统单选弹窗，字号不可控、长名字折行难看，
 * 和卡片式 UI 完全不是一个种族，所以统一用这个。
 */
export const OptionPicker: React.FC<OptionPickerProps> = ({
  value,
  items,
  onChange,
  placeholder = '请选择',
  searchable = false,
  searchPlaceholder = '搜索…',
  emptyText = '没有匹配项',
  disabled = false,
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = items.find((item) => item.value === value);

  const isCoarsePointer = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  useEffect(() => {
    if (!open) return;
    return pushBackLayer(close);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 40);

    const handleOutside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', handleOutside);
    };
  }, [open, close]);

  useEffect(() => {
    if (disabled && open) {
      close();
    }
  }, [disabled, open, close]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      `${item.label} ${item.hint || ''}`.toLowerCase().includes(q)
    );
  }, [items, query]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, OptionPickerItem[]>();
    for (const item of filtered) {
      const key = item.group || '';
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(item);
    }
    return order.map((key) => ({ group: key, items: map.get(key)! }));
  }, [filtered]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (open) close();
          else setOpen(true);
        }}
        className={`w-full flex items-center justify-between gap-2 bg-canvas border border-line text-[13px] text-ink outline-none focus:border-accent transition ${
          compact ? 'px-2.5 py-1.5 rounded-lg' : 'px-3 py-2 rounded-xl'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-accent/50'}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected?.image ? (
            <img
              src={selected.image}
              alt=""
              className="w-4 h-4 rounded-full object-cover shrink-0 border border-line"
            />
          ) : selected?.color ? (
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0"
              style={{ backgroundColor: selected.color }}
            />
          ) : null}
          <span className={`truncate ${selected ? '' : 'text-dim'}`}>
            {selected?.label || placeholder}
          </span>
          {selected?.hint && (
            <span className="text-[11.5px] text-dim truncate hidden sm:inline">{selected.hint}</span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-dim transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="mt-1.5 rounded-xl border border-line bg-canvas shadow-sm overflow-hidden"
        >
          {searchable && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-line bg-sidebar">
              <Search className="w-3.5 h-3.5 text-dim shrink-0" />
              <input
                autoFocus={!isCoarsePointer}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-dim"
              />
            </div>
          )}

          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-3 text-[13px] text-dim text-center">{emptyText}</div>
            )}
            {groups.map(({ group, items: groupItems }) => (
              <div key={group || '__default'}>
                {group && (
                  <div className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-medium text-dim">{group}</div>
                )}
                {groupItems.map((item) => {
                  const active = item.value === value;
                  return (
                    <button
                      key={item.value || '__empty'}
                      type="button"
                      onClick={() => {
                        onChange(item.value);
                        close();
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer transition ${
                        active ? 'bg-accent-soft' : 'hover:bg-hover'
                      }`}
                    >
                      {item.image ? (
                        <img
                          src={item.image}
                          alt=""
                          className="w-5 h-5 rounded-full object-cover shrink-0 border border-line"
                        />
                      ) : item.color ? (
                        <span
                          className="w-4 h-4 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-[13px] truncate ${
                            active ? 'text-accent font-medium' : 'text-ink'
                          }`}
                        >
                          {item.label}
                        </span>
                        {item.hint && (
                          <span className="block text-[11.5px] text-dim truncate">{item.hint}</span>
                        )}
                      </span>
                      {active && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
