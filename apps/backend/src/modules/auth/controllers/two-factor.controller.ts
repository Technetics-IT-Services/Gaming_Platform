import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, TwoFactorSetup, TwoFactorStatus } from '@gaming-platform/types';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ReqMeta } from '../../../common/decorators/request-meta.decorator';
import type { RequestMeta } from '../../../common/security/request-meta';
import { TwoFactorCodeDto } from '../dto/auth-flow.dto';
import { TwoFactorService } from '../services/two-factor.service';

@ApiTags('Two-Factor Authentication')
@ApiBearerAuth()
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Begin TOTP setup — returns a QR code and secret' })
  setup(@CurrentUser() user: AuthenticatedUser): Promise<TwoFactorSetup> {
    return this.twoFactor.generateSetup(user.id, user.email);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a code, enable 2FA, and receive recovery codes' })
  enable(@CurrentUser('id') userId: string, @Body() dto: TwoFactorCodeDto, @ReqMeta() meta: RequestMeta) {
    return this.twoFactor.enable(userId, dto.code, meta);
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable two-factor authentication' })
  disable(@CurrentUser('id') userId: string, @Body() dto: TwoFactorCodeDto, @ReqMeta() meta: RequestMeta) {
    return this.twoFactor.disable(userId, dto.code, meta);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get two-factor status' })
  status(@CurrentUser('id') userId: string): Promise<TwoFactorStatus> {
    return this.twoFactor.status(userId);
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate recovery codes' })
  regenerate(@CurrentUser('id') userId: string, @Body() dto: TwoFactorCodeDto) {
    return this.twoFactor.regenerateRecoveryCodes(userId, dto.code);
  }
}
