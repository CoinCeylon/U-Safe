import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { createUniversity } from './services/universities.js';

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH, './migrations');

const demos = [
  { id: 'moratuwa', name: 'University of Moratuwa', domain: 'mrt.ac.lk', enrollment_ceiling: 1000 },
  { id: 'peradeniya', name: 'University of Peradeniya', domain: 'pdn.ac.lk', enrollment_ceiling: 1500 },
  { id: 'colombo', name: 'University of Colombo', domain: 'cmb.ac.lk', enrollment_ceiling: 800 },
];

for (const u of demos) {
  createUniversity(db, { ...u, status: 'active' });
}

// Demo staff accounts for the M063 development login dropdown. Addresses are
// dev placeholders; the CIP-8 wallet flow registers real stake addresses.
const staffRoles = ['registrar', 'investigator', 'admin'] as const;
const findStaff = db.prepare('SELECT id FROM staff WHERE address = ?');
const insertStaff = db.prepare(
  `INSERT INTO staff (university_id, role, address, public_key_jwk)
   VALUES (?, ?, ?, NULL)`,
);
for (const u of demos) {
  for (const role of staffRoles) {
    const address = `dev-${role}-${u.id}`;
    if (findStaff.get(address) === undefined) {
      insertStaff.run(u.id, role, address);
    }
  }
}

console.log('Seeded universities:', demos.map((u) => u.id).join(', '));
console.log(
  'Seeded demo staff accounts: registrar, investigator, admin per university',
);
db.close();
