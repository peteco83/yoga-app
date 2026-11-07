import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';

export interface Member {
  id: number;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  notes_updated_at?: string;
  join_date: string;
  created_at: string;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class MemberService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly baseUrl = '/api/members';

  private headers() {
    const token = this.auth.token;
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
  }

  list() {
    return this.http.get<Member[]>(this.baseUrl, { headers: this.headers() });
  }

  create(member: Partial<Member>) {
    return this.http.post(this.baseUrl, member, { headers: this.headers() });
  }

  update(id: number, member: Partial<Member>) {
    return this.http.put(`${this.baseUrl}/${id}`, member, { headers: this.headers() });
  }

  delete(id: number) {
    return this.http.delete(`${this.baseUrl}/${id}`, { headers: this.headers() });
  }
}
