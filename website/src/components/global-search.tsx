'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Heart, Loader2, Package, Repeat, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { searchAll } from '@/app/actions/search';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_GROUP_LABELS,
  SEARCH_GROUP_ORDER,
  SEARCH_IDLE_HINT,
  SEARCH_LOADING_HINT,
  SEARCH_PLACEHOLDER,
  isBlankQuery,
  noResultsMessage,
  searchResultCount,
  searchResultHref,
  searchRowSubtitle,
  type SearchGroupKey,
  type SearchResultRow,
  type SearchState,
} from '@/lib/search';

const GROUP_ICONS: Record<SearchGroupKey, React.ComponentType<{ className?: string }>> = {
  devices: Package,
  subscriptions: Repeat,
  wishlist: Heart,
};

function GroupSection({
  groupKey,
  rows,
  onNavigate,
}: {
  groupKey: SearchGroupKey;
  rows: SearchResultRow[];
  onNavigate: () => void;
}) {
  const t = useT();
  if (rows.length === 0) return null;
  const Icon = GROUP_ICONS[groupKey];
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {t(SEARCH_GROUP_LABELS[groupKey])}
        <span className="ml-auto font-mono text-[11px] font-normal">{rows.length}</span>
      </div>
      <ul>
        {rows.map((row) => {
          const subtitle = searchRowSubtitle(row);
          return (
            <li key={row.id}>
              <Link
                href={searchResultHref(groupKey, row.id)}
                onClick={onNavigate}
                className="block px-3 py-2 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
              >
                <span className="block truncate text-sm font-semibold text-ink">{row.name}</span>
                {subtitle && (
                  <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SearchResults({
  state,
  onNavigate,
  className,
}: {
  state: SearchState;
  onNavigate: () => void;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const shell = cn(
    'overflow-hidden rounded-lg border-[1.5px] border-border bg-card shadow-lift',
    className,
  );

  if (state.kind === 'idle') {
    return (
      <div className={cn(shell, 'p-4 text-sm text-muted-foreground')}>
        {t(SEARCH_IDLE_HINT)}
      </div>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div
        className={cn(shell, 'flex items-center gap-2 p-4 text-sm text-muted-foreground')}
        aria-live="polite"
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        {t(SEARCH_LOADING_HINT)}
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        className={cn(
          shell,
          'flex items-start gap-2 p-4 text-sm font-medium text-destructive',
        )}
        role="status"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{state.message}</p>
      </div>
    );
  }

  if (searchResultCount(state.groups) === 0) {
    return (
      <div className={cn(shell, 'p-4 text-sm text-muted-foreground')} role="status">
        {noResultsMessage(state.query, locale)}
      </div>
    );
  }

  return (
    <div className={cn(shell, 'overflow-y-auto')} role="status">
      {SEARCH_GROUP_ORDER.map((groupKey) => (
        <GroupSection
          key={groupKey}
          groupKey={groupKey}
          rows={state.groups[groupKey]}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

// Global cross-entity search box for the app shell topbar (`GET /v1/search`,
// roadmap #7). Before this, `q` only existed inside each list page, so typing
// "samsung" could not find a "Samsung Cloud" subscription or the Galaxy Buds on
// the wishlist. The per-page filters are untouched and keep working.
//
// Behaviour:
//   - Debounced by SEARCH_DEBOUNCE_MS; only the last keystroke's response is
//     applied (earlier in-flight calls are ignored).
//   - A blank query never reaches the server and never renders an error —
//     deleting the last character shows the idle prompt (the endpoint answers
//     200 + empty groups for a blank `q` anyway).
//   - Every string the server sends (including the 400 for a query over 200
//     runes) is surfaced verbatim.
export function GlobalSearch() {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const [state, setState] = React.useState<SearchState>({ kind: 'idle' });
  const [open, setOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mobileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const q = query.trim();
    // Blank: `onQueryChange` already put the panel back into the idle state.
    if (q === '') return;

    let cancelled = false;
    const timer = setTimeout(() => {
      setState({ kind: 'loading', query: q });
      void searchAll(q).then((res) => {
        if (cancelled) return;
        setState(
          res.ok
            ? { kind: 'ready', query: res.query, groups: res.groups }
            : { kind: 'error', query: q, message: res.message },
        );
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const closeAll = React.useCallback(() => {
    setOpen(false);
    setMobileOpen(false);
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (isBlankQuery(value)) setState({ kind: 'idle' });
  };

  // Dismiss on outside click / Escape. The mobile panel is a DOM child of this
  // container even though it is positioned `fixed`, so `contains` covers it.
  React.useEffect(() => {
    if (!open && !mobileOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeAll();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAll();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, mobileOpen, closeAll]);

  // Focus the field when the mobile overlay opens (no state update).
  React.useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus();
  }, [mobileOpen]);

  return (
    <div ref={rootRef} role="search" className="min-w-0 md:max-w-[420px] md:flex-1">
      {/* md+ : inline field in the topbar */}
      <div className="relative hidden md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={t(SEARCH_PLACEHOLDER)}
          aria-label={t('Tìm kiếm thiết bị, đăng ký, wishlist')}
          aria-expanded={open}
          className="rounded-pill pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {query !== '' && (
          <button
            type="button"
            onClick={() => {
              onQueryChange('');
              setOpen(true);
            }}
            aria-label={t('Xoá từ khoá')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {open && (
          <SearchResults
            state={state}
            onNavigate={closeAll}
            className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh]"
          />
        )}
      </div>

      {/* < md : icon trigger + overlay under the header. `fixed top-16` lands on
          the header's 4rem bottom edge; the topbar's backdrop-blur makes the
          header the containing block, which is why no `bottom-*` is used. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label={t('Tìm kiếm')}
        className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-ink md:hidden"
      >
        <Search className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <>
          <button
            type="button"
            aria-label={t('Đóng tìm kiếm')}
            onClick={closeAll}
            className="fixed inset-x-0 top-16 z-40 h-screen cursor-default bg-ink/25 md:hidden"
          />
          <div className="fixed inset-x-0 top-16 z-50 border-b border-border bg-card p-3 shadow-lift md:hidden">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={mobileInputRef}
                type="search"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder={t(SEARCH_PLACEHOLDER)}
                aria-label={t('Tìm kiếm thiết bị, đăng ký, wishlist')}
                className="rounded-pill pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
              />
              <button
                type="button"
                onClick={closeAll}
                aria-label={t('Đóng tìm kiếm')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SearchResults
              state={state}
              onNavigate={closeAll}
              className="mt-3 max-h-[60vh]"
            />
          </div>
        </>
      )}
    </div>
  );
}
