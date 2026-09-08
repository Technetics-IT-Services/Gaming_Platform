import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditEntity, AuditMutationInterceptor } from '../../security/audit-mutation.interceptor';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../authorization/rbac.constants';
import { CategoryService } from '../services/category.service';
import { CollectionService } from '../services/collection.service';
import { LauncherService } from '../services/launcher.service';
import { ProviderService } from '../services/provider.service';
import {
  CreateCategoryDto,
  CreateCollectionDto,
  CreateLauncherDto,
  CreateProviderDto,
  ReorderDto,
  SetCollectionGamesDto,
  UpdateCategoryDto,
  UpdateCollectionDto,
  UpdateLauncherDto,
  UpdateProviderDto,
} from '../dto/games-admin.dto';

@ApiTags('Admin · Categories')
@ApiBearerAuth()
@Controller('admin/game-categories')
// Phase 2D.2 (audit gap #18): every SUCCESSFUL mutating request here is recorded in the audit
// trail. One interceptor covers all mutation endpoints and cannot drift as routes are added.
@UseInterceptors(AuditMutationInterceptor)
@AuditEntity('game_catalog')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.GAMES_READ)
  @ApiOperation({ summary: 'List all categories' })
  list() {
    return this.categories.listFlat();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Create a category' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Reorder categories' })
  reorder(@Body() dto: ReorderDto) {
    return this.categories.reorder(dto.items);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Update a category' })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Delete a category' })
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}

@ApiTags('Admin · Providers')
@ApiBearerAuth()
@Controller('admin/game-providers')
export class AdminProvidersController {
  constructor(private readonly providers: ProviderService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.GAMES_READ)
  @ApiOperation({ summary: 'List providers' })
  list() {
    return this.providers.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Create a provider' })
  create(@Body() dto: CreateProviderDto) {
    return this.providers.create(dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Update a provider' })
  update(@Param('id') id: string, @Body() dto: UpdateProviderDto) {
    return this.providers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Delete a provider' })
  remove(@Param('id') id: string) {
    return this.providers.remove(id);
  }
}

@ApiTags('Admin · Collections')
@ApiBearerAuth()
@Controller('admin/game-collections')
export class AdminCollectionsController {
  constructor(private readonly collections: CollectionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.GAMES_READ)
  @ApiOperation({ summary: 'List collections' })
  list() {
    return this.collections.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Create a collection' })
  create(@Body() dto: CreateCollectionDto) {
    return this.collections.create(dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Update a collection' })
  update(@Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.collections.update(id, dto);
  }

  @Put(':id/games')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Set the games in a collection (ordered)' })
  setGames(@Param('id') id: string, @Body() dto: SetCollectionGamesDto) {
    return this.collections.setGames(id, dto.gameIds);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Delete a collection' })
  remove(@Param('id') id: string) {
    return this.collections.remove(id);
  }
}

@ApiTags('Admin · Launchers')
@ApiBearerAuth()
@Controller('admin/game-launchers')
export class AdminLaunchersController {
  constructor(private readonly launcher: LauncherService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.GAMES_READ)
  @ApiOperation({ summary: 'List registered launchers' })
  list() {
    return this.launcher.listLaunchers();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Register a launcher' })
  create(@Body() dto: CreateLauncherDto) {
    return this.launcher.createLauncher(dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Update a launcher' })
  update(@Param('id') id: string, @Body() dto: UpdateLauncherDto) {
    return this.launcher.updateLauncher(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.GAMES_WRITE)
  @ApiOperation({ summary: 'Remove a launcher' })
  remove(@Param('id') id: string) {
    return this.launcher.removeLauncher(id);
  }
}
