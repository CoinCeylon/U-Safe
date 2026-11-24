import type Database from 'better-sqlite3';

export interface University {
  id: string;
  name: string;
  domain: string;
  enrollment_ceiling: number;
  public_key_jwk: string | null;
  community_key_wrapped_for_ugc: string | null;
  community_key_wrapped_for_delivery: string | null;
  status: string;
}

export interface CreateUniversityInput {
  id: string;
  name: string;
  domain: string;
  enrollment_ceiling?: number;
  public_key_jwk?: string | null;
  community_key_wrapped_for_ugc?: string | null;
  community_key_wrapped_for_delivery?: string | null;
  status?: string;
}

const asString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
};

const rowToUniversity = (row: Record<string, unknown>): University => ({
  id: asString(row.id),
  name: asString(row.name),
  domain: asString(row.domain),
  enrollment_ceiling: Number(row.enrollment_ceiling),
  public_key_jwk: row.public_key_jwk == null ? null : asString(row.public_key_jwk),
  community_key_wrapped_for_ugc:
    row.community_key_wrapped_for_ugc == null ? null : asString(row.community_key_wrapped_for_ugc),
  community_key_wrapped_for_delivery:
    row.community_key_wrapped_for_delivery == null
      ? null
      : asString(row.community_key_wrapped_for_delivery),
  status: asString(row.status),
});

export const createUniversity = (
  db: Database.Database,
  input: CreateUniversityInput,
): University => {
  const university: University = {
    id: input.id,
    name: input.name,
    domain: input.domain,
    enrollment_ceiling: input.enrollment_ceiling ?? 0,
    public_key_jwk: input.public_key_jwk ?? null,
    community_key_wrapped_for_ugc: input.community_key_wrapped_for_ugc ?? null,
    community_key_wrapped_for_delivery: input.community_key_wrapped_for_delivery ?? null,
    status: input.status ?? 'active',
  };

  db.prepare(
    `INSERT INTO universities
      (id, name, domain, enrollment_ceiling, public_key_jwk,
       community_key_wrapped_for_ugc, community_key_wrapped_for_delivery, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    university.id,
    university.name,
    university.domain,
    university.enrollment_ceiling,
    university.public_key_jwk,
    university.community_key_wrapped_for_ugc,
    university.community_key_wrapped_for_delivery,
    university.status,
  );

  const existing = getUniversity(db, university.id);
  if (existing === null) {
    throw new Error('failed to create university');
  }
  return existing;
};

export const listUniversities = (db: Database.Database): University[] => {
  const rows = db
    .prepare('SELECT * FROM universities ORDER BY name ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToUniversity);
};

export const getUniversity = (db: Database.Database, id: string): University | null => {
  const row = db
    .prepare('SELECT * FROM universities WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (row === undefined) {
    return null;
  }
  return rowToUniversity(row);
};
