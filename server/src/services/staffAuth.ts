import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OwnerRole } from '@usafe/shared';
import { checkSignature } from '@meshsdk/core';

export interface StaffAccount {
  id: number;
  university_id: string | null;
  role: string;
  address: string;
  public_key_jwk: string | null;
}

export interface StaffSession {
  token: string;
  staff: StaffAccount;
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffAccount;
  }
}

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const staffOwnerRole = (staff: StaffAccount): OwnerRole => {
  if (staff.university_id === null) {
    return 'ugc';
  }
  return 'university';
};

const rowToStaff = (row: Record<string, unknown>): StaffAccount => ({
  id: Number(row.id),
  university_id: typeof row.university_id === 'string' ? row.university_id : null,
  role: String(row.role),
  address: String(row.address),
  public_key_jwk: typeof row.public_key_jwk === 'string' ? row.public_key_jwk : null,
});

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Single-use login challenges. Kept in memory only: a challenge must never be
// persisted or logged, and it expires after CHALLENGE_TTL_MS.
const challenges = new Map<string, number>();

const pruneChallenges = (now: number): void => {
  for (const [nonce, expiresAt] of challenges) {
    if (expiresAt <= now) {
      challenges.delete(nonce);
    }
  }
};

export const createChallenge = (): string => randomBytes(16).toString('hex');

/** Generates and stores a single-use challenge nonce. */
export const issueChallenge = (): string => {
  const now = Date.now();
  pruneChallenges(now);
  const nonce = createChallenge();
  challenges.set(nonce, now + CHALLENGE_TTL_MS);
  return nonce;
};

/**
 * Checks and consumes a challenge nonce. A nonce works at most once and only
 * while it is unexpired, so a captured signature cannot be replayed.
 */
export const consumeChallenge = (nonce: string): boolean => {
  const expiresAt = challenges.get(nonce);
  if (expiresAt === undefined) {
    return false;
  }
  challenges.delete(nonce);
  return expiresAt > Date.now();
};

/** Test hook: drops every outstanding challenge. */
export const clearChallenges = (): void => {
  challenges.clear();
};

export const findStaffByAddress = (
  db: Database.Database,
  address: string,
): StaffAccount | null => {
  const row = db
    .prepare('SELECT * FROM staff WHERE address = ?')
    .get(address) as Record<string, unknown> | undefined;
  if (row === undefined) {
    return null;
  }
  return rowToStaff(row);
};

export const issueSession = (db: Database.Database, staffId: number): string => {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)',
  ).run(tokenHash, staffId, expiresAt);
  return token;
};

export const verifySession = (
  db: Database.Database,
  token: string,
): StaffAccount | null => {
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.role, s.id, s.university_id, s.address, s.public_key_jwk
       FROM sessions sess JOIN staff s ON s.id = sess.staff_id
       WHERE sess.token_hash = ? AND sess.expires_at > ?`,
    )
    .get(tokenHash, new Date().toISOString()) as Record<string, unknown> | undefined;
  if (row === undefined) {
    return null;
  }
  return rowToStaff(row);
};

export const loginWithSignature = async (
  db: Database.Database,
  input: {
    address: string;
    signature?: string;
    key?: string;
    nonce?: string;
  },
): Promise<string | null> => {
  const staff = findStaffByAddress(db, input.address);
  if (staff === null) {
    return null;
  }
  if (typeof input.signature !== 'string' || input.signature.length === 0) {
    return null;
  }
  if (typeof input.key !== 'string' || input.key.length === 0) {
    return null;
  }
  if (typeof input.nonce !== 'string' || input.nonce.length === 0) {
    return null;
  }

  // The nonce must be one we issued and must not have been used already.
  if (!consumeChallenge(input.nonce)) {
    return null;
  }

  try {
    // Real CIP-8 verification through Mesh's checkSignature: it checks the
    // COSE_Sign1 signature over the challenge and that the signing key
    // belongs to the staff wallet address.
    const valid = await checkSignature(
      input.nonce,
      { key: input.key, signature: input.signature },
      staff.address,
    );
    if (!valid) {
      return null;
    }
  } catch {
    return null;
  }

  return issueSession(db, staff.id);
};

export const devLogin = (
  db: Database.Database,
  options: { role?: string; universityId?: string | null } = {},
): string => {
  const role = options.role ?? 'admin';
  const universityId = options.universityId ?? null;

  let staff = db
    .prepare('SELECT * FROM staff WHERE role = ? LIMIT 1')
    .get(role) as Record<string, unknown> | undefined;

  if (staff === undefined) {
    const address = `dev-${role}`;
    db.prepare(
      `INSERT INTO staff (university_id, role, address, public_key_jwk)
       VALUES (?, ?, ?, NULL)`,
    ).run(universityId, role, address);
    staff = db
      .prepare('SELECT * FROM staff WHERE address = ?')
      .get(address) as Record<string, unknown>;
  }

  return issueSession(db, Number(staff.id));
};

const isDatabase = (value: unknown): value is Database.Database => {
  return typeof value === 'object' && value !== null && 'prepare' in value;
};

export const requireStaff = (
  roleOrDb?: string | string[] | Database.Database,
  role?: string | string[],
) => {
  const db = isDatabase(roleOrDb) ? roleOrDb : null;
  const required = isDatabase(roleOrDb) ? role : roleOrDb;
  const requiredRoles: string[] | undefined =
    required === undefined
      ? undefined
      : Array.isArray(required)
        ? required
        : [required];

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const database = db ?? (request.server as unknown as { db?: Database.Database }).db;
    if (database === undefined) {
      reply.code(500).send({ error: 'staff auth not configured' });
      return;
    }

    const header = request.headers.authorization;
    const auth = typeof header === 'string' ? header : '';
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    const token = match?.[1];
    if (token === undefined) {
      reply.code(401).send({ error: 'missing token' });
      return;
    }

    const staff = verifySession(database, token);
    if (staff === null) {
      reply.code(401).send({ error: 'invalid token' });
      return;
    }
    if (requiredRoles !== undefined && !requiredRoles.includes(staff.role)) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }
    request.staff = staff;
  };
};

export { requireStaff as requireStaffHook };
