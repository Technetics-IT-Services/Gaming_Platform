import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GameStatus } from '@prisma/client';

import { AuditEntity, AuditMutationInterceptor } from '../../security/audit-mutation.interceptor';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PERMISSIONS } from '../../authorization/rbac.constants';
import { AssetService } from '../services/asset.service';
import { GameAdminService } from '../services/game-admin.service';
import {
  AddVersionDto,
  CreateAssetDto,
  CreateGameDto,
  ReorderDto,
  ScheduleDto,
  SetFlagsDto,
  SetMaintenanceDto,
  SetStatusDto,
  SetTrendingDto,
  SetVisibilityDto,
  UpdateGameDto,
} from '../dto/games-admin.dto';

@ApiTags('Admin · Games')
@ApiBearerAuth()
@Controller('admin/games')
// Phase 2D.2 (audit gap #18): every SUCCESSFUL mutating request here is recorded in the audit
// trail. One interceptor covers all mutation endpoints and cannot drift as routes are added.
@UseInterceptors(AuditMutationInterceptor)
@AuditEntity('game')
export class AdminGamesController {
  constructor(
    private readonly games: GameAdminService,
    private readonly assets: AssetService,
  ) {}

  @Get('statistics')
  @RequirePermissions(PERMISSIONS.GAMES_READ)
  @ApiOperation({ summary: 'Catalog statistics' })
  statistics() {
    return this.games.statistics();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.GAMES_READ)
  @ApiOperation({ summary: 'List games (all statuses, paginated)' })
  @ApiQuery({ name: 'status', required: false, enum: GameStatus })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'provider', required: false })
  list(
    @Query() query: PaginationQueryDto,
    @Query('status') status?: GameStatus,
    @Query('category') category?: string,
    @Query('provider') provider?: string,
  ) {
    return this.games.list({
      page: query.page,
      limit: query.limit,
      search: query.search,
      status,
      categorySlug: category,
      providerCode: provider,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.GAMES_READ)
  @ApiOperation({ summary: 'Get a game for editing' })
  get(@Param('id') id: string) {
    return this.games.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Create a game (metadata only)' })
  create(@Body() dto: CreateGameDto) {
    return this.games.create(dto);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Reorder games by display order' })
  reorder(@Body() dto: ReorderDto) {
    return this.games.reorder(dto.items);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Update game metadata' })
  update(@Param('id') id: string, @Body() dto: UpdateGameDto) {
    return this.games.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Change game status' })
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.games.setStatus(id, dto.status);
  }

  @Patch(':id/visibility')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Change game visibility' })
  setVisibility(@Param('id') id: string, @Body() dto: SetVisibilityDto) {
    return this.games.setVisibility(id, dto.visibility);
  }

  @Patch(':id/flags')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Toggle featured / new flags' })
  setFlags(@Param('id') id: string, @Body() dto: SetFlagsDto) {
    return this.games.setFlags(id, dto);
  }

  @Patch(':id/trending')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Set trending state and score' })
  setTrending(@Param('id') id: string, @Body() dto: SetTrendingDto) {
    return this.games.setTrending(id, dto.isTrending, dto.trendingScore);
  }

  @Patch(':id/maintenance')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Toggle maintenance mode' })
  setMaintenance(@Param('id') id: string, @Body() dto: SetMaintenanceDto) {
    return this.games.setMaintenance(id, dto.enabled, dto.message);
  }

  @Patch(':id/schedule')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Schedule publish / availability window' })
  schedule(@Param('id') id: string, @Body() dto: ScheduleDto) {
    return this.games.schedule(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Soft-delete a game' })
  remove(@Param('id') id: string) {
    return this.games.remove(id);
  }

  // ---- Versions ------------------------------------------------------------

  @Get(':id/versions')
  @RequirePermissions(PERMISSIONS.GAMES_READ)
  @ApiOperation({ summary: 'List version history' })
  versions(@Param('id') id: string) {
    return this.games.listVersions(id);
  }

  @Post(':id/versions')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Publish a new version / release notes' })
  addVersion(@Param('id') id: string, @Body() dto: AddVersionDto) {
    return this.games.addVersion(id, dto);
  }

  // ---- Assets --------------------------------------------------------------

  @Get(':id/assets')
  @RequirePermissions(PERMISSIONS.GAMES_READ)
  @ApiOperation({ summary: 'List game assets' })
  listAssets(@Param('id') id: string) {
    return this.assets.list(id);
  }

  @Post(':id/assets')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Attach an asset (thumbnail, banner, video, …)' })
  addAsset(@Param('id') id: string, @Body() dto: CreateAssetDto) {
    return this.assets.add(id, dto);
  }

  @Delete(':id/assets/:assetId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Remove an asset' })
  removeAsset(@Param('id') id: string, @Param('assetId') assetId: string) {
    return this.assets.remove(id, assetId);
  }
}
