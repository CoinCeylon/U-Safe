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

console.log('Seeded universities:', demos.map((u) => u.id).join(', '));
db.close();
