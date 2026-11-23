import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),
  CHAIN_MODE: z.enum(['mock', 'testnet']).default('mock'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./data/usafe.db'),
  EMAIL_HASH_SALT: z.string().default('dev-email-hash-salt'),
});

export type Config = z.infer<typeof envSchema>;

export const loadConfig = (): Config => envSchema.parse(process.env);