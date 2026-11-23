import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import { getUniversity, listUniversities } from './services/universities.js';

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

  return app;
};