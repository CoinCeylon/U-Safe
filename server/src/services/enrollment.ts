import type Database from 'better-sqlite3';
import type { EnrollmentLedger, EnrollmentReceipt } from './ledger.js';
import type { TicketService } from './tickets.js';
import { getUniversity } from './universities.js';

export interface EnrollResult extends EnrollmentReceipt {
  communityKeyWrapped: string | null;
}

export class EnrollmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrollmentError';
  }
}

interface CountRow {
  count: number;
}

interface RosterStateRow {
  enrolled_at: string | null;
}

export class EnrollmentService {
  constructor(
    private readonly db: Database.Database,
    private readonly tickets: TicketService,
    private readonly ledger: EnrollmentLedger,
  ) {}

  enroll(ticket: string, commitment: string): EnrollResult {
    return this.db.transaction(() => {
      const details = this.tickets.consume(ticket);
      if (details === null) {
        throw new EnrollmentError('invalid ticket');
      }

      const university = getUniversity(this.db, details.universityId);
      if (university === null) {
        throw new EnrollmentError('invalid ticket');
      }

      const rosterRow = this.db
        .prepare('SELECT enrolled_at FROM roster WHERE id = ?')
        .get(details.rosterId) as RosterStateRow | undefined;
      if (rosterRow === undefined || rosterRow.enrolled_at !== null) {
        throw new EnrollmentError('invalid ticket');
      }

      const enrolled = this.db
        .prepare(
          'SELECT COUNT(*) AS count FROM roster WHERE university_id = ? AND enrolled_at IS NOT NULL',
        )
        .get(details.universityId) as CountRow;
      if (enrolled.count >= university.enrollment_ceiling) {
        throw new EnrollmentError('ceiling reached');
      }

      const receipt = this.ledger.enrollCommitment(details.universityId, commitment);
      this.db
        .prepare('UPDATE roster SET enrolled_at = ? WHERE id = ?')
        .run(new Date().toISOString(), details.rosterId);

      return {
        ...receipt,
        communityKeyWrapped: university.community_key_wrapped_for_ugc,
      };
    })();
  }
}
