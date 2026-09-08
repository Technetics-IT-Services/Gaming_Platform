import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { SupportService } from './support.service';

/* -------------------------------------------------------------------- DTOs */

/**
 * A player creates a ticket with a subject, category and first message.
 *
 * It deliberately has NO status, priority, assignee, isFromAgent or userId field. The global
 * validation pipe runs `forbidNonWhitelisted`, so sending any of those is a 400 — a player cannot
 * self-assign URGENT, post as an agent, or open a ticket on someone else's account.
 */
export class CreateTicketDto {
  @IsString() @MinLength(3) @MaxLength(150) subject!: string;
  @IsEnum(SupportTicketCategory) category!: SupportTicketCategory;
  @IsString() @MinLength(1) @MaxLength(5000) message!: string;
}

export class ReplyDto {
  @IsString() @MinLength(1) @MaxLength(5000) message!: string;
}

export class AgentReplyDto extends ReplyDto {
  /** An internal note is never shown to the player and never notifies them. */
  @IsOptional() @IsBoolean() internal?: boolean;
}

export class PageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class QueueDto extends PageDto {
  @IsOptional() @IsEnum(SupportTicketStatus) status?: SupportTicketStatus;
  @IsOptional() @IsEnum(SupportTicketPriority) priority?: SupportTicketPriority;
  @IsOptional() @IsEnum(SupportTicketCategory) category?: SupportTicketCategory;
  @IsOptional() @IsUUID() assignedToUserId?: string;
}

export class SetStatusDto {
  @IsEnum(SupportTicketStatus) status!: SupportTicketStatus;
}

export class SetPriorityDto {
  @IsEnum(SupportTicketPriority) priority!: SupportTicketPriority;
}

export class AssignDto {
  /** Omit to unassign. */
  @IsOptional() @IsUUID() assigneeUserId?: string;
}

/* -------------------------------------------------------------- player API */

/**
 * Support — the PLAYER's own tickets.
 *
 * Every route is scoped to `@CurrentUser('id')` and the service filters on that id INSIDE the
 * database query. No route accepts a user id, and no code path loads a ticket without the owner
 * filter, so cross-player access is impossible by construction rather than by a check.
 */
@ApiTags('Support')
@ApiBearerAuth()
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiOperation({ summary: 'The callers own tickets' })
  list(@CurrentUser('id') userId: string, @Query() q: PageDto) {
    return this.support.listMine(userId, q.page, q.limit);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open a support ticket' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateTicketDto) {
    return this.support.create({ userId, ...dto });
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of the callers tickets, with its conversation' })
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.support.getMine(userId, id);
  }

  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reply to your own ticket' })
  reply(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.support.replyAsPlayer(userId, id, dto.message);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close your own ticket' })
  close(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.support.closeMine(userId, id);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen your own closed ticket' })
  reopen(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.support.reopenMine(userId, id);
  }
}

/* --------------------------------------------------------------- agent API */

/**
 * Support — the OPERATOR queue.
 *
 * Guarded by the new narrow `support:read` / `support:write` pair. A support agent needs neither
 * `users:write` (too broad) nor any wallet permission, so those were not reused. `moderator`,
 * `admin` and `super_admin` hold them; an ordinary player holds none and is refused.
 */
@ApiTags('Support')
@ApiBearerAuth()
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SUPPORT_READ)
  @ApiOperation({ summary: 'Ticket queue — filter by status/priority/category/assignee' })
  queue(@Query() q: QueueDto) {
    return this.support.queue(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SUPPORT_READ)
  @ApiOperation({ summary: 'One ticket, including internal notes' })
  get(@Param('id') id: string) {
    return this.support.getForAgent(id);
  }

  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SUPPORT_WRITE)
  @ApiOperation({ summary: 'Reply as support (or add an internal note)' })
  reply(@CurrentUser('id') agentUserId: string, @Param('id') id: string, @Body() dto: AgentReplyDto) {
    return this.support.replyAsAgent(agentUserId, id, dto.message, dto.internal === true);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SUPPORT_WRITE)
  @ApiOperation({ summary: 'Assign or unassign a ticket' })
  assign(@CurrentUser('id') agentUserId: string, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.support.assign(agentUserId, id, dto.assigneeUserId ?? null);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SUPPORT_WRITE)
  @ApiOperation({ summary: 'Change ticket status (audited, notifies the player)' })
  status(@CurrentUser('id') agentUserId: string, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.support.setStatus(agentUserId, id, dto.status);
  }

  @Post(':id/priority')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SUPPORT_WRITE)
  @ApiOperation({ summary: 'Triage priority' })
  priority(@CurrentUser('id') agentUserId: string, @Param('id') id: string, @Body() dto: SetPriorityDto) {
    return this.support.setPriority(agentUserId, id, dto.priority);
  }
}
