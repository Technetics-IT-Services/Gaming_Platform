import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KycLevel, KycStatus, DocumentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength,
  Min, MinLength, ValidateNested,
} from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { KycService, MAX_DOCUMENT_BYTES } from './kyc.service';

/* -------------------------------------------------------------------- DTOs */

export class KycDocumentDto {
  @IsEnum(DocumentType) type!: DocumentType;
  @IsString() @MinLength(1) @MaxLength(200) fileName!: string;
  @IsString() @MinLength(3) @MaxLength(100) mimeType!: string;
  @IsInt() @Min(1) @Max(MAX_DOCUMENT_BYTES) size!: number;
  @IsOptional() @IsString() @MaxLength(128) checksum?: string;
}

/**
 * A submission carries a level and document METADATA. It deliberately has no status, reviewer,
 * verified or approved field — the global validation pipe runs `forbidNonWhitelisted`, so a client
 * sending `status=APPROVED`, `reviewedBy=...` or `verification=true` gets a 400 and can never
 * influence the decision.
 */
export class SubmitKycDto {
  @IsEnum(KycLevel) level!: KycLevel;

  @ValidateNested({ each: true })
  @Type(() => KycDocumentDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  documents!: KycDocumentDto[];
}

export class ReviewKycDto {
  @IsEnum(['IN_REVIEW', 'APPROVED', 'REJECTED'] as unknown as object)
  decision!: 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?: string;
}

export class ListKycDto {
  @IsOptional() @IsEnum(KycStatus) status?: KycStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/* -------------------------------------------------------------- player API */

/**
 * KYC — the PLAYER's own verification.
 *
 * Both routes are scoped to `@CurrentUser('id')`. **No route accepts a user id**, so one player can
 * never read or submit against another's application: the IDOR surface is closed by construction.
 */
@ApiTags('KYC')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @ApiOperation({ summary: "The caller's own KYC status, documents and rejection reason" })
  status(@CurrentUser('id') userId: string) {
    return this.kyc.myStatus(userId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit or resubmit identity verification (document metadata)' })
  submit(@CurrentUser('id') userId: string, @Body() dto: SubmitKycDto) {
    return this.kyc.submit(userId, dto.level, dto.documents);
  }
}

/* --------------------------------------------------------------- admin API */

/**
 * KYC review — operators only, behind the EXISTING `users:verify` permission.
 *
 * `users:verify` already exists and is exactly "may verify a user's identity", so no new permission
 * was invented. It is held by `admin` and `super_admin`; `moderator` does NOT hold it and is refused.
 * Every decision is written to the shared audit trail with actor, subject, old and new status.
 */
@ApiTags('KYC')
@ApiBearerAuth()
@Controller('admin/kyc')
@RequirePermissions(PERMISSIONS.USERS_VERIFY)
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @ApiOperation({ summary: 'KYC queue — filter by status, paginated' })
  list(@Query() query: ListKycDto) {
    return this.kyc.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One KYC application for review' })
  get(@Param('id') id: string) {
    return this.kyc.getForReview(id);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take under review, approve, or reject (audited)' })
  review(@Param('id') id: string, @CurrentUser('id') reviewerUserId: string, @Body() dto: ReviewKycDto) {
    return this.kyc.review({ id, reviewerUserId, decision: dto.decision, reason: dto.reason });
  }
}
