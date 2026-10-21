import { cn } from '@/lib/utils';

/**
 * One page header.
 *
 * There were ~20 hand-rolled copies in three variants:
 *
 *   * top-level pages — eyebrow + `display mt-1 text-3xl md:text-4xl` + a
 *     `text-sm md:text-base` description;
 *   * the dashboard — no eyebrow, `md:text-[34px]`, its own stack;
 *   * failure/empty branches (subscriptions, wishlist, actions) — the eyebrow
 *     and the desktop size were dropped, so a brand-new user's first view was
 *     a smaller, different header.
 *
 * The `actions` slot is the right-hand button group; `leading` is an optional
 * icon badge used by detail pages; `back` renders the small return link above
 * the eyebrow on create/edit screens. `eyebrow`, `title` and `description` take
 * ReactNode so a caller can pass an icon or an inline pill without forking the
 * layout.
 *
 * The title carries `!leading-tight` (important) because `.display` sets
 * line-height 1.05 in an unlayered rule, which beats a normal utility and is
 * too tight for Vietnamese stacked diacritics once the caller puts more than
 * one word on the line.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  leading,
  back,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  back?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-end justify-between gap-3',
        leading && 'items-start',
        className,
      )}
    >
      <div className={cn('min-w-0', leading && 'flex min-w-0 items-start gap-4')}>
        {leading}
        <div className="min-w-0">
          {back}
          {eyebrow != null && <p className="eyebrow">{eyebrow}</p>}
          <h1 className="display mt-1 text-3xl !leading-tight text-ink md:text-4xl">
            {title}
          </h1>
          {description != null && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground md:text-base">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions != null && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
