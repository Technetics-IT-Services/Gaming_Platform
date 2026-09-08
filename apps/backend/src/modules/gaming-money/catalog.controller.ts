import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CatalogService } from './catalog.service';

/**
 * Real-money game catalog (Phase 2C.8) — server-authoritative discovery metadata for the mobile lobby.
 *
 * A distinct `/catalog` path (not `/games/*`) so it never collides with the money `games/<game>/*`
 * routes or the generic `games/:slug` catalog. Authenticated (inherits the app's JWT guard); exposes
 * only safe metadata — no seeds, secrets, or internal financial state. `enabled`/`maintenance` are
 * server-controlled; the client cannot unlock a disabled game, and every stake is still validated by
 * the per-game money endpoints.
 */
@ApiTags('Games (catalog)')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'Real-money game catalog (safe metadata + server-authoritative availability + limits)' })
  list() {
    return this.catalog.list();
  }

  @Get(':key')
  @ApiOperation({ summary: 'A single real-money game by key' })
  async findOne(@Param('key') key: string) {
    const game = await this.catalog.findByKey(key);
    if (!game) throw new NotFoundException(`Unknown game "${key}"`);
    return game;
  }
}
