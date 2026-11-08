import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ContactMessage, ContactService } from '../../services/contact.service';
import { TranslateModule } from '@ngx-translate/core'; // Add for translations

@Component({
  selector: 'app-contact-admin',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  templateUrl: './contact-admin.component.html',
  styleUrls: ['./contact-admin.component.css'],
})
export class ContactAdminComponent implements OnInit {
  private contactService = inject(ContactService);
  private auth = inject(AuthService);
  private router = inject(Router);

  contactMessages = signal<ContactMessage[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  assignee = signal('');

  get messageList() {
    return this.contactMessages() ?? [];
  }

  ngOnInit() {
    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadMessages();
  }

  loadMessages() {
    this.loading.set(true);
    this.error.set(null);
    this.contactService.list().subscribe({
      next: (messages) => this.contactMessages.set(messages ?? []),
      error: (err) => this.error.set(err?.error?.error || 'Could not load contact messages'),
      complete: () => this.loading.set(false),
    });
  }

  markRead(msg: ContactMessage) {
    this.contactService.markRead(msg.id).subscribe({
      next: () => this.loadMessages(),
      error: (err) => console.warn('Could not mark as read', err),
    });
  }

  markUnread(msg: ContactMessage) {
    this.contactService.markUnread(msg.id).subscribe({
      next: () => this.loadMessages(),
      error: (err) => console.warn('Could not mark as unread', err),
    });
  }

  assign(msg: ContactMessage) {
    const assignee = window.prompt('Assign message to', msg.assignee || '');
    if (!assignee) {
      return;
    }

    this.contactService.assign(msg.id, assignee).subscribe({
      next: () => this.loadMessages(),
      error: (err) => console.warn('Could not assign message', err),
    });
  }

  delete(msg: ContactMessage) {
    if (!confirm(`Delete message from ${msg.name}?`)) return;
    this.contactService.delete(msg.id).subscribe({
      next: () => this.loadMessages(),
      error: (err) => console.warn('Could not delete message', err),
    });
  }

  mailtoLink(email: string, name: string, message: string): string {
    const subject = encodeURIComponent(`Re: your Yoga Studio inquiry`);
    const body = encodeURIComponent(
      `Hi ${name},\n\nThanks for reaching out!\n\nYour message:\n${message}\n\n[Add your reply here]\n\nBest regards,\nYoga Studio Team`,
    );
    return `mailto:${email}?subject=${subject}&body=${body}`;
  }
}
