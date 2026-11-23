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

  it('logger configuration redacts everything except path, status and duration', () => {
    const appSource = readFileSync(join(srcDir, 'app.ts'), 'utf8');
    expect(appSource).toContain('path: request.url');
    expect(appSource).toContain('statusCode: reply.statusCode');
    expect(appSource).toContain('durationMs: reply.elapsedTime');
    const hook = appSource.match(/app\.addHook\('onResponse'[\s\S]*?done\(\);/)?.[0] ?? '';
    expect(hook).toContain('path: request.url');
    expect(hook).toContain('statusCode: reply.statusCode');
    expect(hook).toContain('durationMs: reply.elapsedTime');
    expect(hook).not.toMatch(/request\.body/);
  });
});
