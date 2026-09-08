import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, SettingValueType } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../security/audit.service';
import {
  SETTINGS_REGISTRY,
  SETTING_KEYS,
  settingDefinition,
  type SettingDefinition,
} from './settings.registry';

/**
 * Platform settings (AD-09).
 *
 * SAFETY MODEL: the registry is an ALLOW-LIST, and it is consulted before the database on every
 * path. An unknown key cannot be read or written — not filtered out afterwards, but rejected before
 * any query runs. That is what makes it impossible to reach game-variant or financial configuration
 * through this API.
 *
 * Storage is `SystemSetting`, which had no writer before this. `ApplicationSetting` — which holds
 * live real-money game variant configuration — is deliberately never touched.
 *
 * Settings always resolve: a key with no stored row returns its registry default, so there is no
 * undefined state a consumer has to guess about.
 */

export interface SettingView {
  key: string;
  value: string | boolean | number;
  type: SettingDefinition['type'];
  description: string;
  isPublic: boolean;
  requiresRestart: boolean;
  /** True when a row exists; false means the registry default is being served. */
  isCustomised: boolean;
  updatedAt: string | null;
}

const TYPE_MAP: Record<SettingDefinition['type'], SettingValueType> = {
  STRING: SettingValueType.STRING,
  BOOLEAN: SettingValueType.BOOLEAN,
  INTEGER: SettingValueType.NUMBER,
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Coerce and validate a raw client value against its definition.
   *
   * Returns the typed value or throws. Every branch is explicit — an unparseable value is a 400,
   * never a silent coercion to `0`, `false` or `""`.
   */
  private validate(def: SettingDefinition, raw: unknown): string | boolean | number {
    if (def.type === 'BOOLEAN') {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new BadRequestException(`${def.key} must be a boolean.`);
    }

    if (def.type === 'INTEGER') {
      const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
      if (!Number.isInteger(n)) throw new BadRequestException(`${def.key} must be a whole number.`);
      if (def.min !== undefined && n < def.min) {
        throw new BadRequestException(`${def.key} must be at least ${def.min}.`);
      }
      if (def.max !== undefined && n > def.max) {
        throw new BadRequestException(`${def.key} must be at most ${def.max}.`);
      }
      return n;
    }

    if (typeof raw !== 'string') throw new BadRequestException(`${def.key} must be a string.`);
    const s = raw.trim();
    if (def.maxLength !== undefined && s.length > def.maxLength) {
      throw new BadRequestException(`${def.key} must be at most ${def.maxLength} characters.`);
    }
    return s;
  }

  private view(def: SettingDefinition, row: { value: Prisma.JsonValue; updatedAt: Date } | undefined): SettingView {
    return {
      key: def.key,
      value: row ? (row.value as string | boolean | number) : def.defaultValue,
      type: def.type,
      description: def.description,
      isPublic: def.isPublic,
      requiresRestart: def.requiresRestart,
      isCustomised: !!row,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /** Rows for the allow-listed keys only. Anything else in the table is ignored by construction. */
  private async storedRows() {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { in: SETTING_KEYS } } });
    return new Map(rows.map((r) => [r.key, r]));
  }

  /* ------------------------------------------------------------------ read */

  /** Every allow-listed setting, with its metadata. Operator view. */
  async listAll(): Promise<SettingView[]> {
    const stored = await this.storedRows();
    return SETTING_KEYS.map((k) => this.view(SETTINGS_REGISTRY[k]!, stored.get(k)));
  }

  /**
   * The public subset, for unauthenticated consumers.
   *
   * Filtered from the REGISTRY (`isPublic`), not from the database, so a row that somehow existed
   * for a non-public key could never leak.
   */
  async listPublic(): Promise<Record<string, string | boolean | number>> {
    const stored = await this.storedRows();
    const out: Record<string, string | boolean | number> = {};
    for (const key of SETTING_KEYS) {
      const def = SETTINGS_REGISTRY[key]!;
      if (!def.isPublic) continue;
      const row = stored.get(key);
      out[key] = row ? (row.value as string | boolean | number) : def.defaultValue;
    }
    return out;
  }

  async get(key: string): Promise<SettingView> {
    const def = settingDefinition(key);
    if (!def) throw new BadRequestException(`Unknown setting: ${key}`);
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return this.view(def, row ?? undefined);
  }

  /** Typed accessor for other services. Falls back to the registry default. */
  async value<T extends string | boolean | number>(key: string): Promise<T> {
    return (await this.get(key)).value as T;
  }

  /* ----------------------------------------------------------------- write */

  /**
   * Change one setting.
   *
   * `actorPermissions` is the caller's backend-resolved permission list; the per-setting
   * `writePermission` is checked here as well as by the controller guard, so a future route cannot
   * accidentally bypass a stricter per-key requirement.
   */
  async set(input: {
    key: string;
    value: unknown;
    actorUserId: string;
    actorPermissions: string[];
  }): Promise<SettingView> {
    const def = settingDefinition(input.key);
    // Rejected BEFORE any database access — the allow-list is the boundary.
    if (!def) throw new BadRequestException(`Unknown setting: ${input.key}`);

    if (!input.actorPermissions.includes(def.writePermission)) {
      throw new ForbiddenException(`Changing ${def.key} requires ${def.writePermission}.`);
    }

    const value = this.validate(def, input.value);
    const before = await this.prisma.systemSetting.findUnique({ where: { key: def.key } });

    const row = await this.prisma.systemSetting.upsert({
      where: { key: def.key },
      update: { value: value as Prisma.InputJsonValue, valueType: TYPE_MAP[def.type], isPublic: def.isPublic },
      create: {
        key: def.key,
        value: value as Prisma.InputJsonValue,
        valueType: TYPE_MAP[def.type],
        description: def.description,
        isPublic: def.isPublic,
      },
    });

    await this.audit.record({
      userId: input.actorUserId,
      action: 'UPDATE',
      entityType: 'system_setting',
      entityId: def.key,
      changes: {
        key: def.key,
        // Before/after are safe to record: no secret is on the allow-list.
        from: before ? before.value : def.defaultValue,
        to: value,
        requiresRestart: def.requiresRestart,
      },
    });

    return this.view(def, row);
  }

  /** Restore a setting to its registry default by removing the stored override. */
  async reset(key: string, actorUserId: string, actorPermissions: string[]): Promise<SettingView> {
    const def = settingDefinition(key);
    if (!def) throw new BadRequestException(`Unknown setting: ${key}`);
    if (!actorPermissions.includes(def.writePermission)) {
      throw new ForbiddenException(`Changing ${def.key} requires ${def.writePermission}.`);
    }

    const before = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (before) await this.prisma.systemSetting.delete({ where: { key } });

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'system_setting',
      entityId: key,
      changes: { key, from: before ? before.value : def.defaultValue, to: def.defaultValue, reset: true },
    });

    return this.view(def, undefined);
  }
}
