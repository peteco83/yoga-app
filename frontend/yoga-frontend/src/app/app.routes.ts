import { Routes } from '@angular/router';
import { LandingComponent } from './pages/landing/landing.component';
import { LoginComponent } from './pages/login/login.component';
import { MembersComponent } from './pages/members/members.component';
import { ContactAdminComponent } from './pages/contact-admin/contact-admin.component';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: LandingComponent },
  { path: 'login', component: LoginComponent },
  { path: 'admin', component: MembersComponent, canActivate: [authGuard] },
  { path: 'admin/messages', component: ContactAdminComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
