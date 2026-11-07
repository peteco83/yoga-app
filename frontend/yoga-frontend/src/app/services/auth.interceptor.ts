import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);
  const authService = inject(AuthService);

  // 1. Only run this logic in the browser
  if (!isPlatformBrowser(platformId)) {
    return next(req);
  }

  // 2. Get the token from our AuthService signal
  const token = authService.token();

  // 3. If a token exists, clone the request and add the header
  if (token) {
    const authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
    return next(authReq);
  }

  // 4. If no token, just send the original request
  return next(req);
};