import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../server/src/env.js';
import {
  SecureStore,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateCommunityKey,
  generateRoleKeyPair,
  importPublicKeyJwk,
  wrapAesKeyBytes,
} from '@usafe/crypto';
import { openDatabase } from '../server/src/db/index.js';

export const DEMO_KEY_PASSPHRASE = 'demo';

const UGC_ADDRESS = 'ugc-demo-officer';

interface RoleKeyPair {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

interface UniversityRow {
  id: string;
  public_key_jwk: string | null;
  community_key_wrapped_for_ugc: string | null;
  community_key_wrapped_for_delivery: string | null;
}

interface StaffRow {
  id: number;
  public_key_jwk: string | null;
}

export interface SeedDemoKeysResult {
  universities: Array<{
    id: string;
    generated: boolean;
    communityGenerated: boolean;
  }>;
  ugc: { generated: boolean };
}

const encode = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64');

const safeFileId = (id: string): string => encodeURIComponent(id);

const roleBackupPath = (outputDir: string, id: string): string =>
  resolve(outputDir, `${id}.json`);

const writeRoleBackup = async (
  path: string,
  role: 'university' | 'ugc',
  universityId: string | null,
  pair: RoleKeyPair,
): Promise<void> => {
  const backup = await SecureStore.exportBackup(
    {
      role,
      universityId: universityId ?? '',
      publicKeyJwk: JSON.stringify(pair.publicKeyJwk),
      privateKeyJwk: JSON.stringify(pair.privateKeyJwk),
    },
    DEMO_KEY_PASSPHRASE,
  );
  writeFileSync(path, backup, { mode: 0o600 });
};

const readRoleBackup = async (path: string): Promise<RoleKeyPair | null> => {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const keys = await SecureStore.importBackup(
      readFileSync(path, 'utf8'),
      DEMO_KEY_PASSPHRASE,
    );
    if (
      typeof keys.publicKeyJwk !== 'string' ||
      typeof keys.privateKeyJwk !== 'string'
    ) {
      return null;
    }
    return {
      publicKeyJwk: JSON.parse(keys.publicKeyJwk) as JsonWebKey,
      privateKeyJwk: JSON.parse(keys.privateKeyJwk) as JsonWebKey,
    };
  } catch {
    return null;
  }
};

const seedUgc = async (
  db: Database.Database,
  outputDir: string,
): Promise<{ pair: RoleKeyPair; generated: boolean }> => {
  const backupPath = roleBackupPath(outputDir, 'ugc');
  const existingBackup = await readRoleBackup(backupPath);
  const generated = existingBackup === null;
  const pair =
    existingBackup ??
    (await (async () => {
      const generatedPair = await generateRoleKeyPair();
      return {
        publicKeyJwk: await exportPublicKeyJwk(generatedPair.publicKey),
        privateKeyJwk: await exportPrivateKeyJwk(generatedPair.privateKey),
      };
    })());

  if (generated) {
    await writeRoleBackup(backupPath, 'ugc', null, pair);
  }

  const staff = db
    .prepare(
      `SELECT id, public_key_jwk FROM staff
       WHERE role = 'ugc' AND address = ?
       ORDER BY id ASC LIMIT 1`,
    )
    .get(UGC_ADDRESS) as StaffRow | undefined;
  const publicKeyJwk = JSON.stringify(pair.publicKeyJwk);

  if (staff === undefined) {
    db.prepare(
      `INSERT INTO staff (university_id, role, address, public_key_jwk)
       VALUES (NULL, 'ugc', ?, ?)`,
    ).run(UGC_ADDRESS, publicKeyJwk);
  } else {
    db.prepare('UPDATE staff SET public_key_jwk = ? WHERE id = ?').run(
      publicKeyJwk,
      staff.id,
    );
  }

  return { pair, generated };
};

export const seedDemoKeys = async (
  db: Database.Database,
  outputDir: string,
  communityDeliverySecret: string,
): Promise<SeedDemoKeysResult> => {
  if (communityDeliverySecret.length === 0) {
    throw new Error('COMMUNITY_DELIVERY_SECRET must not be empty');
  }

  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const ugc = await seedUgc(db, outputDir);
  const ugcPublicKey = await importPublicKeyJwk(ugc.pair.publicKeyJwk);

  const universities = db
    .prepare(
      `SELECT id, public_key_jwk, community_key_wrapped_for_ugc,
              community_key_wrapped_for_delivery
       FROM universities ORDER BY id ASC`,
    )
    .all() as UniversityRow[];
  const results: SeedDemoKeysResult['universities'] = [];

  for (const university of universities) {
    const backupPath = roleBackupPath(
      outputDir,
      `university-${safeFileId(university.id)}`,
    );
    const existingBackup = await readRoleBackup(backupPath);
    const generated = existingBackup === null;
    const pair =
      existingBackup ??
      (await (async () => {
        const generatedPair = await generateRoleKeyPair();
        return {
          publicKeyJwk: await exportPublicKeyJwk(generatedPair.publicKey),
          privateKeyJwk: await exportPrivateKeyJwk(generatedPair.privateKey),
        };
      })());

    if (generated) {
      await writeRoleBackup(backupPath, 'university', university.id, pair);
    }

    const communityGenerated =
      university.community_key_wrapped_for_ugc === null ||
      university.community_key_wrapped_for_delivery === null ||
      ugc.generated;

    let wrappedForUgc = university.community_key_wrapped_for_ugc;
    let wrappedForDelivery = university.community_key_wrapped_for_delivery;
    if (communityGenerated) {
      const communityKey = generateCommunityKey();
      wrappedForUgc = encode(await wrapAesKeyBytes(communityKey, ugcPublicKey));
      wrappedForDelivery = await SecureStore.exportBackup(
        { communityKey: encode(communityKey) },
        communityDeliverySecret,
      );
    }

    db.prepare(
      `UPDATE universities
       SET public_key_jwk = ?,
           community_key_wrapped_for_ugc = ?,
           community_key_wrapped_for_delivery = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify(pair.publicKeyJwk),
      wrappedForUgc,
      wrappedForDelivery,
      university.id,
    );

    results.push({
      id: university.id,
      generated,
      communityGenerated,
    });
  }

  return { universities: results, ugc: { generated: ugc.generated } };
};

const main = async (): Promise<void> => {
  const communityDeliverySecret = process.env.COMMUNITY_DELIVERY_SECRET ?? '';
  if (communityDeliverySecret.length === 0) {
    throw new Error(
      'COMMUNITY_DELIVERY_SECRET is required. Example:\n  COMMUNITY_DELIVERY_SECRET=change-me-dev-delivery-secret npm run seed:keys',
    );
  }

  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const outputDir = resolve(baseDir, process.env.DEV_KEYS_DIR ?? '.dev-keys');
  const configuredDatabasePath = process.env.DATABASE_PATH;
  const databasePath =
    configuredDatabasePath === undefined
      ? resolve(baseDir, 'server/data/usafe.db')
      : resolve(baseDir, configuredDatabasePath);
  const migrationsDir = fileURLToPath(
    new URL('../server/migrations', import.meta.url),
  );

  console.warn(
    'WARNING: seed:keys generates development-only demo keys. Do not use them outside local development.',
  );

  const db = openDatabase(databasePath, migrationsDir);
  try {
    const result = await seedDemoKeys(db, outputDir, communityDeliverySecret);
    console.log(
      `Demo keys seeded for ${result.universities.length} universities and the UGC.`,
    );
  } finally {
    db.close();
  }
};

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
