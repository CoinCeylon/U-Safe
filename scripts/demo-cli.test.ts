import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../server/src/db/migrate.js';
import { runDemoFlow } from './demo-cli.js';

const migrationsDir = fileURLToPath(
  new URL('../server/migrations', import.meta.url),
);

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db, migrationsDir);
  db.prepare(
    `INSERT INTO universities (id, name, domain, enrollment_ceiling, status)
     VALUES ('demo-university', 'Demo University', 'demo.ac.lk', 100, 'active')`,
  ).run();
});

afterEach(() => {
  db.close();
});

describe('runDemoFlow', () => {
  it('enrolls five students, files, supports four times and finishes', async () => {
    const record = await runDemoFlow(db, 'demo-university');

    expect(record.supportCount).toBe(4);
    expect(record.status).toBe('finished');
    expect(record.outcomeHash).toMatch(/^[a-f0-9]{64}$/);

    const enrollments = db
      .prepare(
        'SELECT COUNT(*) AS count FROM ml_leaves WHERE university_id = ?',
      )
      .get('demo-university') as { count: number };
    expect(enrollments.count).toBe(5);

    const history = db
      .prepare(
        `SELECT status FROM ml_history WHERE complaint_id = ? ORDER BY at ASC`,
      )
      .all(record.id) as Array<{ status: string }>;
    expect(history.map((entry) => entry.status)).toEqual([
      'not_started',
      'pending_investigation',
      'finished',
    ]);
  });

  it('supports --no-status by leaving the complaint not started', async () => {
    const record = await runDemoFlow(db, 'demo-university', {
      noStatus: true,
    });

    expect(record.supportCount).toBe(4);
    expect(record.status).toBe('not_started');
  });

  it('works when the university already has enrolled leaves', async () => {
    const first = await runDemoFlow(db, 'demo-university');
    const second = await runDemoFlow(db, 'demo-university');

    expect(first.supportCount).toBe(4);
    expect(first.status).toBe('finished');
    expect(second.supportCount).toBe(4);
    expect(second.status).toBe('finished');

    const enrollments = db
      .prepare(
        'SELECT COUNT(*) AS count FROM ml_leaves WHERE university_id = ?',
      )
      .get('demo-university') as { count: number };
    expect(enrollments.count).toBe(10);
  });
});
