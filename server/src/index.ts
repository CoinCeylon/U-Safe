import { MockLedger } from '@usafe/chain';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { openDatabase } from './db/index.js';
import {
  startEscalationJob,
  stopEscalationJob,
} from './services/escalation.js';
import { publish } from './services/events.js';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const db = openDatabase(config.DATABASE_PATH, './migrations');
  const ledger = new MockLedger(db, { publish });
  const app = await buildApp(config, db, undefined, ledger, undefined, ledger);

  const escalationHandle = startEscalationJob(db);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      stopEscalationJob(escalationHandle);
      await app.close();
      db.close();
      process.exit(0);
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    { port: config.PORT, host: config.HOST, mode: config.CHAIN_MODE },
    'server started',
  );
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
