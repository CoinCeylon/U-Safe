import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyReply, FastifyRequest } from 'fastify';

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

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

const rowToStaff = (row: Record<string, unknown>): StaffAccount => ({
  id: Number(row.id),
  university_id: typeof row.university_id === 'string' ? row.university_id : null,
  role: String(row.role),
  address: String(row.address),
  public_key_jwk: typeof row.public_key_jwk === 'string' ? row.public_key_jwk : null,
});

export const createChallenge = (): string => randomBytes(16).toString('hex');

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

export const loginWithSignature = (
  db: Database.Database,
  input: {
    address: string;
    signature?: string;
    key?: string;
  },
): string | null => {
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
  // Mock/dev verification: real CIP-8 signature verification is added with the
  // chain adapters in Group 8. In mock mode a well-formed request for a known
  // staff address is accepted.
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

export const requireStaff = (roleOrDb?: string | Database.Database, role?: string) => {
  const db = isDatabase(roleOrDb) ? roleOrDb : null;
  const requiredRole = isDatabase(roleOrDb) ? role : roleOrDb;

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
    if (requiredRole !== undefined && staff.role !== requiredRole) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }
  };
};

export { requireStaff as requireStaffHook };
