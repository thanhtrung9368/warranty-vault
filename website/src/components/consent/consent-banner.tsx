'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/client';
import {
  CONSENT_OPEN_EVENT,
  acceptAllConsent,
  openConsentSettings,
  readConsent,
  rejectNonEssentialConsent,
  saveConsent,
} from '@/lib/consent';

type View = 'hidden' | 'ask' | 'manage';

/**
 * The consent banner.
 *
 * Three equal actions on first visit — accept, reject, manage — and no
 * pre-ticked advertising box. It is a fixed, non-modal panel: it never covers
 * the page with an overlay, never traps focus, and chooses safe defaults when
 * the visitor ignores it (advertising stays off).
 *
 * No entrance animation: nothing here moves the document, so it cannot shift
 * layout, and there is no motion to reduce. The only motion is the button's
 * own hover transition, which the design system owns.
 *
 * The footer link reopens this same panel through `CONSENT_OPEN_EVENT`, so
 * withdrawing consent takes the same one click as giving it.
 */
export function ConsentBanner() {
  const t = useT();
  const [view, setView] = React.useState<View>('hidden');
  const [advertising, setAdvertising] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // localStorage is a browser store, so the first client render is deliberately
  // empty and the banner appears after hydration. The server render and the
  // first client render agree (both null), which is what keeps hydration clean.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only store, read after hydration
    setView(readConsent().decided ? 'hidden' : 'ask');
  }, []);

  React.useEffect(() => {
    const open = () => {
      setAdvertising(readConsent().categories.advertising);
      setView('ask');
    };
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, []);

  // Move focus into the panel when it opens (including the footer re-open),
  // without scrolling the page to the fixed bottom bar.
  React.useEffect(() => {
    if (view !== 'hidden') panelRef.current?.focus({ preventScroll: true });
  }, [view]);

  if (view === 'hidden') return null;

  const decide = (value: boolean) => {
    const next = value ? acceptAllConsent() : rejectNonEssentialConsent();
    setAdvertising(next.categories.advertising);
    setView('hidden');
  };

  const saveManagedChoice = () => {
    const next = saveConsent(advertising);
    setAdvertising(next.categories.advertising);
    setView('hidden');
  };

  const openManage = () => {
    setAdvertising(readConsent().categories.advertising);
    setView('manage');
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (view === 'manage') {
      setView('ask');
    } else {
      // Escape is a dismissal, and dismissal must never mean consent.
      decide(false);
    }
  };

  return (
    <div
      ref={panelRef}
      role="region"
      aria-labelledby="wv-consent-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-x-0 bottom-0 z-[60] max-h-[82vh] overflow-y-auto border-t-[1.5px] border-ink bg-card px-4 py-4 shadow-[0_-10px_30px_-18px_rgba(0,0,0,0.35)] focus-visible:outline-none md:px-8 md:py-5"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="max-w-2xl">
          <h2 id="wv-consent-title" className="font-display text-lg font-bold tracking-tight text-ink">
            {view === 'manage' ? t('Quản lý cookie') : t('Cookie trên Warrly')}
          </h2>

          {view === 'manage' ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-lg border-[1.5px] border-border bg-surface-2/50 p-3">
                <div className="flex items-start gap-2.5">
                  <input
                    id="wv-consent-necessary"
                    type="checkbox"
                    checked
                    disabled
                    readOnly
                    aria-describedby="wv-consent-necessary-desc"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                  />
                  <div>
                    <label
                      htmlFor="wv-consent-necessary"
                      className="text-sm font-semibold text-ink"
                    >
                      {t('Cookie thiết yếu')}
                    </label>
                    <span className="ml-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      {t('Luôn bật')}
                    </span>
                    <p id="wv-consent-necessary-desc" className="mt-1 text-sm leading-relaxed text-muted">
                      {t(
                        'Phiên đăng nhập, ngôn ngữ và giao diện. Luôn bật vì trang không chạy đúng nếu thiếu.',
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border-[1.5px] border-border bg-surface-2/50 p-3">
                <div className="flex items-start gap-2.5">
                  <input
                    id="wv-consent-advertising"
                    type="checkbox"
                    checked={advertising}
                    onChange={(event) => setAdvertising(event.target.checked)}
                    aria-describedby="wv-consent-advertising-desc"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                  />
                  <div>
                    <label
                      htmlFor="wv-consent-advertising"
                      className="text-sm font-semibold text-ink"
                    >
                      {t('Quảng cáo')}
                    </label>
                    <p id="wv-consent-advertising-desc" className="mt-1 text-sm leading-relaxed text-muted">
                      {t(
                        'Cookie và định danh thiết bị dùng cho quảng cáo bên thứ ba, chỉ khi bạn đồng ý. Mặc định tắt.',
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {t(
                  'Warrly dùng cookie thiết yếu để đăng nhập và ghi nhớ ngôn ngữ, giao diện. Cookie quảng cáo là tuỳ chọn và mặc định tắt; chỉ bật khi bạn đồng ý.',
                )}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {t(
                  'Bạn có thể đổi lựa chọn bất cứ lúc nào qua “Tuỳ chọn cookie” ở chân trang.',
                )}
              </p>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap md:justify-end">
          {view === 'manage' ? (
            <>
              <Button
                type="button"
                variant="default"
                className="w-full sm:w-auto"
                onClick={saveManagedChoice}
              >
                {t('Lưu lựa chọn')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => decide(false)}
              >
                {t('Từ chối không cần thiết')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full sm:w-auto"
                onClick={() => setView('ask')}
              >
                {t('Quay lại')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => decide(true)}
              >
                {t('Chấp nhận tất cả')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => decide(false)}
              >
                {t('Từ chối không cần thiết')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={openManage}
              >
                {t('Quản lý')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Footer control that reopens the consent panel.
 *
 * A button rather than a link: it changes in-page state, not the URL. It is
 * present on every public page (landing, legal, auth), which is what makes
 * withdrawal as discoverable as the original accept/reject.
 */
export function ConsentSettingsLink({ className = '' }: { className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={openConsentSettings}
      className={`text-left text-muted hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`.trim()}
    >
      {t('Tuỳ chọn cookie')}
    </button>
  );
}
