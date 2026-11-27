import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { ConsoleMailer, SmtpMailer, createMailer } from './mailer.js';

const makeConfig = (overrides: Partial<Config> = {}): Config => ({
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  CHAIN_MODE: 'mock',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_PATH: './data/usafe.db',
  EMAIL_HASH_SALT: 'test-salt',
  COMMUNITY_DELIVERY_SECRET: 'delivery-secret',
  MAIL_MODE: 'dev',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: 'noreply@usafe.local',
  ...overrides,
});

describe('ConsoleMailer', () => {
  const directories: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  afterEach(() => {
    logSpy.mockClear();
    for (const dir of directories.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const tempMailboxDir = (): string => {
    const parent = mkdtempSync(join(tmpdir(), 'usafe-mail-'));
    directories.push(parent);
    return join(parent, 'mailbox');
  };

  it('creates the mailbox directory and writes the message as a text file', async () => {
    const dir = tempMailboxDir();
    await new ConsoleMailer(dir).send({
      to: 'student@example.edu',
      subject: 'U-Safe code',
      text: 'Your code is 123456',
      code: '123456',
    });

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0] ?? '').toMatch(/\.txt$/);
    const content = readFileSync(join(dir, files[0] ?? ''), 'utf8');
    expect(content).toContain('To: student@example.edu');
    expect(content).toContain('Subject: U-Safe code');
    expect(content).toContain('Your code is 123456');
  });

  it('prints the code without printing the recipient email', async () => {
    const dir = tempMailboxDir();
    await new ConsoleMailer(dir).send({
      to: 'student@example.edu',
      subject: 'U-Safe code',
      text: 'Your code is 123456',
      code: '123456',
    });

    const logged = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('123456');
    expect(logged).not.toContain('student@example.edu');
  });

  it('logs the written file path without the recipient email when no code is given', async () => {
    const dir = tempMailboxDir();
    await new ConsoleMailer(dir).send({
      to: 'student@example.edu',
      subject: 'Notice',
      text: 'Hello',
    });

    const logged = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain(dir);
    expect(logged).not.toContain('student@example.edu');
  });
});

describe('createMailer', () => {
  it('uses ConsoleMailer in dev mode', () => {
    expect(createMailer(makeConfig({ MAIL_MODE: 'dev' }))).toBeInstanceOf(ConsoleMailer);
  });

  it('uses SmtpMailer in smtp mode', () => {
    expect(createMailer(makeConfig({ MAIL_MODE: 'smtp' }))).toBeInstanceOf(SmtpMailer);
  });
});
