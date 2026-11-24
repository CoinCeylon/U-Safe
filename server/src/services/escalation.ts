import type Database from 'better-sqlite3';
import { publish } from './events.js';

/**
 * One pass of the escalation job. Finds every complaint with status `not_started`
 * whose `deadline_at` has passed and `escalated = 0`, marks it escalated, appends
 * a history row (actor `system`) and publishes a `complaint.escalated` event.
 *
 * Idempotent: only rows that are still `not_started` and `escalated = 0` are
 * touched, so calling this repeatedly is safe.
 */
export const runEscalationJob = (db: Database.Database): void => {
  const now = new Date().toISOString();

  const overdue = db
    .prepare(
      `SELECT id FROM ml_complaints
       WHERE status = 'not_started'
         AND escalated = 0
         AND deadline_at <= ?`,
    )
    .all(now) as Array<{ id: string }>;

  for (const { id } of overdue) {
    const transaction = db.transaction(() => {
      db.prepare(
        `UPDATE ml_complaints SET escalated = 1, last_updated_at = ? WHERE id = ?`,
      ).run(now, id);
      db.prepare(
        `INSERT INTO ml_history (complaint_id, status, at, actor_role, note_hash)
         VALUES (?, 'not_started', ?, 'system', NULL)`,
      ).run(id, now);
    });
    transaction();

    try {
      publish({ type: 'complaint.escalated', id });
    } catch {
      // Event delivery failures must not fail the job.
    }
  }
};

/**
 * Starts the escalation background job. Runs once immediately at startup, then
 * every 10 seconds. Returns the interval handle so the caller can stop it.
 */
export const startEscalationJob = (db: Database.Database): NodeJS.Timeout => {
  runEscalationJob(db);
  return setInterval(() => runEscalationJob(db), 10_000);
};

/**
 * Stops the escalation background job.
 */
export const stopEscalationJob = (handle: NodeJS.Timeout): void => {
  clearInterval(handle);
};
