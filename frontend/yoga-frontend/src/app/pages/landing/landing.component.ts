import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ContactService } from '../../services/contact.service';
import { TranslateModule } from '@ngx-translate/core';
import { timeout } from 'rxjs';

interface YogaStyle {
  key: string;
  image: string;
}

@Component({
  selector: 'app-landing',
  imports: [NgOptimizedImage, RouterLink, ReactiveFormsModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css'],
})
export class LandingComponent {
  private fb = inject(FormBuilder);
  private contactService = inject(ContactService);

  contactSent = false;
  contactError?: string;
  contactLoading = false;

  contactForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email, Validators.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i)]],
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

    this.contactLoading = true;
    this.contactError = undefined;

    const value = this.contactForm.value;
    this.contactService.submit({
      name: value.name!,
      email: value.email!,
      message: value.message!,
    }).pipe(timeout(15000)).subscribe({
      next: () => {
        this.contactSent = true;
        this.contactLoading = false;
        this.contactForm.reset();
      },
      error: (err) => {
        // If your backend sends a generic error, we can translate that too!
        this.contactError = err?.error?.error || 'LANDING.CONTACT_ERROR';
        this.contactLoading = false;
      },
    });
  }
}
