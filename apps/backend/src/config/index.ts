import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

import fs from 'node:fs';

// Look for .env in current directory, then parent directory
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '../.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  MASTER_ENCRYPTION_KEY: z.string().length(64, 'MASTER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)'),
  STORAGE_DIR: z.string().default('./storage'),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:3000'),
  PLAYWRIGHT_HEADLESS: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@billsmaster.local'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

const resolvedStorageDir = path.resolve(process.cwd(), parsed.data.STORAGE_DIR);

export const config = {
  ...parsed.data,
  STORAGE_DIR: resolvedStorageDir,
  INVOICES_DIR: path.join(resolvedStorageDir, 'invoices'),
  SESSIONS_DIR: path.join(resolvedStorageDir, 'sessions'),
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((s) => s.trim()),
};
