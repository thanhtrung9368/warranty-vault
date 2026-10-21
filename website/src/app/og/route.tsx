// The Open Graph card, generated at request time with `next/og`.
//
// 1200×630 is the size every one of Zalo/Facebook/X/LinkedIn expects; a real
// image is the difference between a designed preview and a bare URL in a group
// chat. The copy is NOT written here — the metadata helper passes the translated
// title/description it already puts in `<meta>`, so the image cannot describe a
// different page or language than the tags do. The palette comes from
// `OG_TOKENS` in `lib/metadata.ts`, which the test pins to `globals.css`.
//
// No new dependency: `next/og` ships with Next. The default font is the
// bundled Geist; the fallback strings below are ASCII brand copy, and the
// title/description arrive as ASCII English by default.

import { ImageResponse } from 'next/og';
import {
  OG_COLORS,
  OG_IMAGE_SIZE,
  SITE_NAME,
} from '@/lib/metadata';

export const dynamic = 'force-dynamic';

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 190;

export async function GET(request: Request): Promise<ImageResponse> {
  const params = new URL(request.url).searchParams;
  const title = (params.get('title')?.trim() || SITE_NAME).slice(0, MAX_TITLE);
  const description = (params.get('description')?.trim() || '').slice(
    0,
    MAX_DESCRIPTION,
  );
  const language = params.get('locale') === 'vi' ? 'VI' : 'EN';

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: '68px 72px',
          backgroundColor: OG_COLORS.background,
          color: OG_COLORS.foreground,
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 76,
              height: 76,
              borderRadius: 22,
              backgroundColor: OG_COLORS.primary,
              color: OG_COLORS.primaryInk,
              fontSize: 44,
              fontWeight: 800,
            }}
          >
            W
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginLeft: 22,
            }}
          >
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1 }}>
              {SITE_NAME}
            </div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: OG_COLORS.muted,
                marginTop: 4,
              }}
            >
              {language === 'VI' ? 'QUẢN LÝ BẢO HÀNH' : 'WARRANTY TRACKER'}
            </div>
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

        {/* Footer: domain + language, no second campaign slogan */}
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
              backgroundColor: OG_COLORS.primary,
              color: OG_COLORS.primaryInk,
              borderRadius: 999,
              padding: '10px 24px',
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            warrly.com
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: 21,
              fontWeight: 700,
              color: OG_COLORS.muted,
            }}
          >
            <div
              style={{
                display: 'flex',
                width: 12,
                height: 12,
                borderRadius: 999,
                backgroundColor: OG_COLORS.primary,
                marginRight: 10,
              }}
            />
            {language}
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
