import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { NotificationsService } from './notifications.service';

/**
 * Player notification API (Phase 2D.1).
 *
 * Every route is authenticated by the global `JwtAuthGuard` and USER-SCOPED: the recipient is always
 * `@CurrentUser('id')`, taken from the verified JWT. There is no route that accepts a `userId`, so a
 * client cannot read or mutate another player's notifications, and no admin notification surface is
 * exposed (the client requirement does not ask for notification administration).
 *
 * Route order matters: `read-all` and `unread-count` are declared BEFORE `:id` so they are not
 * captured by the parameterised route.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated user notifications (newest first, paginated)' })
  list(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.notificationsService.listForUser(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count for the authenticated user' })
  unreadCount(@CurrentUser('id') userId: string) {
    return this.notificationsService.unreadCount(userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every unread notification read for the authenticated user' })
  markAllRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one notification owned by the authenticated user' })
  get(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.getForUser(userId, id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.markAsRead(userId, id);
  }
}
