// The Open Graph card, generated at request time with `next/og`.
//
// 1200×630 is the size every one of Zalo/Facebook/X/LinkedIn expects; a real
// image is the difference between a designed preview and a bare URL in a group
// chat. The copy is NOT written here — the metadata helper passes the translated
// title/description it already puts in `<meta>`, so the image cannot describe a
// different page or language than the tags do. The palette comes from
// `OG_TOKENS` in `lib/metadata.ts`, which the test pins to `globals.css`.
//
// The mark on this card is the one-lockup asset from `lib/brand.ts`, embedded as
// a fixed-outline SVG data URI. It is NOT a font-dependent "Warrly" string and
// NOT the old hand-drawn "W in a coral tile" that made a third mark. The
// wordmark cannot reflow or flash here because there is no font involved at all.
//
// The descriptor is Vietnamese by default. That is the artifact rule the emails
// and share certificates already follow: a card is generated once, leaves the
// app, and is read by whoever opens the link — possibly on a device whose owner
// never chose a language. The title/description still arrive in the page's own
// language; only the brand descriptor is fixed.

import { ImageResponse } from 'next/og';
import { renderLockupSvg, LOCKUP_ASPECT } from '@/lib/brand';
import { translate } from '@/lib/i18n/catalog';
import { OG_COLORS, OG_IMAGE_SIZE } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 190;

/** The lockup's rendered height on the card, and its derived width. */
const LOCKUP_HEIGHT = 82;
const LOCKUP_WIDTH = Math.round(LOCKUP_HEIGHT * LOCKUP_ASPECT);

// The card's own palette, NOT the current accent: a share card must look the
// same for a coral user and an emerald user. Ink body + coral dot is the
// 6.1:1 default pair from the brand contrast contract.
const LOCKUP_URI = `data:image/svg+xml;base64,${Buffer.from(
  renderLockupSvg({
    height: LOCKUP_HEIGHT,
    fills: { body: OG_COLORS.foreground, dot: OG_COLORS.primary },
  }),
).toString('base64')}`;

export async function GET(request: Request): Promise<ImageResponse> {
  const params = new URL(request.url).searchParams;
  const title = (
    params.get('title')?.trim() ||
    translate('vi', 'Warrly — Quản lý bảo hành & gói đăng ký')
  ).slice(0, MAX_TITLE);
  const description = (params.get('description')?.trim() || '').slice(
    0,
    MAX_DESCRIPTION,
  );
  // Always the Vietnamese column: this is an artifact, not a screen.
  const brandLine = translate('vi', 'Giữ ngày. Giữ giấy.');

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: '64px 72px',
          backgroundColor: OG_COLORS.background,
          color: OG_COLORS.foreground,
          fontFamily: 'sans-serif',
        }}
      >
        {/* The one lockup on the card. No second "W" tile, no repeated
            wordmark in the footer. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- satori renders this inline; there is no Next image loader inside ImageResponse */}
          <img
            src={LOCKUP_URI}
            width={LOCKUP_WIDTH}
            height={LOCKUP_HEIGHT}
            alt="Warrly"
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: 24,
              fontWeight: 700,
              color: OG_COLORS.muted,
            }}
          >
            warrly.com
          </div>
        </div>

        {/* Headline + sub-line — the same copy as the meta tags */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            paddingTop: 26,
          }}
        >
          <div
            style={{
              fontSize: title.length > 64 ? 54 : 66,
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              maxWidth: 1040,
            }}
          >
            {title}
          </div>
          {description ? (
            <div
              style={{
                fontSize: 26,
                lineHeight: 1.35,
                color: OG_COLORS.muted,
                marginTop: 26,
                maxWidth: 980,
              }}
            >
              {description}
            </div>
          ) : null}
        </div>

        {/* Footer: the brand line, not a second campaign slogan and not a
            language pill. There is no per-accent colour here on purpose. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `2px solid ${OG_COLORS.border}`,
            paddingTop: 26,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: '-0.01em',
            }}
          >
            {brandLine}
          </div>
        </div>
      </div>
    ),
    {
      ...OG_IMAGE_SIZE,
      // The route is copy-per-request (title/description are query params), so
      // a shared cache must include them; Next already varies on the URL.
    },
  );
}
