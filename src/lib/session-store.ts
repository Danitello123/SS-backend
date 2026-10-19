import { randomUUID } from "crypto";

export interface AuthSession {
  id: string;
  wallet: string;
  device: string;
  ip: string;
  createdAt: Date;
}

/** Tracks active login sessions per wallet so they can be listed and revoked. */
export class SessionStore {
  private readonly sessions = new Map<string, AuthSession>();

  create(wallet: string, device: string, ip: string): AuthSession {
    const session = { id: randomUUID(), wallet, device, ip, createdAt: new Date() };
    this.sessions.set(session.id, session);
    return session;
  }

  list(wallet: string): AuthSession[] {
    return [...this.sessions.values()].filter((session) => session.wallet === wallet);
  }

  revoke(wallet: string, id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.wallet !== wallet) return false;
    return this.sessions.delete(id);
  }

  revokeAll(wallet: string): number {
    const owned = this.list(wallet);
    owned.forEach((session) => this.sessions.delete(session.id));
    return owned.length;
  }

  isActive(id: string): boolean {
    return this.sessions.has(id);
  }
}
