import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './services/auth.service';

/**
 * `isLoggedIn` is a computed signal, i.e. a function: testing the signal itself
 * (`!auth.isLoggedIn`) was always false, so every admin route stayed open.
 * A functional guard also returns a `UrlTree` instead of calling `navigate()`,
 * which lets the router cancel the current navigation and redirect in one step.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isLoggedIn() ? true : router.createUrlTree(['/login']);
};
