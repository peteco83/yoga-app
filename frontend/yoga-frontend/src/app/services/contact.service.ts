import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';

export interface ContactRequest {
  name: string;
  email: string;
  message: string;
}

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  message: string;
  status: 'unread' | 'read';
  assignee?: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class ContactService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly baseUrl = '/api/contact';

  private headers() {
    const token = this.auth.token;
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
  }

  submit(request: ContactRequest) {
    return this.http.post(this.baseUrl, request);
  }

  list() {
    return this.http.get<ContactMessage[]>(`${this.baseUrl}-messages`, { headers: this.headers() });
  }

  delete(id: number) {
    return this.http.delete(`${this.baseUrl}-messages/${id}`, { headers: this.headers() });
  }

  markRead(id: number) {
    return this.http.put(`${this.baseUrl}-messages/${id}/read`, null, { headers: this.headers() });
  }

  markUnread(id: number) {
    return this.http.put(`${this.baseUrl}-messages/${id}/unread`, null, { headers: this.headers() });
  }

  assign(id: number, assignee: string) {
    return this.http.patch(`${this.baseUrl}-messages/${id}/assign`, { assignee }, { headers: this.headers() });
  }
}
