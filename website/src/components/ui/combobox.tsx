'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

export type ComboboxOption = {
  value: string; // also used as label fallback when label is missing
  label?: string;
  hint?: string;
};

type Props = {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowCustom?: boolean; // accept any free-text value not in options
  customLabel?: (value: string) => string; // label shown for "Dùng giá trị nhập"
  disabled?: boolean;
  className?: string;
  triggerId?: string;
  clearable?: boolean;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

const CUSTOM_ROW = '__custom__';

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  allowCustom = false,
  customLabel,
  disabled,
  className,
  triggerId,
  clearable = true,
}: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // The three defaults are dictionary keys rather than resolved strings: a
  // default parameter is evaluated before `t` exists, so the fallback has to
  // happen at render time. A caller that passes its own placeholder (the device
  // form, the wishlist form) still wins — that prop is already translated.
  const resolvedPlaceholder = placeholder ?? t('Chọn...');
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('Tìm kiếm...');
  const resolvedEmptyText = emptyText ?? t('Không có kết quả');
  const resolvedCustomLabel = customLabel ?? ((v: string) => t('Dùng "{value}"', { value: v }));

  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const filtered = React.useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return options;
    return options.filter((o) => {
      const text = normalize(`${o.label ?? o.value} ${o.hint ?? ''}`);
      return text.includes(q);
    });
  }, [options, query]);

  const exactMatch = React.useMemo(
    () =>
      options.find(
        (o) => normalize(o.label ?? o.value) === normalize(query.trim()),
      ),
    [options, query],
  );

  const showCustomRow =
    allowCustom && query.trim().length > 0 && !exactMatch;

  // Combined navigable rows: filtered options + (optionally) the custom row.
  const rowKeys = React.useMemo(() => {
    const keys = filtered.map((o) => o.value);
    if (showCustomRow) keys.push(CUSTOM_ROW);
    return keys;
  }, [filtered, showCustomRow]);

  // Scroll the highlighted row into view when keyboard-navigating.
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-combobox-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setActiveIndex(0);
    } else {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const displayLabel = selected
    ? selected.label ?? selected.value
    : value && allowCustom
      ? value
      : '';

  const commit = (v: string) => {
    onValueChange(v);
    setOpen(false);
  };

  const commitIndex = (i: number) => {
    const key = rowKeys[i];
    if (!key) return;
    if (key === CUSTOM_ROW) commit(query.trim());
    else commit(key);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowKeys.length === 0) return;
      setActiveIndex((i) => (i + 1) % rowKeys.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rowKeys.length === 0) return;
      setActiveIndex((i) => (i - 1 + rowKeys.length) % rowKeys.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (rowKeys.length > 0) setActiveIndex(rowKeys.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rowKeys.length > 0) commitIndex(activeIndex);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        asChild
        disabled={disabled}
      >
        <button
          type="button"
          id={triggerId}
          aria-expanded={open}
          className={cn(
            'flex h-11 w-full items-center justify-between rounded-md border-[1.5px] border-border bg-card px-3.5 py-2 text-sm text-ink ring-offset-background transition-[border-color,box-shadow] focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/30 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span
            className={cn(
              'line-clamp-1 text-left',
              !displayLabel && 'text-muted-foreground',
            )}
          >
            {displayLabel || resolvedPlaceholder}
          </span>
          <div className="flex items-center gap-1">
            {clearable && value && !disabled ? (
              <span
                role="button"
                aria-label={t('Xoá')}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onValueChange('');
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={cn(
            'z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border-[1.5px] bg-card text-popover-foreground shadow-lift',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        >
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              placeholder={resolvedSearchPlaceholder}
              className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              onKeyDown={onInputKeyDown}
              role="combobox"
              aria-expanded={open}
              aria-controls="combobox-listbox"
              aria-activedescendant={
                rowKeys[activeIndex] ? `combobox-row-${activeIndex}` : undefined
              }
            />
          </div>
          <div
            ref={listRef}
            id="combobox-listbox"
            role="listbox"
            className="max-h-[260px] overflow-y-auto p-1"
          >
            {rowKeys.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {resolvedEmptyText}
              </div>
            ) : (
              <>
                {filtered.map((o, idx) => {
                  const isSelected = o.value === value;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={o.value}
                      id={`combobox-row-${idx}`}
                      data-combobox-index={idx}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => commit(o.value)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={cn(
                        'flex w-full cursor-default select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none',
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : isSelected
                            ? 'bg-accent/40'
                            : '',
                      )}
                    >
                      <span className="flex flex-col items-start">
                        <span>{o.label ?? o.value}</span>
                        {o.hint ? (
                          <span className="text-xs text-muted-foreground">
                            {o.hint}
                          </span>
                        ) : null}
                      </span>
                      {isSelected ? (
                        <Check className="ml-2 h-4 w-4 text-foreground" />
                      ) : null}
                    </button>
                  );
                })}
                {showCustomRow ? (
                  (() => {
                    const idx = filtered.length;
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        id={`combobox-row-${idx}`}
                        data-combobox-index={idx}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => commit(query.trim())}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={cn(
                          'flex w-full cursor-default select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm italic outline-none',
                          isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground',
                        )}
                      >
                        + {resolvedCustomLabel(query.trim())}
                      </button>
                    );
                  })()
                ) : null}
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
