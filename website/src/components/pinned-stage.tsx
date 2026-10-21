'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The engine behind the pinned product stage.
 *
 * This is the only JavaScript the stage needs. It does one thing: while the
 * tall track is on screen, run a single `requestAnimationFrame` loop that reads
 * the track's box once per frame and writes ONE custom property — `--p`, the
 * 0..1 scroll progress — onto the sticky panel. CSS owns every pixel of
 * geometry (`calc()`, `scale()`, `clip-path`), so there is no second source of
 * truth and no style thrash from React.
 *
 * Why a rAF loop instead of a scroll listener:
 *   * a `scroll` listener fires synchronously on the main thread and every
 *     handler that reads `getBoundingClientRect` forces layout; a rAF loop
 *     reads at most once per painted frame, which is the only rate that can
 *     change a pixel.
 *   * the loop is started and stopped by an IntersectionObserver, so a stage
 *     that is off screen costs zero. When the section leaves the viewport the
 *     observer stops it; when it comes back the observer starts it again.
 *   * no wheel/touch listeners exist, so nothing (not even a passive one) can
 *     compete with the browser's own scrolling.
 *
 * Progressive enhancement, in order:
 *   1. No JavaScript — the markup is fully readable. `--p` defaults to 1 in CSS,
 *      so the composition is at scale 1 with no clip, and the three beats are
 *      stacked vertically (only `data-wv-stage-live` opts into the overlap).
 *   2. `prefers-reduced-motion: reduce` — the CSS collapses the pin at once
 *      (`position: static`, auto height) and this component never touches
 *      `--p`. The stage is a plain, static section.
 *   3. JavaScript + motion — `data-wv-stage-live` is added after the effect
 *      runs; the CSS then pins the panel and crossfades the beats from `--p`.
 *
 * The attribute lives on `<html>` rather than the panel so CSS can gate the
 * beat layout without an extra wrapper. It is removed on cleanup and whenever
 * the `lg` or reduced-motion media query stops matching.
 */
export function PinnedStage({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    const panel = panelRef.current;
    if (!track || !panel) return;

    const root = document.documentElement;
    const wide = window.matchMedia('(min-width: 1024px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    let frame = 0;
    let running = false;
    let inView = false;
    let stickyTop = 0;
    let lastProgress = -1;
    let observer: IntersectionObserver | null = null;

    // Reading the computed `top` is a style read, not a layout read; it only
    // happens when the loop starts or the viewport changes, never per frame.
    const readStickyTop = () => {
      const value = Number.parseFloat(window.getComputedStyle(panel).top);
      stickyTop = Number.isFinite(value) ? value : 0;
    };

    const writeProgress = () => {
      // The ONE layout read of the frame. `window.innerHeight` is a cached
      // viewport value, not a layout query. The panel's min-height is 100svh,
      // so the scrollable distance is track height minus one viewport.
      const rect = track.getBoundingClientRect();
      const distance = rect.height - window.innerHeight;
      const raw = distance > 0 ? (stickyTop - rect.top) / distance : 1;
      const progress = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      // Writing the same value again would invalidate style for no visual
      // change; at rest the loop then costs one rect read per frame, not a
      // style recalculation.
      const rounded = Math.round(progress * 10_000) / 10_000;
      if (rounded === lastProgress) return;
      lastProgress = rounded;
      panel.style.setProperty('--p', rounded.toFixed(4));
    };

    const tick = () => {
      writeProgress();
      // Re-arm only while running: `stop()` can be called from the observer or
      // a media-query change between two frames, and a stale frame must not
      // resurrect the loop.
      if (running) frame = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      // Opt into the pinned presentation only when the loop that drives it is
      // alive. Before this attribute the stage is already a readable vertical
      // sequence — the enhancement never gates the content.
      root.setAttribute('data-wv-stage-live', '1');
      readStickyTop();
      writeProgress();
      frame = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };

    const disarm = () => {
      stop();
      root.removeAttribute('data-wv-stage-live');
      // Back to the no-JS default: composition unclipped and at scale 1, beats
      // in normal flow.
      panel.style.removeProperty('--p');
      lastProgress = -1;
    };

    const ensureObserver = () => {
      if (observer || typeof IntersectionObserver === 'undefined') return;
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          inView = Boolean(entry?.isIntersecting);
          if (!wide.matches || reduced.matches) return;
          if (inView) start();
          else stop();
        },
        // Start a little before the section reaches the viewport, and keep the
        // loop alive a little past its exit, so the first and last frames are
        // already correct when the user sees them.
        { rootMargin: '160px 0px' },
      );
      observer.observe(track);
    };

    const sync = () => {
      if (!wide.matches || reduced.matches) {
        disarm();
        return;
      }
      ensureObserver();
      if (inView) start();
      else stop();
    };

    const onViewportChange = () => {
      if (!wide.matches || reduced.matches) {
        disarm();
        return;
      }
      // The sticky offset is a rem value, so a root-font-size change (the
      // density/font preference) moves it. Re-read it on resize; the rAF loop
      // will pick up the new value on its next frame.
      readStickyTop();
      if (inView) start();
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (inView && wide.matches && !reduced.matches) start();
    };

    // `passive` is the browser's promise that these never call preventDefault;
    // the resize listener only re-reads a style value and pokes the existing
    // loop, it never reads layout itself.
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('orientationchange', onViewportChange, { passive: true });
    wide.addEventListener('change', sync);
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', onVisibility);

    ensureObserver();
    sync();

    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      wide.removeEventListener('change', sync);
      reduced.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
      observer = null;
      disarm();
    };
  }, []);

  return (
    <div ref={trackRef} className="wv-stage-track">
      <div ref={panelRef} className="wv-stage-panel">
        {children}
      </div>
    </div>
  );
}
