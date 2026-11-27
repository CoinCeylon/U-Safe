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
    // Phase 1: compute the leaf index/path/root without writing. This is the
    // only asynchronous part (Merkle hashing); the real transaction below
    // stays fully synchronous.
    const peeked = this.peekTicket(ticket);
    let prepared: { receipt: EnrollmentReceipt; commit: () => void } | null =
      null;
    if (peeked !== null && typeof this.ledger.prepareEnrollment === 'function') {
      try {
        prepared = await this.ledger.prepareEnrollment({
          universityId: peeked.universityId,
          commitment,
        });
      } catch (error) {
        throw new EnrollmentError(
          error instanceof Error ? error.message : 'enrollment failed',
        );
      }
    }

    // Phase 2: burn the ticket, check the ceiling, mark the roster row and
    // write the leaf/root in one SQLite transaction. Any failure rolls all of
    // them back, including the ticket burn.
    const transaction = this.db.transaction(() => {
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

      prepared?.commit();

      this.db
        .prepare('UPDATE roster SET enrolled_at = ? WHERE id = ?')
        .run(new Date().toISOString(), details.rosterId);

      return {
        wrappedForDelivery: university.community_key_wrapped_for_delivery,
      };
    });

    try {
      const { wrappedForDelivery } = transaction();
      const receipt: EnrollmentReceipt =
        prepared?.receipt ??
        (await this.ledger.enrollCommitment({
          universityId: peeked?.universityId ?? '',
          commitment,
        }));
      // M065: hand the raw community key to the new student (unwrapped from
      // the server-side delivery copy). Done after the commit succeeded.
      const communityKey = await unwrapForDelivery(
        wrappedForDelivery,
        this.communityDeliverySecret,
      );
      return { ...receipt, communityKey };
    } catch (error) {
      if (error instanceof EnrollmentError) {
        throw error;
      }
      throw new EnrollmentError(
        error instanceof Error ? error.message : 'enrollment failed',
      );
    }
  }

  /**
   * Reads a still-usable ticket without consuming it, so the ledger can be
   * prepared before the transactional burn. Reused, expired or unknown
   * tickets return null; the transaction then fails with 'invalid ticket'.
   */
  private peekTicket(ticket: string): {
    universityId: string;
    rosterId: number;
  } | null {
    const row = this.db
      .prepare(
        `SELECT university_id, roster_id, used, expires_at
         FROM tickets WHERE id = ?`,
      )
      .get(ticket) as
      | {
          university_id: string;
          roster_id: number;
          used: number;
          expires_at: string;
        }
      | undefined;
    if (
      row === undefined ||
      row.used !== 0 ||
      row.expires_at <= new Date().toISOString()
    ) {
      return null;
    }
    return { universityId: row.university_id, rosterId: Number(row.roster_id) };
  }
}