import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { emailHash } from './roster.js';
import { TicketService } from './tickets.js';

const salt = 'test-salt';
const email = 'student@uni.edu';
const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

let db: Database.Database;
let tickets: TicketService;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db, migrationsDir);
  db.prepare(
    "INSERT INTO universities (id, name, domain, enrollment_ceiling, status) VALUES ('u1', 'Uni', 'uni.edu', 100, 'active')",
  ).run();
  db.prepare('INSERT INTO roster (university_id, email_hash) VALUES (?, ?)').run(
    'u1',
    emailHash(salt, email),
  );
  tickets = new TicketService(db, salt);
});

afterEach(() => {
  db?.close();
});

describe('TicketService.issue', () => {
  it('creates a random, unused ticket with a 15-minute expiry', () => {
    const issued = tickets.issue(email);
    const id = issued?.ticket ?? '';
    expect(issued?.universityId).toBe('u1');
    expect(id).toMatch(/^[a-f0-9]{48}$/);

    const row = db
      .prepare('SELECT university_id, roster_id, used, expires_at FROM tickets WHERE id = ?')
      .get(id) as {
      university_id: string;
      roster_id: number;
      used: number;
      expires_at: string;
    };
    expect(row.university_id).toBe('u1');
    expect(row.roster_id).toBe(1);
    expect(row.used).toBe(0);
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(Date.parse(row.expires_at)).toBeLessThan(Date.now() + 16 * 60 * 1000);
  });

  it('returns null for unknown and already enrolled emails', () => {
    expect(tickets.issue('other@uni.edu')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM tickets').get()).toEqual({ count: 0 });

    db.prepare('UPDATE roster SET enrolled_at = ? WHERE email_hash = ?').run(
      new Date().toISOString(),
      emailHash(salt, email),
    );
    expect(tickets.issue(email)).toBeNull();
  });
});

describe('TicketService.consume', () => {
  it('burns a ticket once and returns its enrollment details', () => {
    const id = tickets.issue(email)?.ticket ?? '';
    expect(tickets.consume(id)).toEqual({ universityId: 'u1', rosterId: 1 });
    expect(tickets.consume(id)).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const id = tickets.issue(email)?.ticket ?? '';
    db.prepare('UPDATE tickets SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      id,
    );
    expect(tickets.consume(id)).toBeNull();
  });

  it('rejects an unknown ticket', () => {
    expect(tickets.consume('missing')).toBeNull();
  });
});
