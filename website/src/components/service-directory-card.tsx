// "Đi bảo hành ở đâu" — the warranty service directory card (FEATURE_IDEAS #15).
//
// It only renders what `GET /v1/devices/{id}/service-directory` returned, and
// every branch below is decided by a pure helper in `@/lib/service-directory`
// (which is where the copy lives and where it is unit-tested).
//
// A CLIENT component, because the language comes from the provider in the root
// layout. The card used to be an RSC; the alternative — `await getI18n()` —
// would make it an async component, which `renderToStaticMarkup` cannot render
// (the tests below would silently assert against an empty string) and which
// would need a Suspense boundary on every page that shows it.
//
// The two honesty rules this card must never break:
//   * a null `brand` is EXPLAINED, never rendered as an empty box;
//   * `phoneSource` is rendered: `user` says "do bạn tự ghi", `none` says there
//     is no number at all. A phone is never presented as app-verified.
//
// ── Bilingual ─────────────────────────────────────────────────────────────
//
// A Server Component, so the language comes from `getI18n()` (cookie → stored
// preference → Accept-Language → `en`) and every sentence is wrapped in `t()`.
// The `DIRECTORY_*` constants imported below are the Vietnamese ORIGINALS — the
// dictionary keys — not pre-translated labels.

'use client';

import { AlertTriangle, ExternalLink, Info, MapPin, Phone, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';
import {
  DIRECTORY_ADDRESS_NONE,
  DIRECTORY_ADDRESS_USER_LABEL,
  DIRECTORY_LINK_SERVICE_LOCATOR_LABEL,
  DIRECTORY_LINK_SUPPORT_LABEL,
  DIRECTORY_PHONE_HONESTY,
  DIRECTORY_SECTION_HINT,
  brandEntryState,
  centreProviderState,
  centreStatus,
  directoryContactSummary,
  directorySummaryLine,
  phoneDisclosure,
  warrantyTypeLabel,
  type ServiceDirectory,
  type WarrantyCentre,
} from '@/lib/service-directory';

export function ServiceDirectoryCard({
  directory,
  unavailable = false,
}: {
  directory: ServiceDirectory | null;
  unavailable?: boolean;
}) {
  // Read before the early return so the "could not load" branch is translated
  // too.
  const t = useT();
  const locale = useLocale();

  if (unavailable || !directory) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('Không tải được danh bạ bảo hành — thử tải lại trang nhé.')}
      </p>
    );
  }

  const brand = brandEntryState(directory, locale);
  const summary = directoryContactSummary(directory);

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl border-[1.5px] border-dashed border-border bg-surface-2 p-3 text-xs text-ink-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span>{t(DIRECTORY_SECTION_HINT)}</span>
      </p>

      {/* Brand half. `brand === null` has its own wording; it is never a blank. */}
      <div className="rounded-xl border-[1.5px] border-border p-3">
        <p className="flex items-start gap-2 text-sm font-semibold text-ink">
          <Store className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{brand.title}</span>
        </p>

        {brand.kind === 'no-entry' && (
          <p className="mt-1 pl-6 text-sm text-amber-ink">
            {t('Hãng bạn ghi trên thiết bị:')}{' '}
            <span className="font-semibold">“{brand.brandInput}”</span>
          </p>
        )}

        <p className="mt-1 pl-6 text-xs leading-relaxed text-muted-foreground">{brand.detail}</p>

        {brand.kind === 'entry' && brand.hasVerifiedLink && (
          <ul className="mt-2 space-y-1 pl-6 text-sm">
            {brand.serviceLocatorUrl && (
              <li>
                <a
                  href={brand.serviceLocatorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t(DIRECTORY_LINK_SERVICE_LOCATOR_LABEL)}
                </a>
              </li>
            )}
            {brand.supportUrl && (
              <li>
                <a
                  href={brand.supportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t(DIRECTORY_LINK_SUPPORT_LABEL)}
                </a>
              </li>
            )}
          </ul>
        )}

        {brand.kind === 'entry' && brand.notes && (
          <p className="mt-2 pl-6 text-xs text-muted-foreground">{brand.notes}</p>
        )}
      </div>

      {/* Per-package half. */}
      <div className="space-y-2">
        <p className="text-sm text-ink-2">{directorySummaryLine(summary, locale)}</p>

        {directory.centres.length > 0 && (
          <ul className="space-y-2">
            {directory.centres.map((centre) => (
              <CentreRow key={centre.warrantyId} centre={centre} />
            ))}
          </ul>
        )}

        <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-ink" />
          <span>{t(DIRECTORY_PHONE_HONESTY)}</span>
        </p>
      </div>

      {/* The server's own explanation of every null, verbatim. It arrives in the
          request's language (the API call carries `?lang=`), so it is rendered
          exactly as sent. */}
      {directory.disclaimer && (
        <p className="border-t border-dashed border-border pt-3 text-xs italic leading-relaxed text-muted-foreground">
          {directory.disclaimer}
        </p>
      )}
    </div>
  );
}

function CentreRow({ centre }: { centre: WarrantyCentre }) {
  const t = useT();
  const locale = useLocale();
  const status = centreStatus(centre, locale);
  const provider = centreProviderState(centre, locale);
  const phone = phoneDisclosure(centre, locale);

  return (
    <li className="rounded-xl border-[1.5px] border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-sm font-bold text-ink">
          {warrantyTypeLabel(centre.warrantyType, locale)}
        </span>
        <Badge variant={status.kind === 'active' ? 'success' : status.kind === 'expired' ? 'secondary' : 'zinc'}>
          {status.label}
        </Badge>
        {centre.endDate && (
          <span className="text-xs text-muted-foreground">
            {t('Hết hạn {date}', { date: formatDate(centre.endDate, locale) })}
          </span>
        )}
      </div>

      {/* `providerInput` is ALWAYS shown next to the (possibly null) catalog row. */}
      <p className="mt-2 text-sm text-ink-2">
        {provider.kind === 'matched' ? (
          <>
            {t('Nhà bảo hành:')}{' '}
            <span className="font-semibold text-ink">{provider.name}</span>
            {provider.input && (
              <span className="text-muted-foreground">
                {' '}
                {t('(bạn ghi “{value}”)', { value: provider.input })}
              </span>
            )}
          </>
        ) : provider.kind === 'unmatched' ? (
          <>
            {t('Nhà bảo hành bạn ghi:')}{' '}
            <span className="font-semibold text-ink">“{provider.input}”</span>
          </>
        ) : null}
      </p>
      {provider.kind !== 'matched' && (
        <p className="mt-0.5 text-xs text-muted-foreground">{provider.note}</p>
      )}

      <div className="mt-2 space-y-1.5 text-sm">
        <p className="flex items-start gap-2">
          <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {phone.kind === 'none' ? (
            <span className="text-muted-foreground">
              <span className="font-semibold text-ink-2">{phone.label}</span> — {phone.hint}
            </span>
          ) : (
            <span className="text-ink-2">
              <span className="font-semibold tabular-nums text-ink">{phone.phone}</span>{' '}
              <Badge variant={phone.tone === 'amber' ? 'amber' : 'zinc'}>{phone.label}</Badge>
              <span className="mt-0.5 block text-xs text-muted-foreground">{phone.hint}</span>
            </span>
          )}
        </p>

        <p className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {centre.address ? (
            <span className="text-ink-2">
              {centre.address}{' '}
              <span className="text-xs text-muted-foreground">
                ({t(DIRECTORY_ADDRESS_USER_LABEL)})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t(DIRECTORY_ADDRESS_NONE)}</span>
          )}
        </p>
      </div>
    </li>
  );
}
