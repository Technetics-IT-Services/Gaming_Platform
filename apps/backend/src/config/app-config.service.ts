import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  AnalyticsConfig,
  AppConfig,
  AuthConfig,
  Configuration,
  DatabaseConfig,
  MailConfig,
  RedisConfig,
  SecurityConfig,
  ThrottleConfig,
} from './configuration';

/**
 * Strongly-typed facade over Nest's `ConfigService`. Inject this instead of
 * the raw service to get autocompletion and avoid stringly-typed lookups.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Configuration, true>) {}

  get app(): AppConfig {
    return this.config.get('app', { infer: true });
  }

  get database(): DatabaseConfig {
    return this.config.get('database', { infer: true });
  }

  get redis(): RedisConfig {
    return this.config.get('redis', { infer: true });
  }

  get auth(): AuthConfig {
    return this.config.get('auth', { infer: true });
  }

  get security(): SecurityConfig {
    return this.config.get('security', { infer: true });
  }

  get analytics(): AnalyticsConfig {
    return this.config.get('analytics', { infer: true });
  }

  get mail(): MailConfig {
    return this.config.get('mail', { infer: true });
  }

  get throttle(): ThrottleConfig {
    return this.config.get('throttle', { infer: true });
  }

  get isProduction(): boolean {
    return this.app.env === 'production';
  }

  get isDevelopment(): boolean {
    return this.app.env === 'development';
  }
}
