import {
  SecureStore,
  importPrivateKeyJwk,
  unwrapAesKeyBytes,
} from '@usafe/crypto';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../server/src/db/migrate.js';
import { DEMO_KEY_PASSPHRASE, seedDemoKeys } from './seed-keys.js';

const migrationsDir = fileURLToPath(
  new URL('../server/migrations', import.meta.url),
);
const deliverySecret = 'test-community-delivery-secret';

let db: Database.Database;
let outputDir: string;
let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'usafe-seed-keys-'));
  outputDir = join(rootDir, '.dev-keys');
  db = new Database(join(rootDir, 'usafe.db'));
  runMigrations(db, migrationsDir);
  db.prepare(
    `INSERT INTO universities (id, name, domain, enrollment_ceiling, status)
     VALUES ('uni-1', 'University One', 'one.ac.lk', 10, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO universities (id, name, domain, enrollment_ceiling, status)
     VALUES ('uni-2', 'University Two', 'two.ac.lk', 10, 'active')`,
  ).run();
});

afterEach(() => {
  db.close();
  rmSync(rootDir, { recursive: true, force: true });
});

describe('seedDemoKeys', () => {
  it('seeds importable role and community keys', async () => {
    const first = await seedDemoKeys(db, outputDir, deliverySecret);
    expect(first.ugc.generated).toBe(true);
    expect(first.universities).toEqual([
      { id: 'uni-1', generated: true, communityGenerated: true },
      { id: 'uni-2', generated: true, communityGenerated: true },
    ]);

    const ugcBackup = await SecureStore.importBackup(
      readFileSync(join(outputDir, 'ugc.json'), 'utf8'),
      DEMO_KEY_PASSPHRASE,
    );
    expect(ugcBackup.role).toBe('ugc');
    expect(ugcBackup.universityId).toBe('');
    expect(typeof ugcBackup.privateKeyJwk).toBe('string');
    expect(typeof ugcBackup.publicKeyJwk).toBe('string');

    const ugcPrivateKey = await importPrivateKeyJwk(
      JSON.parse(ugcBackup.privateKeyJwk ?? '') as JsonWebKey,
    );
    const universities = db
      .prepare(
        `SELECT id, public_key_jwk, community_key_wrapped_for_ugc,
                community_key_wrapped_for_delivery,
                community_key_created_at, community_key_academic_year
         FROM universities ORDER BY id ASC`,
      )
      .all() as Array<{
      id: string;
      public_key_jwk: string;
      community_key_wrapped_for_ugc: string;
      community_key_wrapped_for_delivery: string;
      community_key_created_at: string;
      community_key_academic_year: string;
    }>;

    for (const university of universities) {
      const backup = await SecureStore.importBackup(
        readFileSync(
          join(outputDir, `university-${university.id}.json`),
          'utf8',
        ),
        DEMO_KEY_PASSPHRASE,
      );
      expect(backup.role).toBe('university');
      expect(backup.universityId).toBe(university.id);
      expect(JSON.parse(backup.publicKeyJwk ?? '') as JsonWebKey).toEqual(
        JSON.parse(university.public_key_jwk) as JsonWebKey,
      );

      const communityKey = await unwrapAesKeyBytes(
        new Uint8Array(
          Buffer.from(university.community_key_wrapped_for_ugc, 'base64'),
        ),
        ugcPrivateKey,
      );
      const delivery = await SecureStore.importBackup(
        university.community_key_wrapped_for_delivery,
        deliverySecret,
      );
      expect(Buffer.from(communityKey).toString('base64')).toBe(
        delivery.communityKey,
      );

      // M065: the admin screen needs creation metadata for seeded keys.
      expect(university.community_key_created_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T/,
      );
      expect(university.community_key_academic_year).toMatch(
        /^\d{4}\/\d{4}$/,
      );
    }
  });

  it('is idempotent when run twice', async () => {
    await seedDemoKeys(db, outputDir, deliverySecret);
    const before = db
      .prepare(
        `SELECT id, public_key_jwk, community_key_wrapped_for_ugc,
                community_key_wrapped_for_delivery
         FROM universities ORDER BY id ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    const ugcBackupBefore = readFileSync(join(outputDir, 'ugc.json'), 'utf8');

    const second = await seedDemoKeys(db, outputDir, deliverySecret);
    expect(second.ugc.generated).toBe(false);
    expect(second.universities).toEqual([
      { id: 'uni-1', generated: false, communityGenerated: false },
      { id: 'uni-2', generated: false, communityGenerated: false },
    ]);

    const after = db
      .prepare(
        `SELECT id, public_key_jwk, community_key_wrapped_for_ugc,
                community_key_wrapped_for_delivery
         FROM universities ORDER BY id ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    expect(after).toEqual(before);
    expect(readFileSync(join(outputDir, 'ugc.json'), 'utf8')).toBe(
      ugcBackupBefore,
    );

    const staffCount = db
      .prepare(
        `SELECT COUNT(*) AS count FROM staff
         WHERE role = 'ugc' AND address = 'ugc-demo-officer'`,
      )
      .get() as { count: number };
    expect(staffCount.count).toBe(1);
  });
});
