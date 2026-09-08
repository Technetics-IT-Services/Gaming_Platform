import { z } from 'zod';

/**
 * Strongly-typed environment schema. The application refuses to boot when the
 * environment is invalid — fail fast rather than mis-configure in production.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  TZ: z.string().default('UTC'),

  // Server
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  BACKEND_HOST: z.string().default('0.0.0.0'),
  API_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('1'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Rate limiting
  RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(120),

  // Swagger / logging
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SWAGGER_PATH: z.string().default('docs'),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'])
    .default('info'),

  // Database
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid connection string' }),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_URL: z.string().optional(),
  REDIS_TTL: z.coerce.number().int().nonnegative().default(3600),

  // Auth / JWT
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),
  AUTH_COOKIE_NAME: z.string().default('gp_refresh'),
  AUTH_COOKIE_DOMAIN: z.string().default('localhost'),
  AUTH_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  REMEMBER_ME_EXPIRES_IN: z.string().default('30d'),

  // Security policy
  ACCOUNT_LOCK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  ACCOUNT_LOCK_DURATION_MINUTES: z.coerce.number().int().positive().default(15),
  MAX_CONCURRENT_SESSIONS: z.coerce.number().int().positive().default(5),
  // Phase 2D.2 — server-authoritative idle-session expiry, in minutes.
  // 0 = DISABLED (the default). No business figure was supplied for this platform, so no
  // timeout is invented: with the variable unset, session behaviour is byte-for-byte what it
  // was before this phase. Set a positive value to enable. BUSINESS-CONFIG REQUIRED.
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(0).default(0),

  /**
   * Phase 2D.7 (Part B): the largest window a single analytics/report query may scan.
   *
   * This is an OPERATIONAL SAFEGUARD, not a business rule — it bounds how much data one request can
   * make the database aggregate. It is NOT derived from any client requirement. An over-long range
   * is REJECTED with a clear error; it is never silently truncated to this value, because partial
   * data presented as complete is worse than no data.
   */
  ANALYTICS_MAX_RANGE_DAYS: z.coerce.number().int().min(1).max(3660).default(366),
  PASSWORD_BREACH_CHECK_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  TWO_FACTOR_ISSUER: z.string().default('Gaming Platform'),

  // Application URLs (used in transactional emails)
  APP_WEB_URL: z.string().url().default('http://localhost:3000'),

  // Mailer (SMTP). When unset, emails are logged instead of sent.
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().int().positive().default(587),
  MAIL_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Gaming Platform <no-reply@gaming-platform.local>'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validator used by `@nestjs/config`. Throws an aggregated, readable error
 * when one or more variables are missing or malformed.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue: z.ZodIssue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`❌ Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}
