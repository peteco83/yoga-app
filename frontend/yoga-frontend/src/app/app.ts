import { Component, DestroyRef, OnInit, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from './services/auth.service';
import { fromEvent } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
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

      fromEvent(window, 'scroll').pipe(
        startWith(null),
        map(() => window.scrollY > 50),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe((isScrolled) => this.scrolled.set(isScrolled));
    }
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
