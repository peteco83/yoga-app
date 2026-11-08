import { inject, Injectable, signal, computed, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';

interface LoginResponse {
  token: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly storageKey = 'yoga_app_token';
  private readonly http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);

  // The source of truth is a private signal
  private currentUserToken = signal<string | null>(this.getInitialToken());

  // These are read-only reactive signals for the UI
  public isLoggedIn = computed(() => !!this.currentUserToken());
  public token = computed(() => this.currentUserToken());

  private getInitialToken(): string | null {
    if (isPlatformBrowser(this.platformId)) {
      return localStorage.getItem(this.storageKey);
    }
    return null;
  }

  login(username: string, password: string) {
    return this.http.post<LoginResponse>('/api/login', { username, password }).pipe(
      tap((res) => {
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem(this.storageKey, res.token);
          this.currentUserToken.set(res.token);
        }
      }),
    );
  }

  logout() {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(this.storageKey);
    }
    this.currentUserToken.set(null);
  }
}
