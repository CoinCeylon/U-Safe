import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),
  CHAIN_MODE: z.enum(['mock', 'testnet']).default('mock'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./data/usafe.db'),
  EMAIL_HASH_SALT: z.string().default('dev-email-hash-salt'),
  MAIL_MODE: z.enum(['dev', 'smtp']).default('dev'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default('noreply@usafe.local'),
  // Wraps each university community key for delivery to newly enrolled
  // students. Optional so tests and local servers without a demo key set can
  // still start; community key delivery is disabled when it is empty.
  COMMUNITY_DELIVERY_SECRET: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export const loadConfig = (): Config => envSchema.parse(process.env);