'use client';

import { Bell, Paperclip, Plus, ShieldCheck } from 'lucide-react';
import { CategoryIconBadge } from '@/components/category-icon';
import { WarrlyMark } from '@/components/brand';
import { formatDay } from '@/lib/api-day';
import { warrantyStateFromDays } from '@/lib/warranty-state';
import { useLocale, useT } from '@/lib/i18n/client';
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
 * It is a client component so the language switch reaches it too. That has one
 * hard requirement: it must render the same string on the server and in the
 * browser, or React would rewrite the demo after hydration. So the day
 * arithmetic happens ONCE, on the server (`page.tsx` → `daysBetween`), and
 * arrives as a calendar day (`YYYY-MM-DD`) plus its day count. `formatDay` on
 * a bare day is a pure string slice (`api-day.ts`) and the count-to-label
 * mapping is `warrantyStateFromDays`; neither reads the clock or the timezone.
 *
 * The whole thing is decorative (`aria-hidden`): the hero's H1 and subhead
 * carry the meaning, and the pinned stage repeats the same information in its
 * three beat captions. Reading every demo row twice would help nobody.
 */
export type LandingProductShot = {
  fridge: { endDay: string; daysLeft: number };
  washer: { endDay: string; daysLeft: number };
  phone: { endDay: string; daysLeft: number };
};

type LandingProductProps = {
  shot: LandingProductShot;
  className?: string;
};

function CountdownPill({ daysLeft }: { daysLeft: number }) {
  const locale = useLocale();
  const state = warrantyStateFromDays(daysLeft, locale);
  return (
    <span className="wv-warranty-pill" data-status={state.tone}>
      <span className="dot" />
      {state.label}
    </span>
  );
}

export function LandingProduct({ shot, className }: LandingProductProps) {
  const t = useT();
  const locale = useLocale();

  const devices = [
    {
      category: 'FRIDGE',
      name: t('Tủ lạnh'),
      meta: 'Samsung · Inverter 236L',
      end: shot.fridge,
      files: 2,
    },
    {
      category: 'WASHING',
      name: t('Máy giặt / Sấy'),
      meta: 'Electrolux · EWF1024',
      end: shot.washer,
      files: 1,
    },
    {
      // A proper noun: the model a household actually says. It is not
      // catalogue copy and must not be translated.
      category: 'PHONE',
      name: 'iPhone 15 Pro',
      meta: 'Apple · 128GB',
      end: shot.phone,
      files: 1,
    },
  ];

  return (
    <div className={cn('wv-product', className)} aria-hidden="true">
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
          <p className="wv-product-toast-meta">
            {leadDaysLabel([30, 7], locale)}
          </p>
        </div>
      </div>

      <div className="wv-product-frame">
        {/* The stage clips THIS wrapper, never the frame: the frame's border
            and shadow must survive at p=1, and the floating notification is a
            sibling above the frame. */}
        <div className="wv-product-clip">
          <div className="wv-product-head">
            <span className="wv-product-mark">
              <WarrlyMark size={32} />
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
              <div className="wv-product-row" key={device.category}>
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
                <CountdownPill daysLeft={device.end.daysLeft} />
              </div>
            ))}
          </div>

          <div className="wv-product-summary">
            <div className="wv-product-summary-head">
              <span className="wv-product-summary-title">
                <ShieldCheck />
                {t('Tổng quan bảo hành')}
              </span>
              <CountdownPill daysLeft={shot.washer.daysLeft} />
            </div>
            <p className="wv-product-summary-line">
              {t('Có {count} gói bảo hành. Gói xa nhất hết {date}.', {
                count: 1,
                date: formatDay(shot.washer.endDay, locale),
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
