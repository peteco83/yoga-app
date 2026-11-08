import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  input,
  numberAttribute,
} from '@angular/core';
import { loadMotion, prefersReducedMotion } from './motion';

export type ScrollRevealFrom = 'bottom' | 'top' | 'left' | 'right' | 'scale' | 'fade';

interface RevealOffset {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

const OFFSETS: Record<ScrollRevealFrom, RevealOffset> = {
  bottom: { x: 0, y: 1, scale: 1 },
  top: { x: 0, y: -1, scale: 1 },
  left: { x: -1, y: 0, scale: 1 },
  right: { x: 1, y: 0, scale: 1 },
  scale: { x: 0, y: 0, scale: 0.92 },
  fade: { x: 0, y: 0, scale: 1 },
};

/**
 * Reveals its host (or a set of children) the first time it scrolls into view.
 *
 * The starting state is applied by GSAP, never by CSS, so the content stays
 * fully visible when JavaScript, WebGL or motion is unavailable.
 *
 * ```html
 * <section appScrollReveal>...</section>
 * <div appScrollReveal=".card" appScrollRevealStagger="0.14">...</div>
 * ```
 */
@Directive({ selector: '[appScrollReveal]' })
export class ScrollRevealDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Optional child selector: when set, only the matching children stagger in. */
  readonly childSelector = input('', { alias: 'appScrollReveal' });
  readonly from = input<ScrollRevealFrom>('bottom', { alias: 'appScrollRevealFrom' });
  readonly delay = input(0, { alias: 'appScrollRevealDelay', transform: numberAttribute });
  readonly stagger = input(0.12, { alias: 'appScrollRevealStagger', transform: numberAttribute });
  readonly distance = input(48, { alias: 'appScrollRevealDistance', transform: numberAttribute });
  readonly start = input('top 85%', { alias: 'appScrollRevealStart' });

  private revert: (() => void) | undefined;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      void this.reveal();
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.revert?.();
    });
  }

  private async reveal(): Promise<void> {
    if (prefersReducedMotion()) {
      return;
    }

    const element = this.host.nativeElement;
    const selector = this.childSelector();
    const targets = selector
      ? Array.from(element.querySelectorAll<HTMLElement>(selector))
      : [element];

    if (targets.length === 0) {
      return;
    }

    const { gsap } = await loadMotion();
    if (this.destroyed) {
      return;
    }

    const offset = OFFSETS[this.from()];
    const distance = this.distance();

    const context = gsap.context(() => {
      gsap.from(targets, {
        opacity: 0,
        x: offset.x * distance,
        y: offset.y * distance,
        scale: offset.scale,
        duration: 0.9,
        delay: this.delay(),
        ease: 'power3.out',
        stagger: selector ? this.stagger() : 0,
        // Drop the inline transform afterwards so CSS hover effects (cards)
        // keep working.
        clearProps: 'transform,opacity,willChange',
        scrollTrigger: {
          trigger: element,
          start: this.start(),
          once: true,
        },
      });
    }, element);

    if (this.destroyed) {
      context.revert();
      return;
    }

    this.revert = () => context.revert();
  }
}
