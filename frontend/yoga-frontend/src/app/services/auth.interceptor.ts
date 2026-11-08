import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** The one endpoint that must never carry a token with it. */
const LOGIN_URL = '/api/login';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);
  const authService = inject(AuthService);
  const router = inject(Router);

  // 1. Only run this logic in the browser
  if (!isPlatformBrowser(platformId)) {
    return next(req);
  }

  // 2. Login is the only request that goes out without a token: a stale one
  //    would make a wrong password look like an expired session.
  const token = req.url === LOGIN_URL ? null : authService.token();

  // 3. If a token exists, clone the request and add the header
  const authReq = token
    ? req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      })
    : req;

  // 4. Send it, and watch for a token the API turns down.
  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // The guard only checks that a token exists, so an expired or revoked one
      // would keep the admin pages open and stuck on empty lists: drop it and
      // ask for a fresh login instead.
      if (error.status === 401 && token) {
        authService.logout();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
