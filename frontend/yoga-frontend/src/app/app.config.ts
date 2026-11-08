import { ApplicationConfig, PLATFORM_ID, inject } from '@angular/core';
import { HttpClient, provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of } from 'rxjs';
import { authInterceptor } from './services/auth.interceptor'; // IMPORT IT HERE

export class ServerTranslateLoader implements TranslateLoader {
  getTranslation(): Observable<any> {
    return of({});
  }
}

export function HttpLoaderFactory() {
  const http = inject(HttpClient);
  return new TranslateHttpLoader(http, '/assets/i18n/', '.json');
}

export const appConfig: ApplicationConfig = {
  providers: [
    // REGISTER THE INTERCEPTOR HERE
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),

    provideTranslateService({
      defaultLanguage: 'en',
      loader: {
        provide: TranslateLoader,
        useFactory: () => {
          const platformId = inject(PLATFORM_ID);
          if (isPlatformBrowser(platformId)) {
            return HttpLoaderFactory();
          } else {
            return new ServerTranslateLoader();
          }
        },
      },
    }),
  ],
};
