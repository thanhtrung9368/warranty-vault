'use client';

import { useEffect } from 'react';

/**
 * The single client-side engine behind every `<Reveal>` on the page.
 *
 * One IntersectionObserver serves the whole group (Apple's StaggeredFadeIn does
 * the same); the CSS owns the geometry and the duration. This component only
 * decides *when* an item becomes `revealed` and cleans up the one compositor
 * hint it sets.
 *
 * Two supported paths:
 *
 *   1. The JavaScript path — arm each wrapper (`pending`), observe it, reveal on
 *      first intersection, release `will-change` on `transitionend`.
 *   2. The reduced-motion path — never arm anything. The CSS media query in
 *      `globals.css` already pins every reveal to its final state; this path
 *      also makes that explicit in the DOM and reacts to an OS-level toggle
 *      without a reload.
 *
 * Items marked `data-wv-scroll` are skipped when the browser really supports
 * `animation-timeline: view()`, because `globals.css` is already running them
 * off the main thread. The feature is checked in JS as well as CSS so a browser
 * that parses the query but cannot run it still gets the observer path.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function supportsViewTimeline(): boolean {
  try {
    return (
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('animation-timeline: view()')
    );
  } catch {
    return false;
  }
}

export function RevealObserver() {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>('[data-wv-reveal]'),
    );
    let observer: IntersectionObserver | null = null;
    // One listener per element, removed when its transition ends. Kept in a
    // Map (not a WeakMap) because the unmount path iterates it to release a
    // hint that would otherwise stay on the compositor forever.
    const releaseWillChange = new Map<HTMLElement, () => void>();

    const release = (element: HTMLElement) => {
      element.style.willChange = 'auto';
      const cleanup = releaseWillChange.get(element);
      if (cleanup) {
        cleanup();
        releaseWillChange.delete(element);
      }
    };

    const reveal = (element: HTMLElement) => {
      if (element.dataset.wvRevealState === 'revealed') return;

      if (media.matches) {
        // The CSS reduced-motion block pins the final state with !important;
        // this keeps the DOM state honest and skips the compositor hint.
        element.dataset.wvRevealState = 'revealed';
        return;
      }

      // An element that was already on screen when this effect ran is shown
      // immediately: there is no pending state to transition from, and holding
      // a compositor hint for a transition that never runs is exactly what
      // "will-change only while running" forbids.
      if (element.dataset.wvRevealState !== 'pending') {
        element.dataset.wvRevealState = 'revealed';
        return;
      }

      element.style.willChange = 'opacity, transform';
      element.dataset.wvRevealState = 'revealed';

      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.target !== element || event.propertyName !== 'transform') return;
        release(element);
      };
      const timer = window.setTimeout(() => release(element), 1400);
      releaseWillChange.set(element, () => {
        window.clearTimeout(timer);
        element.removeEventListener('transitionend', onTransitionEnd);
      });
      element.addEventListener('transitionend', onTransitionEnd);
    };

    const revealAll = () => {
      for (const element of elements) reveal(element);
    };

    const stop = () => {
      observer?.disconnect();
      observer = null;
    };

    const start = () => {
      root.dataset.motion = 'full';

      // No IntersectionObserver (very old browser, or a test harness): show
      // everything rather than leaving it pending forever.
      if (typeof IntersectionObserver === 'undefined') {
        revealAll();
        return;
      }

      const cssTimeline = supportsViewTimeline();
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            reveal(entry.target as HTMLElement);
            observer?.unobserve(entry.target);
          }
        },
        // Start just inside the viewport, so the animation is not already over
        // by the time the item is properly visible on a short screen.
        { rootMargin: '0px 0px -10% 0px', threshold: 0.01 },
      );

      for (const element of elements) {
        if (element.dataset.wvRevealState === 'revealed') continue;
        if (cssTimeline && element.hasAttribute('data-wv-scroll')) continue;

        // Already on screen at hydration (scroll restoration, a very tall
        // viewport): never hide it just to animate it back in. The layout is
        // final from the server HTML; this is the one case where motion loses.
        const rect = element.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          reveal(element);
          continue;
        }

        element.dataset.wvRevealState = 'pending';
        // Flush the pending style before observation. Without this the browser
        // can coalesce `pending` and `revealed` into one style pass and the
        // transition never runs for an item the observer fires for immediately.
        element.getBoundingClientRect();
        observer.observe(element);
      }
    };

    const sync = () => {
      if (media.matches) {
        stop();
        // The CSS-timeline cards are driven purely by scroll. Drop the opt-in
        // attribute while motion is reduced so they cannot spring back to a
        // partial opacity when the setting is turned off again; they are pinned
        // to their final state by the CSS block and by `revealAll` below.
        for (const element of elements) element.removeAttribute('data-wv-scroll');
        root.dataset.motion = 'reduce';
        revealAll();
      } else {
        start();
      }
    };

    sync();
    // Toggling the OS setting must take effect without a reload. Going back to
    // `no-preference` does not re-hide anything: a visitor who has already read
    // a card should not watch it disappear.
    media.addEventListener('change', sync);

    return () => {
      media.removeEventListener('change', sync);
      stop();
      for (const element of [...releaseWillChange.keys()]) release(element);
    };
  }, []);

  return null;
}
