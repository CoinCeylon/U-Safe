import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_EXPIRY_MINUTES, OTP_LENGTH, OTP_MAX_ATTEMPTS } from '@usafe/shared';
import type Database from 'better-sqlite3';
import type { Mailer } from './mailer.js';
import { RateLimiter } from './rateLimiter.js';
import { emailHash } from './roster.js';

export type OtpRequestOutcome = 'sent' | 'rate_limited';
export type OtpVerifyOutcome = 'ok' | 'invalid' | 'rate_limited';

export interface OtpServiceOptions {
  requestLimit?: number;
  ipRequestLimit?: number;
  verifyLimit?: number;
  ipVerifyLimit?: number;
  windowMs?: number;
}

interface OtpRow {
  code_hash: string;
  expires_at: string;
  attempts: number;
}

const generateCode = (): string =>
  randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');

// Only a salted digest is persisted; plaintext codes exist solely in the mail message.
const codeHash = (salt: string, code: string): string =>
  createHash('sha256').update(salt + code).digest('hex');

const ipHash = (salt: string, ip: string): string =>
  createHash('sha256').update(salt + ip).digest('hex');

// Compare digests in constant time so a wrong code cannot be distinguished byte by byte.
const hashesEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

export class OtpService {
  private readonly requestByEmail: RateLimiter;
  private readonly requestByIp: RateLimiter;
  private readonly verifyByEmail: RateLimiter;
  private readonly verifyByIp: RateLimiter;

  constructor(
    private readonly db: Database.Database,
    private readonly mailer: Mailer,
    private readonly salt: string,
    options: OtpServiceOptions = {},
  ) {
    const windowMs = options.windowMs ?? OTP_EXPIRY_MINUTES * 60 * 1000;
    this.requestByEmail = new RateLimiter(options.requestLimit ?? 5, windowMs);
    this.requestByIp = new RateLimiter(options.ipRequestLimit ?? 30, windowMs);
    this.verifyByEmail = new RateLimiter(options.verifyLimit ?? OTP_MAX_ATTEMPTS, windowMs);
    this.verifyByIp = new RateLimiter(options.ipVerifyLimit ?? 30, windowMs);
  }

  async request(email: string, ip: string): Promise<OtpRequestOutcome> {
    const hash = emailHash(this.salt, email);
    const ipKey = ipHash(this.salt, ip);
    if (
      !this.requestByEmail.allow(`email:${hash}`) ||
      !this.requestByIp.allow(`ip:${ipKey}`)
    ) {
      return 'rate_limited';
    }

    const row = this.db
      .prepare('SELECT id FROM roster WHERE email_hash = ? AND enrolled_at IS NULL')
      .get(hash) as { id: number } | undefined;
    if (row === undefined) {
      return 'sent';
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
    this.db
      .prepare(
        `INSERT INTO otp (email_hash, code_hash, expires_at, attempts)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(email_hash) DO UPDATE SET
           code_hash = excluded.code_hash,
           expires_at = excluded.expires_at,
           attempts = 0`,
      )
      .run(hash, codeHash(this.salt, code), expiresAt);

    try {
      await this.mailer.send({
        to: email,
        subject: 'Your U-Safe verification code',
        text: `Your verification code is ${code}.`,
        code,
      });
    } catch {
      return 'sent';
    }
    return 'sent';
  }

  verify(email: string, code: string, ip: string): OtpVerifyOutcome {
    const hash = emailHash(this.salt, email);
    const ipKey = ipHash(this.salt, ip);
    if (
      !this.verifyByEmail.allow(`email:${hash}`) ||
      !this.verifyByIp.allow(`ip:${ipKey}`)
    ) {
      return 'rate_limited';
    }

    const row = this.db
      .prepare('SELECT code_hash, expires_at, attempts FROM otp WHERE email_hash = ?')
      .get(hash) as OtpRow | undefined;
    if (row === undefined) {
      return 'invalid';
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS || Date.parse(row.expires_at) <= Date.now()) {
      return 'invalid';
    }

    if (!hashesEqual(row.code_hash, codeHash(this.salt, code))) {
      this.db.prepare('UPDATE otp SET attempts = attempts + 1 WHERE email_hash = ?').run(hash);
      return 'invalid';
    }

    this.db.prepare('DELETE FROM otp WHERE email_hash = ?').run(hash);
    return 'ok';
  }
}
