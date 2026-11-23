import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const app = await buildApp(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
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
  app.log.info({ port: config.PORT, host: config.HOST, mode: config.CHAIN_MODE }, 'server started');
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});