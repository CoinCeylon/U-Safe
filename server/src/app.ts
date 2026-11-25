import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
} from 'fastify';
import cors from '@fastify/cors';
import { LedgerAuthorizationError, MockLedger } from '@usafe/chain';
import type Database from 'better-sqlite3';
import {
  fileComplaintInputSchema,
  supportComplaintInputSchema,
  type ComplaintViewerRole,
} from '@usafe/shared';
import { z } from 'zod';
import type { Config } from './config.js';
import { getUniversity, listUniversities } from './services/universities.js';
import { importRoster } from './services/roster.js';
import { createMailer, type Mailer } from './services/mailer.js';
import { OtpService } from './services/otp.js';
import { TicketService } from './services/tickets.js';
import { EnrollmentError, EnrollmentService } from './services/enrollment.js';
import {
  StubLedger,
  type ComplaintLedger,
  type EnrollmentLedger,
} from './services/ledger.js';
import { clientIp } from './services/clientIp.js';
import { addClient, publish, removeClient } from './services/events.js';
import {
  CommunityKeyError,
  deliverCommunityKey,
  getUgcPublicKeyJwk,
} from './services/communityKey.js';
import { requireEnrollmentProof } from './hooks/requireEnrollmentProof.js';
import {
  createChallenge,
  devLogin,
  loginWithSignature,
  requireStaff,
  staffOwnerRole,
  verifySession,
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
const otpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
});
const enrollSchema = z.object({
  ticket: z.string().min(1),
  commitment: z.string().regex(/^[0-9a-fA-F]{64}$/),
});
const complaintStatusSchema = z.object({
  newStatus: z.enum(['not_started', 'pending_investigation', 'finished']),
  outcomeHash: z.string().min(1).nullable().default(null),
});
const complaintListQuerySchema = z
  .object({
    university: z.string().min(1).optional(),
    status: z
      .enum(['not_started', 'pending_investigation', 'finished'])
      .optional(),
    category: z
      .enum(['verbal', 'physical', 'sexual', 'cyber', 'financial', 'other'])
      .optional(),
    ownerRole: z.enum(['university', 'ugc']).optional(),
    escalated: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : value === 'true',
      ),
  })
  .strict();
const universityQuerySchema = z
  .object({ university: z.string().min(1).optional() })
  .strict();

interface ComplaintViewer {
  viewerRole: ComplaintViewerRole;
  universityId?: string;
}

const ledgerErrorReply = (
  reply: FastifyReply,
  error: unknown,
): FastifyReply => {
  if (error instanceof LedgerAuthorizationError) {
    return reply.code(403).send({ error: 'forbidden' });
  }
  if (error instanceof Error && error.message === 'complaint not found') {
    return reply.code(404).send({ error: 'not found' });
  }
  if (error instanceof Error && error.message.includes('not yet implemented')) {
    return reply.code(501).send({ error: error.message });
  }
  if (error instanceof Error) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
};

