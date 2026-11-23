import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import { getUniversity, listUniversities } from './services/universities.js';
import { importRoster } from './services/roster.js';

export const buildApp = async (
  config: Config,
  db: Database.Database,
): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: {
      level: 'info',
    },
    logController: new LogController({ disableRequestLogging: true }),
  });

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

  return app;
};