import { Bell, Paperclip, Plus, ShieldCheck, Vault } from 'lucide-react';
import { CategoryIconBadge } from '@/components/category-icon';
import { formatDate, warrantyState } from '@/lib/format';
import type { Translator } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';
import { leadDaysLabel } from '@/lib/lead-days';
import { cn } from '@/lib/utils';

/**
 * The landing page's product shot — real app UI, built from DOM.
 *
 * This is NOT an illustration and it is not a screenshot. It is the same
 * visual language the signed-in app already uses: `CategoryIconBadge`, the
 * `.wv-warranty-pill` status colours, the device-list row shape from
 * `app/(app)/devices/page.tsx`, and the "Tổng quan bảo hành" card from
 * `app/(app)/devices/[id]/page.tsx`. Reusing those pieces is the point: a
 * visitor who signs up meets the same shapes on day one instead of a drawing
 * that exists nowhere in the product.
 *
 * It is a Server Component. No hooks, no state, no client bundle — the two
 * countdowns are computed once on the server for this request. `page.tsx` is
 * `force-dynamic`, so the dates are relative to "now" on every request and the
 * composition cannot silently age into a wall of expired pills.
 *
 * The whole thing is decorative (`aria-hidden`): the hero's H1 and subhead
 * carry the meaning, and the pinned stage repeats the same information in its
 * three beat captions. Reading every demo row twice would help nobody.
 */
type LandingProductProps = {
  t: Translator;
  locale: Locale;
  className?: string;
};

const DAY_MS = 86_400_000;

/**
 * A calendar day `offset` days from now, at local noon.
 *
 * Noon matters: `warrantyState` compares CALENDAR days (`differenceInCalendarDays`),
 * so a target built from `Date.now() + n * DAY_MS` can land at 23:5x and flip
 * the pill one day early. Anchoring at noon keeps the demo's "Còn 22 ngày"
 * stable for the whole day it is rendered.
 */
function dayFromNow(offset: number): Date {
  const day = new Date(Date.now() + offset * DAY_MS);
  day.setHours(12, 0, 0, 0);
  return day;
}

function CountdownPill({ end, locale }: { end: Date; locale: Locale }) {
  const state = warrantyState(end, locale);
  return (
    <span className="wv-warranty-pill" data-status={state.tone}>
      <span className="dot" />
      {state.label}
    </span>
  );
}

export function LandingProduct({ t, locale, className }: LandingProductProps) {
  const fridgeEnd = dayFromNow(342);
  const washerEnd = dayFromNow(22);
  const phoneEnd = dayFromNow(9);

  const devices = [
    {
      category: 'FRIDGE',
      name: t('Tủ lạnh'),
      meta: 'Samsung · Inverter 236L',
      end: fridgeEnd,
      files: 2,
    },
    {
      category: 'WASHING',
      name: t('Máy giặt / Sấy'),
      meta: 'Electrolux · EWF1024',
      end: washerEnd,
      files: 1,
    },
    {
      // A proper noun: the model a household actually says. It is not
      // catalogue copy and must not be translated.
      category: 'PHONE',
      name: 'iPhone 15 Pro',
      meta: 'Apple · 128GB',
      end: phoneEnd,
      files: 1,
    },
  ];

  return (
    <div className={cn('wv-product', className)} aria-hidden="true">
      <div className="wv-product-glow" />

      {/* A push notification is the product's emotional payoff, so it floats
          above the app surface like a real lock-screen banner. Positioned
          inside the composition's own box — no negative horizontal offset, so
          it cannot add to document scrollWidth at 390px. */}
      <div className="wv-product-toast">
        <span className="wv-product-toast-icon">
          <Bell />
        </span>
        <div className="min-w-0">
          <p className="wv-product-toast-title">{t('Máy giặt / Sấy sắp hết bảo hành.')}</p>
          <p className="wv-product-toast-meta">{leadDaysLabel([30, 7], locale)}</p>
        </div>
      </div>

      <div className="wv-product-frame">
        {/* The stage clips THIS wrapper, never the frame: the frame's border
            and shadow must survive at p=1, and the floating notification is a
            sibling above the frame. */}
        <div className="wv-product-clip">
          <div className="wv-product-head">
            <span className="wv-product-mark">
              <Vault />
            </span>
            <div className="min-w-0 flex-1">
              <p className="wv-product-head-title">{t('Thiết bị')}</p>
              <p className="wv-product-head-meta">
                {t('{count} thiết bị', { count: devices.length })}
              </p>
            </div>
            <span className="wv-product-add">
              <Plus />
              {t('Thêm thiết bị')}
            </span>
          </div>

          <div className="wv-product-list">
            {devices.map((device) => (
              <div className="wv-product-row" key={device.name}>
                <CategoryIconBadge category={device.category} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="wv-product-name">{device.name}</p>
                  <p className="wv-product-meta">
                    <span className="truncate">{device.meta}</span>
                    <span className="wv-product-files">
                      <Paperclip />
                      {device.files}
                    </span>
                  </p>
                </div>
                <CountdownPill end={device.end} locale={locale} />
              </div>
            ))}
          </div>

          <div className="wv-product-summary">
            <div className="wv-product-summary-head">
              <span className="wv-product-summary-title">
                <ShieldCheck />
                {t('Tổng quan bảo hành')}
              </span>
              <CountdownPill end={washerEnd} locale={locale} />
            </div>
            <p className="wv-product-summary-line">
              {t('Có {count} gói bảo hành. Gói xa nhất hết {date}.', {
                count: 1,
                date: formatDate(washerEnd, locale),
              })}
            </p>
            <div className="wv-product-attachment">
              <span className="wv-product-file">
                <Paperclip />
              </span>
              <div className="min-w-0 flex-1">
                <p className="wv-product-file-name">hoa-don-may-giat.pdf</p>
                <p className="wv-product-file-meta">PDF · 1,2 MB · {t('Đã mã hoá')}</p>
              </div>
              <span className="wv-product-file-tag">{t('Hoá đơn')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
