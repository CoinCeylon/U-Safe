import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('..', import.meta.url));
const thisFile = fileURLToPath(import.meta.url);

const walk = (dir: string): string[] => {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...walk(full));
    } else if (full.endsWith('.ts') && full !== thisFile) {
      files.push(full);
    }
  }
  return files;
};

describe('privacy lint', () => {
  it('server source contains no forbidden logging patterns', () => {
    const files = walk(srcDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.includes('console.log(req.body')) {
          violations.push(`${relative(srcDir, file)}:${index + 1}: console.log(req.body)`);
        }
        if (line.includes('request.ip')) {
          violations.push(`${relative(srcDir, file)}:${index + 1}: request.ip`);
        }
        if (/(console\.log|\.log\s*\(|\blogger\b)/.test(line) && /email|commitment|nullifier/i.test(line)) {
          violations.push(`${relative(srcDir, file)}:${index + 1}: logging sensitive value`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('logger configuration redacts everything except pathname, status and duration', () => {
    const appSource = readFileSync(join(srcDir, 'app.ts'), 'utf8');
    expect(appSource).toContain('statusCode: reply.statusCode');
    expect(appSource).toContain('durationMs: reply.elapsedTime');
    const hook = appSource.match(/app\.addHook\('onResponse'[\s\S]*?done\(\);/)?.[0] ?? '';
    // The pathname is derived from request.url with the query string removed.
    expect(hook).toContain("new URL(request.url, 'http://localhost').pathname");
    expect(hook).not.toContain('path: request.url,');
    expect(hook).not.toMatch(/request\.body/);
    expect(hook).not.toContain('query');
  });

  it('startup logging does not include host, port or secrets', () => {
    const indexSource = readFileSync(join(srcDir, 'index.ts'), 'utf8');
    expect(indexSource).toContain("app.log.info('server started')");
    const startupLog =
      indexSource.match(/app\.log\.info\([^)]*'server started'\)/)?.[0] ?? '';
    expect(startupLog).not.toContain('config.');
    expect(startupLog).not.toContain('DATABASE_PATH');
  });
});