const resolveViewer = (
  db: Database.Database,
  request: { headers: { authorization?: string } },
  university: string | undefined,
  reply: FastifyReply,
): ComplaintViewer | null => {
  const authorization = request.headers.authorization;
  if (authorization === undefined) {
    if (university === undefined) {
      reply.code(400).send({ error: 'university is required' });
      return null;
    }
    return { viewerRole: 'student', universityId: university };
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const staff = verifySession(db, match?.[1] ?? '');
  if (staff === null) {
    reply.code(401).send({ error: 'invalid token' });
    return null;
  }

  if (staff.university_id === null) {
    return { viewerRole: 'ugc', universityId: university };
  }
  if (university !== undefined && university !== staff.university_id) {
    reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return { viewerRole: 'university', universityId: staff.university_id };
};

export const buildApp = async (
  config: Config,
  db: Database.Database,
  mailerOrBlobDir?: Mailer | string,
  ledger: EnrollmentLedger = new StubLedger(),
  blobDir?: string,
  complaintLedger?: ComplaintLedger,
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
  const complaints = complaintLedger ?? new MockLedger(db, { publish });
  const enrollmentProof = requireEnrollmentProof(complaints);

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: false,
  });

  app.addContentTypeParser(
    'text/plain',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    },
  );
  app.addContentTypeParser(
    'text/csv',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.addContentTypeParser(
    /^application\/octet-?stream/i,
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.addHook('onRequest', (request, reply, done) => {
    if (
      request.method === 'POST' &&
      request.url.split('?')[0] === '/api/blobs'
    ) {
      if (
        !isOctetStreamContentType(
          baseContentType(request.headers['content-type']),
        )
      ) {
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

  app.get<{ Params: { id: string } }>(
    '/api/universities/:id',
    (request, reply) => {
      const university = getUniversity(db, request.params.id);
      if (university === null) {
        reply.code(404);
        return { error: 'not found' };
      }
      return university;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/university/:id/roster',
    (request, reply) => {
      const university = getUniversity(db, request.params.id);
      if (university === null) {
        reply.code(404);
        return { error: 'not found' };
      }

      let csvText = '';
      const body = request.body;
      if (typeof body === 'string') {
        csvText = body;
      } else if (
        body !== null &&
        typeof body === 'object' &&
        'csv' in (body as Record<string, unknown>)
      ) {
        const csvValue = (body as Record<string, unknown>).csv;
        csvText =
          typeof csvValue === 'string'
            ? csvValue
            : csvValue === null || csvValue === undefined
              ? ''
              : JSON.stringify(csvValue);
      }

      try {
        const result = importRoster(
          db,
          request.params.id,
          csvText,
          config.EMAIL_HASH_SALT,
        );
        return result;
      } catch (error) {
        reply.code(400);
        return { error: (error as Error).message };
      }
    },
  );

  app.post('/api/otp/request', async (request, reply) => {
    const parsed = otpRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid request' };
    }

    const outcome = await otp.request(parsed.data.email, clientIp(request));
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

    const outcome = otp.verify(
      parsed.data.email,
      parsed.data.code,
      clientIp(request),
    );
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

  app.post('/api/enroll', async (request, reply) => {
    const parsed = enrollSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid request' };
    }

    try {
      return await enrollment.enroll(
        parsed.data.ticket,
        parsed.data.commitment.toLowerCase(),
      );
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

  app.get<{ Params: { hash: string } }>(
    '/api/blobs/:hash',
    async (request, reply) => {
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
    },
  );

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
      const body = (request.body ?? {}) as {
        role?: string;
        universityId?: string | null;
      };
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

  app.post(
    '/api/complaints',
    { preHandler: enrollmentProof },
    async (request, reply) => {
      const parsed = fileComplaintInputSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid request' };
      }

      try {
        return await complaints.fileComplaint(parsed.data);
      } catch (error) {
        return ledgerErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/complaints/:id/support',
    { preHandler: enrollmentProof },
    async (request, reply) => {
      const parsed = supportComplaintInputSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid request' };
      }
      if (parsed.data.complaintId !== request.params.id) {
        reply.code(400);
        return { error: 'complaint id mismatch' };
      }

      try {
        return await complaints.supportComplaint(parsed.data);
      } catch (error) {
        return ledgerErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/complaints/:id/status',
    { preHandler: requireStaff() },
    async (request, reply) => {
      const parsed = complaintStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid request' };
      }

      const staff = request.staff;
      if (staff === undefined) {
        reply.code(401);
        return { error: 'missing token' };
      }

      try {
        if (staff.university_id !== null) {
          await complaints.getComplaint({
            viewerRole: 'university',
            universityId: staff.university_id,
            complaintId: request.params.id,
          });
        }
        return await complaints.updateStatus({
          complaintId: request.params.id,
          newStatus: parsed.data.newStatus,
          outcomeHash: parsed.data.outcomeHash,
          ownerRole: staffOwnerRole(staff),
        });
      } catch (error) {
        return ledgerErrorReply(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/complaints/:id/reopen',
    { preHandler: requireStaff() },
    async (request, reply) => {
      const staff = request.staff;
      if (staff === undefined) {
        reply.code(401);
        return { error: 'missing token' };
      }
      if (staffOwnerRole(staff) !== 'ugc') {
        reply.code(403);
        return { error: 'forbidden' };
      }

      try {
        return await complaints.reopenComplaint({
          complaintId: request.params.id,
        });
      } catch (error) {
        return ledgerErrorReply(reply, error);
      }
    },
  );

  app.get('/api/complaints', async (request, reply) => {
    const parsedQuery = complaintListQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      reply.code(400);
      return { error: 'invalid query' };
    }
    const viewer = resolveViewer(
      db,
      request,
      parsedQuery.data.university,
      reply,
    );
    if (viewer === null) {
      return reply;
    }

    try {
      return await complaints.listComplaints({
        viewerRole: viewer.viewerRole,
        universityId: viewer.universityId,
        status: parsedQuery.data.status,
        category: parsedQuery.data.category,
        ownerRole: parsedQuery.data.ownerRole,
        escalated: parsedQuery.data.escalated,
      });
    } catch (error) {
      return ledgerErrorReply(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/complaints/:id',
    async (request, reply) => {
      const parsedQuery = universityQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        reply.code(400);
        return { error: 'invalid query' };
      }
      const viewer = resolveViewer(
        db,
        request,
        parsedQuery.data.university,
        reply,
      );
      if (viewer === null) {
        return reply;
      }

      try {
        return await complaints.getComplaint({
          viewerRole: viewer.viewerRole,
          universityId: viewer.universityId,
          complaintId: request.params.id,
        });
      } catch (error) {
        return ledgerErrorReply(reply, error);
      }
    },
  );

  // Status history contains only status, time, actor role and note hashes.
  // Students, university staff and UGC staff may read it for their own scope.
  app.get<{ Params: { id: string } }>(
    '/api/complaints/:id/history',
    async (request, reply) => {
      const parsedQuery = universityQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        reply.code(400);
        return { error: 'invalid query' };
      }
      const viewer = resolveViewer(
        db,
        request,
        parsedQuery.data.university,
        reply,
      );
      if (viewer === null) {
        return reply;
      }

      try {
        return await complaints.getHistory({
          viewerRole: viewer.viewerRole,
          universityId: viewer.universityId,
          complaintId: request.params.id,
        });
      } catch (error) {
        return ledgerErrorReply(reply, error);
      }
    },
  );

  app.get('/api/stats', async (request, reply) => {
    const parsedQuery = universityQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      reply.code(400);
      return { error: 'invalid query' };
    }
    const viewer = resolveViewer(
      db,
      request,
      parsedQuery.data.university,
      reply,
    );
    if (viewer === null) {
      return reply;
    }

    try {
      return await complaints.getStats({
        viewerRole: viewer.viewerRole,
        universityId: viewer.universityId,
      });
    } catch (error) {
      return ledgerErrorReply(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/universities/:id/leaves',
    async (request, reply) => {
      if (getUniversity(db, request.params.id) === null) {
        reply.code(404);
        return { error: 'not found' };
      }
      try {
        return await complaints.getLeaves({
          universityId: request.params.id,
        });
      } catch (error) {
        return ledgerErrorReply(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/universities/:id/roots',
    async (request, reply) => {
      if (getUniversity(db, request.params.id) === null) {
        reply.code(404);
        return { error: 'not found' };
      }
      try {
        return await complaints.getRoots({
          universityId: request.params.id,
        });
      } catch (error) {
        return ledgerErrorReply(reply, error);
      }
    },
  );

  // Community key delivery to enrolled students (M060). Only a caller with a
  // valid membership proof receives the key; the proof is verified and then
  // discarded, and the key itself is never logged.
  app.post<{ Params: { id: string } }>(
    '/api/universities/:id/community-key',
    { preHandler: enrollmentProof },
    async (request, reply) => {
      try {
        const communityKey = await deliverCommunityKey(
          db,
          request.params.id,
          config.COMMUNITY_DELIVERY_SECRET,
        );
        return { communityKey };
      } catch (error) {
        if (error instanceof CommunityKeyError) {
          reply.code(error.statusCode);
          return { error: error.message };
        }
        throw error;
      }
    },
  );

  // The UGC public key is public knowledge: students wrap staff-involved
  // payload and evidence keys for it (M060), universities wrap community
  // keys for it (M065).
  app.get('/api/ugc/public-key', async (_request, reply) => {
    const publicKeyJwk = getUgcPublicKeyJwk(db);
    if (publicKeyJwk === null) {
      reply.code(404);
      return { error: 'ugc public key not registered' };
    }
    return { publicKeyJwk };
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

  app.post('/api/events/publish', (request) => {
    const body = (request.body ?? {}) as { type?: string; id?: string };
    const event = {
      type: typeof body.type === 'string' ? body.type : 'test.event',
      id: typeof body.id === 'string' ? body.id : `evt-${Date.now()}`,
    };
    publish(event);
    return { ok: true, event };
  });

  return app;
};
export { requireEnrollmentProof } from './hooks/requireEnrollmentProof.js';

export { publish } from './services/events.js';
