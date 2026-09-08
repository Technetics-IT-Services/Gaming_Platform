import type { Env } from './env.validation';

/**
 * Namespaced, typed configuration tree derived from validated env vars.
 * Access via `ConfigService.get('app.port')`, etc.
 */
export interface AppConfig {
  env: Env['NODE_ENV'];
  name: string;
  host: string;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  swaggerPath: string;
  logLevel: Env['LOG_LEVEL'];
  webUrl: string;
}

export interface DatabaseConfig {
  url: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
  url?: string;
  ttl: number;
}

export interface AuthConfig {
  accessSecret: string;
  accessExpiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
  rememberMeExpiresIn: string;
  saltRounds: number;
  cookieName: string;
  cookieDomain: string;
  cookieSecure: boolean;
}

export interface AnalyticsConfig {
  /** Operational safeguard: largest window one analytics/report query may scan. */
  maxRangeDays: number;
}

export interface SecurityConfig {
  accountLockMaxAttempts: number;
  accountLockDurationMinutes: number;
  maxConcurrentSessions: number;
  /** 0 = idle expiry disabled. */
  sessionIdleTimeoutMinutes: number;
  passwordBreachCheckEnabled: boolean;
  emailVerificationTtlHours: number;
  passwordResetTtlMinutes: number;
  twoFactorIssuer: string;
}

export interface MailConfig {
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

export interface ThrottleConfig {
  ttl: number;
  limit: number;
}

export interface Configuration {
  app: AppConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  auth: AuthConfig;
  security: SecurityConfig;
  analytics: AnalyticsConfig;
  mail: MailConfig;
  throttle: ThrottleConfig;
}

export default (): Configuration => {
  const env = process.env as unknown as Env;

  return {
    app: {
      env: env.NODE_ENV,
      name: process.env.APP_NAME ?? 'gaming-platform',
      host: env.BACKEND_HOST,
      port: Number(env.BACKEND_PORT),
      apiPrefix: env.API_PREFIX,
      apiVersion: env.API_VERSION,
      corsOrigins: String(env.CORS_ORIGINS)
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      swaggerEnabled: Boolean(env.SWAGGER_ENABLED),
      swaggerPath: env.SWAGGER_PATH,
      logLevel: env.LOG_LEVEL,
      webUrl: env.APP_WEB_URL,
    },
    database: {
      url: env.DATABASE_URL,
    },
    redis: {
      host: env.REDIS_HOST,
      port: Number(env.REDIS_PORT),
      password: env.REDIS_PASSWORD ?? '',
      url: env.REDIS_URL,
      ttl: Number(env.REDIS_TTL),
    },
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
      rememberMeExpiresIn: env.REMEMBER_ME_EXPIRES_IN,
      saltRounds: Number(env.BCRYPT_SALT_ROUNDS),
      cookieName: env.AUTH_COOKIE_NAME,
      cookieDomain: env.AUTH_COOKIE_DOMAIN,
      // `env` here is raw process.env (strings), so `Boolean('false')` was always truthy — the
      // AUTH_COOKIE_SECURE flag was silently ignored (cookie always Secure). Compare the string
      // explicitly so the documented `true`/`false` values actually take effect. Production sets
      // `AUTH_COOKIE_SECURE=true` → cookie stays Secure (unchanged); this only makes `=false` work
      // for plain-HTTP dev/staging/TLS-terminating-proxy deployments. (Phase 2C.13 config-correctness fix.)
      cookieSecure: String(env.AUTH_COOKIE_SECURE) === 'true',
    },
    security: {
      accountLockMaxAttempts: Number(env.ACCOUNT_LOCK_MAX_ATTEMPTS),
      accountLockDurationMinutes: Number(env.ACCOUNT_LOCK_DURATION_MINUTES),
      maxConcurrentSessions: Number(env.MAX_CONCURRENT_SESSIONS),
      // 0 = idle expiry disabled (default). See env.validation.ts.
      sessionIdleTimeoutMinutes: Number(env.SESSION_IDLE_TIMEOUT_MINUTES ?? 0),
      passwordBreachCheckEnabled: Boolean(env.PASSWORD_BREACH_CHECK_ENABLED),
      emailVerificationTtlHours: Number(env.EMAIL_VERIFICATION_TTL_HOURS),
      passwordResetTtlMinutes: Number(env.PASSWORD_RESET_TTL_MINUTES),
      twoFactorIssuer: env.TWO_FACTOR_ISSUER,
    },
    analytics: {
      maxRangeDays: Number(env.ANALYTICS_MAX_RANGE_DAYS ?? 366),
    },
    mail: {
      host: env.MAIL_HOST,
      port: Number(env.MAIL_PORT),
      secure: Boolean(env.MAIL_SECURE),
      user: env.MAIL_USER,
      password: env.MAIL_PASSWORD,
      from: env.MAIL_FROM,
    },
    throttle: {
      ttl: Number(env.RATE_LIMIT_TTL),
      limit: Number(env.RATE_LIMIT_LIMIT),
    },
  };
};
