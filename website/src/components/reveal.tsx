import type { CSSProperties, ReactNode } from 'react';

/**
 * Server-rendered wrapper for the landing page's scroll reveals.
 *
 * The markup is a plain div and is visible by default: the browser must never
 * depend on JavaScript to read this page. `RevealObserver` arms the wrappers
 * (`data-wv-reveal-state="pending"`) once it has hydrated, so the hidden start
 * state exists only while the observer that will reveal it is alive. A visitor
 * whose JS never lands keeps the full page.
 *
 * The animation itself lives in `globals.css` (`.wv-reveal`), not in a style
 * prop, so the reduced-motion and scroll-timeline overrides can target it.
 * Only the per-item delay is data, because it depends on the item's index.
 */
type RevealProps = {
  children: ReactNode;
  /** Position in the group. Delays are capped so the last card never waits long. */
  index?: number;
  className?: string;
  /**
   * Opt this item into the CSS `animation-timeline: view()` enhancement.
   * Browsers without scroll-driven animations fall back to the observer path;
   * the observer skips the item only when the CSS feature really is active.
   */
  scrollDriven?: boolean;
};

/**
 * Apple's StaggeredFadeIn uses 0.15s steps for up to 30 items. A marketing grid
 * of six does not need to feel that slow: 70ms keeps the cascade legible and
 * caps the whole group at 350ms (index 5), which is inside the 0.7s animation.
 */
export const REVEAL_STEP_MS = 70;
export const REVEAL_MAX_INDEX = 5;

export function Reveal({
  children,
  index = 0,
  className = '',
  scrollDriven = false,
}: RevealProps) {
  const step = Math.min(Math.max(index, 0), REVEAL_MAX_INDEX);
  const style = {
    '--wv-reveal-delay': `${step * REVEAL_STEP_MS}ms`,
  } as CSSProperties;

  return (
    <div
      className={`wv-reveal ${className}`.trim()}
      style={style}
      data-wv-reveal=""
      data-wv-scroll={scrollDriven ? '' : undefined}
    >
      {children}
    </div>
  );
}
