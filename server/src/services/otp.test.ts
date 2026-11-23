import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import type { Mailer, MailMessage } from './mailer.js';
import { OtpService } from './otp.js';
import { emailHash } from './roster.js';

const salt = 'test-salt';
const email = 'student@uni.edu';
const otherEmail = 'other@uni.edu';
const ip = '127.0.0.1';
const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

const config: Config = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  CHAIN_MODE: 'mock',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_PATH: ':memory:',
  EMAIL_HASH_SALT: salt,
  MAIL_MODE: 'dev',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: 'noreply@usafe.local',
};

class CapturingMailer implements Mailer {
  readonly messages: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }
}

let db: Database.Database;
let mailer: CapturingMailer;
let app: FastifyInstance | undefined;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db, migrationsDir);
  db.prepare(
    "INSERT INTO universities (id, name, domain, enrollment_ceiling, status) VALUES ('u1', 'Uni', 'uni.edu', 100, 'active')",
  ).run();
  db.prepare('INSERT INTO roster (university_id, email_hash) VALUES (?, ?)').run(
    'u1',
    emailHash(salt, email),
  );
  mailer = new CapturingMailer();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  db.close();
});

const issueCode = async (service: OtpService): Promise<string> => {
  await service.request(email, ip);
  const code = mailer.messages.at(-1)?.code;
  if (code === undefined) {
    throw new Error('no code was mailed');
  }
  return code;
};

describe('OtpService.request', () => {
  it('sends a code and stores only its salted hash with an expiry', async () => {
    const service = new OtpService(db, mailer, salt);
    expect(await service.request(email, ip)).toBe('sent');
    expect(mailer.messages).toHaveLength(1);

    const code = mailer.messages[0]?.code ?? '';
    expect(code).toMatch(/^\d{6}$/);

    const row = db
      .prepare('SELECT code_hash, expires_at, attempts FROM otp WHERE email_hash = ?')
      .get(emailHash(salt, email)) as {
      code_hash: string;
      expires_at: string;
      attempts: number;
    };
    expect(row.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.code_hash).not.toBe(code);
    expect(row.attempts).toBe(0);
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now());
  });

  it('returns the same outcome without mailing for unknown and enrolled emails', async () => {
    const service = new OtpService(db, mailer, salt);
    expect(await service.request(otherEmail, ip)).toBe('sent');

    db.prepare('UPDATE roster SET enrolled_at = ? WHERE email_hash = ?').run(
      new Date().toISOString(),
      emailHash(salt, email),
    );
    expect(await service.request(email, ip)).toBe('sent');
    expect(mailer.messages).toHaveLength(0);
  });

  it('rate limits requests by email hash and by IP', async () => {
    const byEmail = new OtpService(db, mailer, salt, {
      requestLimit: 1,
      ipRequestLimit: 100,
    });
    expect(await byEmail.request(email, ip)).toBe('sent');
    expect(await byEmail.request(email, ip)).toBe('rate_limited');

    const byIp = new OtpService(db, mailer, salt, {
      requestLimit: 100,
      ipRequestLimit: 1,
    });
    expect(await byIp.request(email, ip)).toBe('sent');
    expect(await byIp.request(otherEmail, ip)).toBe('rate_limited');
  });
});

describe('OtpService.verify', () => {
  const options = { verifyLimit: 100, ipVerifyLimit: 100 };

  it('accepts a correct code once and consumes it', async () => {
    const service = new OtpService(db, mailer, salt, options);
    const code = await issueCode(service);
    expect(service.verify(email, code, ip)).toBe('ok');
    expect(service.verify(email, code, ip)).toBe('invalid');
  });

  it('locks after five wrong codes', async () => {
    const service = new OtpService(db, mailer, salt, options);
    const code = await issueCode(service);
    const wrong = code === '000000' ? '999999' : '000000';

    for (let i = 0; i < 5; i += 1) {
      expect(service.verify(email, wrong, ip)).toBe('invalid');
    }
    expect(service.verify(email, code, ip)).toBe('invalid');
  });

  it('rejects an expired code', async () => {
    const service = new OtpService(db, mailer, salt, options);
    const code = await issueCode(service);
    db.prepare('UPDATE otp SET expires_at = ? WHERE email_hash = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      emailHash(salt, email),
    );
    expect(service.verify(email, code, ip)).toBe('invalid');
  });

  it('rate limits verification by email hash and by IP', () => {
    const byEmail = new OtpService(db, mailer, salt, {
      verifyLimit: 1,
      ipVerifyLimit: 100,
    });
    expect(byEmail.verify(email, '000000', ip)).toBe('invalid');
    expect(byEmail.verify(email, '000000', ip)).toBe('rate_limited');

    const byIp = new OtpService(db, mailer, salt, {
      verifyLimit: 100,
      ipVerifyLimit: 1,
    });
    expect(byIp.verify(email, '000000', ip)).toBe('invalid');
    expect(byIp.verify(otherEmail, '000000', ip)).toBe('rate_limited');
  });
});

describe('OTP routes', () => {
  const getApp = async (): Promise<FastifyInstance> => {
    if (app === undefined) {
      app = await buildApp(config, db, mailer);
    }
    return app;
  };

  const post = async (url: string, payload: Record<string, string>) => {
    const instance = await getApp();
    return instance.inject({ method: 'POST', url, payload });
  };

  it('returns the same response for known and unknown emails', async () => {
    const known = await post('/api/otp/request', { email });
    const unknown = await post('/api/otp/request', { email: otherEmail });
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.json()).toEqual(unknown.json());
  });

  it('verifies a mailed code and returns an enrollment ticket without the email', async () => {
    await post('/api/otp/request', { email });
    const code = mailer.messages[0]?.code ?? '';
    const response = await post('/api/otp/verify', { email, code });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ ticket: string; universityId: string }>();
    expect(body.ticket).toEqual(expect.any(String));
    expect(body.universityId).toBe('u1');
    expect(JSON.stringify(body)).not.toContain(email);
    expect(Object.keys(body).sort()).toEqual(['ticket', 'universityId']);
  });

  it('returns a generic failure for a wrong code', async () => {
    await post('/api/otp/request', { email });
    const code = mailer.messages[0]?.code ?? '';
    const wrong = code === '000000' ? '999999' : '000000';
    const response = await post('/api/otp/verify', { email, code: wrong });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: false });
  });
});
