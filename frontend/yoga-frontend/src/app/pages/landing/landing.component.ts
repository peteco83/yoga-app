import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ContactService } from '../../services/contact.service';
import { AuthService } from '../../services/auth.service';
import { TranslateModule } from '@ngx-translate/core';
import { timeout } from 'rxjs';
import { HeroSceneComponent } from './hero-scene.component';
import { BreathSceneComponent } from './breath-scene.component';
import { ScrollRevealDirective } from '../../shared/scroll-reveal.directive';
import { loadMotion, prefersReducedMotion } from '../../shared/motion';

interface YogaStyle {
  key: string;
  image: string;
}

@Component({
  selector: 'app-landing',
  imports: [
    NgOptimizedImage,
    RouterLink,
    ReactiveFormsModule,
    TranslateModule,
    HeroSceneComponent,
    BreathSceneComponent,
    ScrollRevealDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css'],
})
export class LandingComponent {
  private fb = inject(FormBuilder);
  private contactService = inject(ContactService);
  private destroyRef = inject(DestroyRef);
  /** Drives the footer link: a logged-in admin does not need it. */
  protected readonly auth = inject(AuthService);

  private readonly pageRef = viewChild<ElementRef<HTMLElement>>('page');
  private readonly heroRef = viewChild<ElementRef<HTMLElement>>('hero');
  private readonly heroContentRef = viewChild<ElementRef<HTMLElement>>('heroContent');
  private readonly heroOverlayRef = viewChild<ElementRef<HTMLElement>>('heroOverlay');
  private readonly heroHintRef = viewChild<ElementRef<HTMLElement>>('heroHint');
  private readonly progressBarRef = viewChild<ElementRef<HTMLElement>>('progressBar');
  private readonly breathContentRef = viewChild<ElementRef<HTMLElement>>('breathContent');
  private readonly stylesGridRef = viewChild<ElementRef<HTMLElement>>('stylesGrid');
  /** The hero owns the bowl's audio; its sound toggle lives in this template. */
  protected readonly heroScene = viewChild(HeroSceneComponent);
  private readonly breathScene = viewChild(BreathSceneComponent);
  /** The `<app-breath-scene>` host element is the element ScrollTrigger pins. */
  private readonly breathRef = viewChild(BreathSceneComponent, { read: ElementRef });

  private motionCleanup: (() => void) | undefined;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      void this.initMotion();
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.motionCleanup?.();
    });
  }

  /**
   * A single GSAP context for the whole page: the pinned hero, the pinned
   * breathing orb, the reading-progress line and the card parallax. Simple
   * entrance animations live in the `appScrollReveal` directive.
   */
  private async initMotion(): Promise<void> {
    const page = this.pageRef()?.nativeElement;
    const hero = this.heroRef()?.nativeElement;
    if (!page || !hero || prefersReducedMotion()) {
      return;
    }

    const { gsap, ScrollTrigger } = await loadMotion();
    if (this.destroyed) {
      return;
    }

    const heroContent = this.heroContentRef()?.nativeElement;
    const heroOverlay = this.heroOverlayRef()?.nativeElement;
    const heroHint = this.heroHintRef()?.nativeElement;
    const progressBar = this.progressBarRef()?.nativeElement;
    const breath = this.breathRef()?.nativeElement as HTMLElement | undefined;
    const breathContent = this.breathContentRef()?.nativeElement;
    const stylesGrid = this.stylesGridRef()?.nativeElement;

    const heroScene = this.heroScene();
    const breathScene = this.breathScene();
    const heroState = { progress: 0 };
    const breathState = { progress: 0 };

    const context = gsap.context(() => {
      // --- Reading progress ------------------------------------------------
      if (progressBar) {
        gsap.fromTo(
          progressBar,
          { scaleX: 0 },
          {
            scaleX: 1,
            ease: 'none',
            scrollTrigger: {
              trigger: page,
              start: 'top top',
              end: 'bottom bottom',
              scrub: 0.3,
            },
          },
        );
      }

      // --- Hero entrance ---------------------------------------------------
      if (heroContent) {
        gsap.from(Array.from(heroContent.children), {
          y: 36,
          opacity: 0,
          duration: 1.1,
          ease: 'power3.out',
          stagger: 0.12,
          delay: 0.15,
          clearProps: 'transform,opacity',
        });
      }
      // --- Hero: pinned scroll choreography --------------------------------
      const heroTimeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: hero,
          start: 'top top',
          end: '+=120%',
          pin: true,
          scrub: 0.6,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });

      if (heroContent) {
        heroTimeline.to(heroContent, { yPercent: -18, scale: 0.94, opacity: 0, duration: 1 }, 0);
      }
      if (heroOverlay) {
        heroTimeline.to(heroOverlay, { opacity: 0.9, duration: 1 }, 0);
      }
      if (heroHint) {
        heroTimeline.to(heroHint, { opacity: 0, y: 24, duration: 0.3 }, 0);
      }
      heroTimeline.to(
        heroState,
        {
          progress: 1,
          duration: 1,
          onUpdate: () => heroScene?.setScrollProgress(heroState.progress),
        },
        0,
      );

      // --- Breathing pause: pinned particle orb ----------------------------
      if (breath) {
        const breathTimeline = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: breath,
            start: 'top top',
            end: '+=130%',
            pin: true,
            scrub: 0.7,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        if (breathContent) {
          breathTimeline.fromTo(breathContent, { y: 30 }, { y: -50, duration: 1 }, 0);
        }
        breathTimeline.to(
          breathState,
          {
            progress: 1,
            duration: 1,
            onUpdate: () => breathScene?.setScrollProgress(breathState.progress),
          },
          0,
        );
      }

      // --- Style cards: slow depth cue on the artwork ----------------------
      if (stylesGrid) {
        stylesGrid.querySelectorAll<HTMLElement>('.landing__image').forEach((image) => {
          gsap.fromTo(
            image,
            { scale: 1.1, yPercent: -3 },
            {
              scale: 1.02,
              yPercent: 3,
              ease: 'none',
              scrollTrigger: {
                trigger: image,
                start: 'top bottom',
                end: 'bottom top',
                scrub: true,
              },
            },
          );
        });
      }
    }, page);

    if (this.destroyed) {
      context.revert();
      return;
    }
    this.motionCleanup = () => context.revert();

    // Web fonts change the measured height of the pinned sections.
    if (typeof document !== 'undefined') {
      void document.fonts.ready.then(() => ScrollTrigger.refresh());
    }
  }

  // Signals, not plain fields: the component is OnPush and the app runs
  // without zone.js, so values written from the HTTP callback would only show
  // up after the next unrelated click.
  contactSent = signal(false);
  contactError = signal('');
  contactLoading = signal(false);

  contactForm = this.fb.group({
    name: ['', Validators.required],
    email: [
      '',
      [Validators.required, Validators.email, Validators.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i)],
    ],
    message: ['', Validators.required],
  });

  styles: YogaStyle[] = [
    {
      key: 'FAMILY_YOGA',
      image: '/assets/images/family-yoga.png',
    },
    {
      key: 'KIDS_STORY',
      image: '/assets/images/kids-yoga.png',
    },
    {
      key: 'KIDS_MEDITATION',
      image: '/assets/images/hero-kids-meditation.png',
    },
    {
      key: 'SOUND_BATH',
      image: '/assets/images/sound-bath.png',
    },
  ];

  readonly quoteIndices = [0, 1, 2, 3];

  submitContact() {
    if (this.contactForm.invalid) {
      this.contactForm.markAllAsTouched();
      return;
    }

    this.contactLoading.set(true);
    this.contactError.set('');

    const value = this.contactForm.value;
    this.contactService
      .submit({
        name: value.name!,
        email: value.email!,
        message: value.message!,
      })
      .pipe(timeout(15000))
      .subscribe({
        next: () => {
          this.contactSent.set(true);
          this.contactLoading.set(false);
          this.contactForm.reset();
        },
        error: (err) => {
          // If your backend sends a generic error, we can translate that too!
          this.contactError.set(err?.error?.error || 'LANDING.CONTACT_ERROR');
          this.contactLoading.set(false);
        },
      });
  }
}
