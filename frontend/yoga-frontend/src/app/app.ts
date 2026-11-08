import { Component, DestroyRef, OnInit, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from './services/auth.service';
import { prefersReducedMotion } from './shared/motion';
import { fromEvent } from 'rxjs';
import { filter, map, startWith, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements OnInit {
  private router = inject(Router);
  private translate = inject(TranslateService);
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);
  public auth = inject(AuthService);

  scrolled = signal(false);
  currentLang = signal('en');

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      // 1. Determine language
      const savedLang = localStorage.getItem('userLang');
      const browserLang = this.translate.getBrowserLang();
      const finalLang = savedLang || (browserLang?.match(/en|es|de/) ? browserLang : 'en');

      // 2. Load the language file (only happens in browser)
      this.switchLanguage(finalLang);

      fromEvent(window, 'scroll')
        .pipe(
          startWith(null),
          map(() => window.scrollY > 50),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((isScrolled) => this.scrolled.set(isScrolled));
    }
  }

  /**
   * The brand always links to "/" and the landing page is the only entry point,
   * so a click on it should leave the visitor at the very top of the page.
   * From another route the routerLink navigation runs first, hence the wait for
   * NavigationEnd: the landing page rebuilds its ScrollTrigger pins while it
   * renders and its height is only final afterwards.
   */
  scrollToTop() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // `scroll-behavior: smooth` is global, so ask for `instant` when the
    // visitor prefers reduced motion instead of jumping through the whole page.
    const toTop = () =>
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });

    if (this.router.url === '/') {
      toTop();
      return;
    }

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => toTop());
  }

  switchLanguage(lang: string) {
    this.translate.use(lang);
    this.currentLang.set(lang);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('userLang', lang);
    }
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
