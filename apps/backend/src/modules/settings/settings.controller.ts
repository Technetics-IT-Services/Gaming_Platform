import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { SettingsService } from './settings.service';

/**
 * A setting change carries ONLY a value.
 *
 * The key comes from the URL and is checked against the allow-list; `type`, `isPublic`,
 * `requiresRestart` and `description` are registry facts and are never accepted from a client. The
 * global pipe runs `forbidNonWhitelisted`, so sending any of them is a 400.
 */
export class SetSettingDto {
  @IsDefined() value!: string | boolean | number;
}

/**
 * Public settings — the only unauthenticated surface.
 *
 * Returns the `isPublic` subset chosen from the REGISTRY, never from the database, so a stray row
 * for a non-public key could not leak. Nothing sensitive is on the allow-list at all.
 */
@ApiTags('Settings')
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('public')
  @Public()
  @ApiOperation({ summary: 'Publicly readable platform settings (support contact, maintenance notice)' })
  publicSettings() {
    return this.settings.listPublic();
  }
}

/**
 * Operator settings administration (AD-09).
 *
 * READ needs `settings:read` (admin + super-admin). WRITE needs `settings:write`, which only
 * `super_admin` holds. The service re-checks the per-setting `writePermission` as well, so a future
 * route cannot bypass a stricter per-key rule.
 *
 * Only allow-listed keys exist here. Game-variant, wallet, payout, settlement, responsible-gaming
 * and session-security configuration are deliberately NOT exposed — see `settings.registry.ts`.
 */
@ApiTags('Settings')
@ApiBearerAuth()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'All manageable settings with their metadata and defaults' })
  list() {
    return this.settings.listAll();
  }

  @Get(':key')
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'One setting' })
  get(@Param('key') key: string) {
    return this.settings.get(key);
  }

  @Post(':key')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Change a setting (allow-listed keys only, audited)' })
  set(
    @Param('key') key: string,
    @CurrentUser() user: { id: string; permissions?: string[] },
    @Body() dto: SetSettingDto,
  ) {
    return this.settings.set({
      key,
      value: dto.value,
      actorUserId: user.id,
      actorPermissions: user.permissions ?? [],
    });
  }

  @Post(':key/reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Restore a setting to its built-in default (audited)' })
  reset(@Param('key') key: string, @CurrentUser() user: { id: string; permissions?: string[] }) {
    return this.settings.reset(key, user.id, user.permissions ?? []);
  }
}
