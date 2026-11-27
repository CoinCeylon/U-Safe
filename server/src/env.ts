import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

// Load the git-ignored `.env` used by the dev workflow. npm workspaces run
// scripts with the workspace as cwd, so check `INIT_CWD` (the invocation root)
// first and the current directory second. dotenv never overwrites variables
// that are already set, so an explicit inline value still wins.
//
// Tests construct config objects directly; skipping there keeps the unit suite
// independent of a developer's local `.env`.
if (process.env.NODE_ENV !== 'test') {
  const roots = [process.env.INIT_CWD, process.cwd()].filter(
    (root): root is string => typeof root === 'string' && root.length > 0,
  );

  for (const root of new Set(roots)) {
    const envPath = resolve(root, '.env');
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }
}
