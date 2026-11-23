import { randomBytes } from 'node:crypto';
import { ENROLLMENT_TICKET_EXPIRY_MINUTES } from '@usafe/shared';
import type Database from 'better-sqlite3';
import { emailHash } from './roster.js';

export interface IssuedTicket {
  ticket: string;
  universityId: string;
}

export interface TicketDetails {
  universityId: string;
  rosterId: number;
}

interface RosterRow {
  id: number;
  university_id: string;
}

interface TicketRow {
  university_id: string;
  roster_id: number;
}

export class TicketService {
  constructor(
    private readonly db: Database.Database,
    private readonly salt: string,
  ) {}

  issue(email: string, now: number = Date.now()): IssuedTicket | null {
    const row = this.db
      .prepare('SELECT id, university_id FROM roster WHERE email_hash = ? AND enrolled_at IS NULL')
      .get(emailHash(this.salt, email)) as RosterRow | undefined;
    if (row === undefined) {
      return null;
    }

    const ticket = randomBytes(24).toString('hex');
    const expiresAt = new Date(
      now + ENROLLMENT_TICKET_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString();
    this.db
      .prepare(
        'INSERT INTO tickets (id, university_id, roster_id, used, expires_at) VALUES (?, ?, ?, 0, ?)',
      )
      .run(ticket, row.university_id, row.id, expiresAt);

    return { ticket, universityId: row.university_id };
  }

  consume(ticket: string, now: number = Date.now()): TicketDetails | null {
    const result = this.db
      .prepare('UPDATE tickets SET used = 1 WHERE id = ? AND used = 0 AND expires_at > ?')
      .run(ticket, new Date(now).toISOString());
    if (result.changes === 0) {
      return null;
    }

    const row = this.db
      .prepare('SELECT university_id, roster_id FROM tickets WHERE id = ?')
      .get(ticket) as TicketRow | undefined;
    if (row === undefined) {
      return null;
    }
    return { universityId: row.university_id, rosterId: row.roster_id };
  }
}
