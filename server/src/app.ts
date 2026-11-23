import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';

export const buildApp = async (config: Config): Promise<FastifyInstance> => {
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

  return app;
};