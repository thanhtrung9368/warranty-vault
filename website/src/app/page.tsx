// The landing page.
//
// This file is now only the SERVER shell: resolve the request's language and
// user, build the product shot's date data once, and hand the page to client
// components that own the copy. Everything visible is a client component that
// is still rendered to HTML on the server — that is the whole point: `/` and
// `/vi` keep their current markup (same text, same `lang`, same H1, same
// canonical/hreflang), and the language switch needs no request because the
// active locale lives in `InstantI18nProvider` (seeded with the server's
// answer) and every string is resolved from it in the browser.
//
// `dynamic = 'force-dynamic'` is unchanged, and deliberately so: the landing
// genuinely differs per request (the CTA depends on whether there is a session,
// and `getLocale()` reads cookies/headers). The switch no longer asks the
// server for anything, so the fact that a dynamic route cannot be prefetched by
// Next is no longer on the click path.
//
// The text itself lives in `src/components/landing/*`:
//
//   landing-header   — lockup, locale switch, theme toggle, signed-in CTA
//   landing-hero     — H1, subhead, CTAs and the product shot
//   landing-features — the six jobs as a numbered index, not six cards
//   landing-price    — free tier, limits, the data/exit columns
//   landing-faq      — the five questions
//   landing-closing  — final CTA and the first-person note
//   landing-footer   — wordmark, copyright, legal links
//
// Two sections that used to sit between `hero` and `features` are no longer
// rendered: `landing-stage` (a 240vh pinned track that repeated the hero's
// three beats in copy, with the same product shot again) and `landing-steps`
// (a second three-card row restating the hero CTA). Both files stay in the
// tree because `brand-wiring.test.ts` reads the landing source by filename,
// but the page no longer pays for their scroll length or their JS. See the
// handoff's "one lead per screen": neither section had a claim to the lead,
// and together they were 3,800 px of the 8,800 px page at 390.
//
// Why the product shot's dates are computed HERE and not in the browser: the
// demo's pills are day counts ("Còn 22 ngày"), so the client render has to
// agree with the server render down to the calendar day or hydration would
// rewrite them. `daysBetween(server today, end day)` is a pure day-number; the
// day strings are `YYYY-MM-DD`, which `formatDate` slices rather than parsing
// into an instant. No `new Date()` runs in the client components.

import { InstantI18nProvider } from '@/lib/i18n/client';
import { PublicStructuredData } from '@/lib/structured-data';
import { RevealObserver } from '@/components/reveal-observer';
import { DocumentTitleSync } from '@/components/i18n/document-title';
import { ConsentBanner } from '@/components/consent/consent-banner';
import { LandingHeader } from '@/components/landing/landing-header';
import { LandingHero } from '@/components/landing/landing-hero';
import { LandingFeatures } from '@/components/landing/landing-features';
import { LandingPrice } from '@/components/landing/landing-price';
import { LandingFaq } from '@/components/landing/landing-faq';
import { LandingClosing } from '@/components/landing/landing-closing';
import { LandingFooter } from '@/components/landing/landing-footer';
import type { LandingProductShot } from '@/components/landing/landing-product';
import { dayKey, daysBetween, todayDay } from '@/lib/api-day';
import { getCurrentUser } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

/**
 * The calendar day `offset` days from now.
 *
 * Noon matters: the display compares CALENDAR days, so a target built from
 * `Date.now() + n * DAY_MS` can land at 23:5x and flip the pill one day early.
 * Anchoring at noon keeps the demo's "Còn 22 ngày" stable for the whole day it
 * is rendered.
 */
function dayFromNow(offset: number): string {
  const day = new Date(Date.now() + offset * DAY_MS);
  day.setHours(12, 0, 0, 0);
  return dayKey(day);
}

/** The product shot's day data, computed once per request (see the note above). */
function productShot(): LandingProductShot {
  const today = todayDay();
  const at = (offset: number) => {
    const endDay = dayFromNow(offset);
    return { endDay, daysLeft: daysBetween(today, endDay) };
  };
  return {
    fridge: at(342),
    washer: at(22),
    phone: at(9),
  };
}

export default async function LandingPage() {
  const { locale } = await getI18n();
  const user = await getCurrentUser();
  const signedIn = Boolean(user);
  const shot = productShot();
  const year = new Date().getFullYear();

  return (
    <InstantI18nProvider locale={locale}>
      <div className="flex min-h-screen flex-col">
        {/* WebSite + Organization. The landing page is outside the `(public)`
            route group, so it renders the shared node set itself; the legal
            pages get it from `(public)/layout.tsx`. One module builds both, so
            the site name/URL/logo cannot differ between them. */}
        <PublicStructuredData />
        {/* One observer for every <Reveal> on the page. It renders nothing; the
            wrapper markup and the animation are server/CSS-owned. Mounted here
            rather than in the root layout so no other route pays for the JS. */}
        <RevealObserver />
        {/* The visible copy switches instantly; the tab title catches up one
            effect later. The server-emitted head is untouched (that is what
            crawlers and shared-link unfurlers read). */}
        <DocumentTitleSync
          title="Warrly — Quản lý bảo hành & gói đăng ký"
          description="Theo dõi thiết bị, bảo hành, gói đăng ký và wishlist — đơn giản, gọn gàng, song ngữ Việt–Anh."
        />
        <LandingHeader signedIn={signedIn} />
        <main className="flex-1">
          <LandingHero signedIn={signedIn} shot={shot} />
          <LandingFeatures signedIn={signedIn} />
          <LandingPrice />
          <LandingFaq />
          <LandingClosing signedIn={signedIn} />
          <LandingFooter year={year} />
        </main>
        <ConsentBanner />
      </div>
    </InstantI18nProvider>
  );
}
