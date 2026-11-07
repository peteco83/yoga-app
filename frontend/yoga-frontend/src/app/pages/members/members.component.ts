import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Member, MemberService } from '../../services/member.service';
import { AuthService } from '../../services/auth.service';
import { ContactMessage, ContactService } from '../../services/contact.service';

@Component({
  selector: 'app-members',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './members.component.html',
  styleUrls: ['./members.component.css'],
})
export class MembersComponent implements OnInit {
  private fb = inject(FormBuilder);
  private service = inject(MemberService);
  private auth = inject(AuthService);
  private router = inject(Router);

  members = signal<Member[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  editing = signal<Member | null>(null);

  get memberList() {
    return this.members() ?? [];
  }

  private contactValidator(control: AbstractControl): ValidationErrors | null {
    const email = String(control.get('email')?.value ?? '').trim();
    const phone = String(control.get('phone')?.value ?? '').trim();
    return email || phone ? null : { contactRequired: true };
  }

  form = this.fb.group({
    name: ['', Validators.required],
    email: ['', Validators.email],
    phone: ['', Validators.pattern(/^[\d\s\-\+\(\)]*$/)],
    notes: [''],
    join_date: ['', Validators.required],
  }, { validators: (control) => this.contactValidator(control) });

  ngOnInit() {
    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login']);
      return;
    }
    this.refresh();
  }

  refresh() {
    this.loading.set(true);
    this.error.set(null);

    this.service.list().subscribe({
      next: (list) => this.members.set(list ?? []),
      error: (err) => this.error.set(err?.error?.error || 'Could not load members'),
      complete: () => this.loading.set(false),
    });
  }

  startEdit(member: Member) {
    this.editing.set(member);
    this.form.setValue({
      name: member.name,
      email: member.email,
      phone: member.phone || '',
      notes: member.notes || '',
      join_date: member.join_date?.slice(0, 10) ?? '',
    });
  }

  clearForm() {
    this.editing.set(null);
    this.form.reset({ name: '', email: '', phone: '', notes: '', join_date: '' });
    this.error.set(null);
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Please complete the required fields and provide an email or phone number.');
      return;
    }

    const payload: Partial<Member> = {
      name: this.form.value.name ?? '',
      email: this.form.value.email ?? '',
      phone: this.form.value.phone ?? '',
      notes: this.form.value.notes ?? '',
      join_date: this.form.value.join_date ?? '',
    };

    const request = this.editing() ?
      this.service.update(this.editing()!.id, payload) :
      this.service.create(payload);

    request.subscribe({
      next: () => {
        this.clearForm();
        this.refresh();
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'Unable to save member');
      },
    });
  }

  delete(member: Member) {
    if (!confirm(`Delete member ${member.name}?`)) return;
    this.service.delete(member.id).subscribe({
      next: () => this.refresh(),
      error: (err) => this.error.set(err?.error?.error || 'Unable to delete member'),
    });
  }

  mailtoLink(email: string, name: string, message: string): string {
    const subject = encodeURIComponent(`Re: your Yoga Studio inquiry`);
    const body = encodeURIComponent(`Hi ${name},\n\nThanks for reaching out!\n\nYour message:\n${message}\n\n[Add your reply here]\n\nBest regards,\nYoga Studio Team`);
    return `mailto:${email}?subject=${subject}&body=${body}`;
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
