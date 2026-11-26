import type Database from 'better-sqlite3';
import type { EnrollmentLedger, EnrollmentReceipt } from './ledger.js';
import type { TicketService } from './tickets.js';
import { getUniversity } from './universities.js';
import { unwrapForDelivery } from './communityKeys.js';

export interface EnrollResult extends EnrollmentReceipt {
  /** Raw 32-byte AES community key, base64, for the newly enrolled student. */
  communityKey: string | null;
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
    private readonly communityDeliverySecret?: string,
  ) {}

  async enroll(ticket: string, commitment: string): Promise<EnrollResult> {
    const prepared = this.db.transaction(() => {
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

      return {
        details,
        wrappedForDelivery: university.community_key_wrapped_for_delivery,
      };
    });
    const { details, wrappedForDelivery } = prepared();

    let receipt: EnrollmentReceipt;
    try {
      receipt = await this.ledger.enrollCommitment({
        universityId: details.universityId,
        commitment,
      });
    } catch (error) {
      this.db
        .prepare('UPDATE tickets SET used = 0 WHERE id = ? AND used = 1')
        .run(ticket);
      throw new EnrollmentError(
        error instanceof Error ? error.message : 'enrollment failed',
      );
    }

    this.db
      .prepare('UPDATE roster SET enrolled_at = ? WHERE id = ?')
      .run(new Date().toISOString(), details.rosterId);

    const communityKey = await unwrapForDelivery(
      wrappedForDelivery,
      this.communityDeliverySecret,
    );

    return {
      ...receipt,
      communityKey,
    };
  }
}
