import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * All environment configuration is parsed and validated once at boot,
 * so a misconfigured deploy fails fast instead of at the first request.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional().transform((v) => v || undefined),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  DEEPGRAM_API_KEY: z.string().optional().transform((v) => v || undefined),
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => v || undefined),
  SUMMARY_MODEL: z.string().default('claude-opus-5-5'),
  GEMINI_API_KEY: z.string().optional().transform((v) => v || undefined),
  /** Tried in order; free-tier capacity varies per model. */
  GEMINI_MODELS: z
    .string()
    .default('gemini-2.5-flash,gemini-flash-latest,gemini-2.5-flash-lite,gemini-flash-lite-latest')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  /** auto = anthropic if its key is set, else gemini if its key is set, else mock. */
  SUMMARY_PROVIDER: z.enum(['auto', 'anthropic', 'gemini', 'mock']).default('auto'),

  ICE_SERVERS: z
    .string()
    .default('[{"urls":"stun:stun.l.google.com:19302"}]')
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown[];
      } catch {
        ctx.addIssue({ code: 'custom', message: 'ICE_SERVERS must be a JSON array' });
        return z.NEVER;
      }
    }),

  /** Background worker poll interval. */
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  /** Set to "false" to run the API without the in-process worker (e.g. in tests). */
  JOBS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
});

export type AppConfig = z.infer<typeof schema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Local dev convenience; real deploys inject env vars directly. Existing vars win.
  if (env === process.env && existsSync('.env')) process.loadEnvFile('.env');
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.STORAGE_DRIVER === 's3' && (!cfg.S3_BUCKET || !cfg.S3_ACCESS_KEY_ID || !cfg.S3_SECRET_ACCESS_KEY)) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }
  return cfg;
}
