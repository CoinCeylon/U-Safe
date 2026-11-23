import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { Config } from './config.js';
import { getUniversity, listUniversities } from './services/universities.js';
import { importRoster } from './services/roster.js';
import { createMailer, type Mailer } from './services/mailer.js';
import { OtpService } from './services/otp.js';
import { TicketService } from './services/tickets.js';
import { EnrollmentError, EnrollmentService } from './services/enrollment.js';
import { StubLedger, type EnrollmentLedger } from './services/ledger.js';
import { addClient, removeClient } from './services/events.js';
import {
  createChallenge,
  devLogin,
  loginWithSignature,
  requireStaff,
} from './services/staffAuth.js';
import {
  MAX_BLOB_SIZE,
  baseContentType,
  blobExists,
  blobFileSize,
  createBlobReadStream,
  isOctetStreamContentType,
  isValidBlobHash,
  normalizeBlobHash,
  resolveBlobDir,
  saveBlob,
  sha256Buffer,
} from './services/blobs.js';

const otpRequestSchema = z.object({ email: z.string().email() });
const otpVerifySchema = z.object({ email: z.string().email(), code: z.string().min(1) });
const enrollSchema = z.object({
  ticket: z.string().min(1),
  commitment: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export const buildApp = async (
  config: Config,
  db: Database.Database,
  mailerOrBlobDir?: Mailer | string,
  ledger: EnrollmentLedger = new StubLedger(),
  blobDir?: string,
): Promise<FastifyInstance> => {
  let mailer: Mailer = createMailer(config);
  let resolvedBlobDir = resolveBlobDir(blobDir);
  if (typeof mailerOrBlobDir === 'string') {
    resolvedBlobDir = resolveBlobDir(mailerOrBlobDir);
  } else if (mailerOrBlobDir !== undefined) {
    mailer = mailerOrBlobDir;
    resolvedBlobDir = resolveBlobDir(blobDir);
  }
  const app = Fastify({
    logger: {
      level: 'info',
    },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: MAX_BLOB_SIZE,
  });

  const otp = new OtpService(db, mailer, config.EMAIL_HASH_SALT);
  const tickets = new TicketService(db, config.EMAIL_HASH_SALT);
  (app as { decorate: (k: string, v: unknown) => void }).decorate('db', db);
  const enrollment = new EnrollmentService(db, tickets, ledger);

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: false,
  });

  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.addContentTypeParser(
    /^application\/octet-?stream/i,
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.addHook('onRequest', (request, reply, done) => {
    if (request.method === 'POST' && request.url.split('?')[0] === '/api/blobs') {
      if (!isOctetStreamContentType(baseContentType(request.headers['content-type']))) {
        reply.code(415).send({ error: 'unsupported media type' });
        return;
      }
    }
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        path: request.url,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'request',
    );
    done();
  });

  app.get('/api/health', () => ({
    ok: true,
    mode: config.CHAIN_MODE,
  }));

  app.get('/api/universities', () => {
    return listUniversities(db).map((u) => ({
      id: u.id,
      name: u.name,
      status: u.status,
    }));
  });

  app.get<{ Params: { id: string } }>('/api/universities/:id', (request, reply) => {
    const university = getUniversity(db, request.params.id);
    if (university === null) {
      reply.code(404);
      return { error: 'not found' };
    }
    return university;
  });

  app.post<{ Params: { id: string } }>('/api/university/:id/roster', (request, reply) => {
    const university = getUniversity(db, request.params.id);
    if (university === null) {
      reply.code(404);
      return { error: 'not found' };
    }

    let csvText = '';
    const body = request.body;
    if (typeof body === 'string') {
      csvText = body;
    } else if (body !== null && typeof body === 'object' && 'csv' in (body as Record<string, unknown>)) {
      const csvValue = (body as Record<string, unknown>).csv;
      csvText =
        typeof csvValue === 'string'
          ? csvValue
          : csvValue === null || csvValue === undefined
            ? ''
            : JSON.stringify(csvValue);
    }

    try {
      const result = importRoster(db, request.params.id, csvText, config.EMAIL_HASH_SALT);
      return result;
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  app.post('/api/otp/request', async (request, reply) => {
    const parsed = otpRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid request' };
    }

    const outcome = await otp.request(parsed.data.email, request.ip);
    if (outcome === 'rate_limited') {
      reply.code(429);
      return { error: 'too many requests' };
    }
    return { ok: true };
  });

  app.post('/api/otp/verify', (request, reply) => {
    const parsed = otpVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return { ok: false };
    }

    const outcome = otp.verify(parsed.data.email, parsed.data.code, request.ip);
    if (outcome === 'rate_limited') {
      reply.code(429);
      return { error: 'too many requests' };
    }
    if (outcome !== 'ok') {
      return { ok: false };
    }

    const issued = tickets.issue(parsed.data.email);
    if (issued === null) {
      return { ok: false };
    }
    return issued;
  });

  app.post('/api/enroll', (request, reply) => {
    const parsed = enrollSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid request' };
    }

    try {
      return enrollment.enroll(parsed.data.ticket, parsed.data.commitment.toLowerCase());
    } catch (error) {
      if (error instanceof EnrollmentError) {
        reply.code(400);
        return { error: error.message };
      }
      throw error;
    }
  });

  app.post('/api/blobs', async (request, reply) => {
    const contentType = baseContentType(request.headers['content-type']);
    if (!isOctetStreamContentType(contentType)) {
      reply.code(415);
      return { error: 'unsupported media type' };
    }

    const rawHash =
      (request.query as { hash?: unknown } | undefined)?.hash ??
      request.headers['x-hash'] ??
      request.headers['x-content-hash'] ??
      request.headers['content-hash'] ??
      request.headers['x-blob-hash'];

    if (typeof rawHash !== 'string' || !isValidBlobHash(rawHash)) {
      reply.code(400);
      return { error: 'missing or invalid hash' };
    }
    const hash = normalizeBlobHash(rawHash);

    const body = request.body;
    const bytes = Buffer.isBuffer(body)
      ? body
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(
            typeof body === 'string'
              ? body
              : body === null || body === undefined
                ? ''
                : JSON.stringify(body),
            'utf8',
          );

    if (bytes.length > MAX_BLOB_SIZE) {
      reply.code(413);
      return { error: 'payload too large' };
    }

    const actual = sha256Buffer(bytes);
    if (actual !== hash) {
      reply.code(400);
      return { error: 'hash mismatch' };
    }

    saveBlob(db, resolvedBlobDir, hash, bytes);
    return { hash, size: bytes.length };
  });

  app.get<{ Params: { hash: string } }>('/api/blobs/:hash', async (request, reply) => {
    const hash = normalizeBlobHash(request.params.hash);
    if (!isValidBlobHash(hash)) {
      reply.code(400);
      return { error: 'invalid hash' };
    }
    if (!blobExists(resolvedBlobDir, hash)) {
      reply.code(404);
      return { error: 'not found' };
    }

    reply.header('content-type', 'application/octet-stream');
    reply.header('content-length', blobFileSize(resolvedBlobDir, hash));
    return reply.send(createBlobReadStream(resolvedBlobDir, hash));
  });

  app.get('/api/auth/challenge', () => {
    const nonce = createChallenge();
    return { nonce, challenge: nonce };
  });

  const authLoginSchema = z.object({
    address: z.string().min(1),
    signature: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    nonce: z.string().optional(),
    challenge: z.string().optional(),
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = authLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid request' };
    }
    const token = loginWithSignature(db, {
      address: parsed.data.address,
      signature: parsed.data.signature,
      key: parsed.data.key,
    });
    if (token === null) {
      reply.code(401);
      return { error: 'invalid credentials' };
    }
    return { token, sessionToken: token };
  });

  if (process.env.DEV_LOGIN === 'true') {
    app.post('/api/auth/dev-login', (request) => {
      const body = (request.body ?? {}) as { role?: string; universityId?: string | null };
      const token = devLogin(db, {
        role: typeof body.role === 'string' ? body.role : undefined,
        universityId: body.universityId ?? null,
      });
      return { token, sessionToken: token };
    });
  }

  // Example protected route used by tests and portals.
  app.get('/api/staff/me', { preHandler: requireStaff() }, async (request) => {
    const header = request.headers.authorization;
    const auth = typeof header === 'string' ? header : '';
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    const token = match?.[1] ?? '';
    // verifySession imported lazily to avoid cycle
    const { verifySession } = await import('./services/staffAuth.js');
    const staff = verifySession(db, token);
    return { staff };
  });

  app.get('/api/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');

    const client = {
      write: (chunk: string) => reply.raw.write(chunk),
      end: () => reply.raw.end(),
    };
    addClient(client);

    request.raw.on('close', () => {
      removeClient(client);
    });
  });

  return app;
};
export { requireEnrollmentProof } from './hooks/requireEnrollmentProof.js';

export { publish } from './services/events.js';
