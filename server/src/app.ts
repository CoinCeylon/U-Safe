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

const otpRequestSchema = z.object({ email: z.string().email() });
const otpVerifySchema = z.object({ email: z.string().email(), code: z.string().min(1) });

export const buildApp = async (
  config: Config,
  db: Database.Database,
  mailer: Mailer = createMailer(config),
): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: {
      level: 'info',
    },
    logController: new LogController({ disableRequestLogging: true }),
  });

  const otp = new OtpService(db, mailer, config.EMAIL_HASH_SALT);
  const tickets = new TicketService(db, config.EMAIL_HASH_SALT);

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

  return app;
};