import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  form = this.fb.group({
    username: ['admin', Validators.required],
    password: ['', Validators.required],
  });

  // Signals, not plain fields: the app runs without zone.js, so a value written
  // from the HTTP callback would not schedule a render (the message only showed
  // up after the visitor happened to click somewhere else).
  error = signal<string | undefined>(undefined);
  showPassword = signal(false);

  togglePassword() {
    this.showPassword.update((visible) => !visible);
  }

  submit() {
    if (this.form.invalid) {
      return;
    }

    this.error.set(undefined);

    const { username, password } = this.form.value;
    this.auth.login(username!, password!).subscribe({
      next: () => this.router.navigate(['/admin']),
      error: (err) => {
        this.error.set(
          err?.status === 401
            ? 'Invalid username or password.'
            : 'Unable to log in. Please try again.',
        );
      },
    });
  }
}
