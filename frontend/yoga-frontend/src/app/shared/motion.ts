/**
 * Lazy GSAP gateway.
 *
 * Every scroll animation in the app goes through `loadMotion()` so the library
 * (and ScrollTrigger) is fetched once, registered once, and never pulled into
 * the initial bundle. Nothing here touches `window` at module scope, which
 * keeps the file safe for server-side rendering.
 */

export type GsapApi = typeof import('gsap').gsap;
export type ScrollTriggerApi = typeof import('gsap/ScrollTrigger').ScrollTrigger;

export interface Motion {
  readonly gsap: GsapApi;
  readonly ScrollTrigger: ScrollTriggerApi;
}

let pending: Promise<Motion> | undefined;

export function loadMotion(): Promise<Motion> {
  pending ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(
    ([core, scrollTrigger]) => {
      const gsap = core.gsap;
      const ScrollTrigger = scrollTrigger.ScrollTrigger;

      gsap.registerPlugin(ScrollTrigger);
      // Mobile browsers resize the viewport when the address bar collapses;
      // ignoring that keeps pinned sections from jumping.
      ScrollTrigger.config({ ignoreMobileResize: true });

      return { gsap, ScrollTrigger };
    },
  );

  return pending;
}

/** True when the visitor asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
