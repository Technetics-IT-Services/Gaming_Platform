import { Injectable, Logger } from '@nestjs/common';

import { DiceVariantService } from '../dice/services/dice-variant.service';
import { CrashVariantService } from '../crash/services/crash-variant.service';
import { RouletteVariantService } from '../roulette/services/roulette-variant.service';
import { CardVariantService } from '../card/services/card-variant.service';
import { LotteryDrawService } from './lottery-draw.service';

/**
 * Server-authoritative real-money game catalog (Phase 2C.8).
 *
 * Returns SAFE presentation/discovery metadata for the production real-money games — key, name,
 * category, route, real-money flag, currencies, server-controlled `enabled`/`maintenance`, and display
 * `limits`. It exposes NO seeds, secrets, internal financial state, or private operator config, and it
 * does NOT decide whether money moves — the per-game `config`/`play` endpoints remain the authority and
 * validate every stake. The client cannot flip `enabled`: a game listed as disabled (via
 * `CATALOG_DISABLED_GAMES`) is reported disabled and the lobby refuses to launch it; play-time
 * validation is the ultimate guard regardless.
 *
 * Limits are resolved LIVE from the same variant services the config endpoints use, with a safe
 * constant fallback; the per-game `config` endpoint remains the live source of truth.
 */

export type CatalogCategory = 'instant' | 'table' | 'card' | 'crash' | 'dice';
export type BridgeType = 'dice' | 'crash' | 'roulette' | 'lottery' | 'card' | 'plinko' | 'mines' | 'instant';

export interface CatalogGame {
  key: string;
  name: string;
  shortDescription: string;
  category: CatalogCategory;
  tags: string[];
  route: string;
  realMoney: true;
  multiplayer: boolean;
  engineKey: string;
  bridgeType: BridgeType;
  currencies: string[];
  popularity: number;
  isNew: boolean;
  featured: boolean;
  responsibleGamingEligible: true;
  sortOrder: number;
  enabled: boolean;
  maintenance: boolean;
  limits: { min: number; max: number };
}

interface Descriptor {
  key: string;
  name: string;
  shortDescription: string;
  category: CatalogCategory;
  tags: string[];
  route: string;
  multiplayer: boolean;
  engineKey: string;
  bridgeType: BridgeType;
  popularity: number;
  isNew: boolean;
  featured: boolean;
  sortOrder: number;
  /** How to resolve authoritative display limits. */
  limits: { kind: 'const'; min: number; max: number } | { kind: 'dice'; variant: string } | { kind: 'crash'; variant: string } | { kind: 'roulette'; variant: string } | { kind: 'card'; variant: string } | { kind: 'lottery' };
}

const FIXED = { kind: 'const', min: 1, max: 10000 } as const;

/** The canonical real-money catalog. Presentation metadata only — never payout/RTP math. */
const DESCRIPTORS: Descriptor[] = [
  { key: 'dice', name: 'Dice', shortDescription: 'Roll under/over a target', category: 'dice', tags: ['popular', 'classic'], route: '/dice-money', multiplayer: false, engineKey: 'dice', bridgeType: 'dice', popularity: 95, isNew: false, featured: true, sortOrder: 10, limits: { kind: 'dice', variant: 'dice' } },
  { key: 'crash', name: 'Crash', shortDescription: 'Cash out before the crash', category: 'crash', tags: ['popular', 'live'], route: '/crash-money', multiplayer: false, engineKey: 'crash', bridgeType: 'crash', popularity: 98, isNew: false, featured: true, sortOrder: 20, limits: { kind: 'crash', variant: 'crash' } },
  { key: 'roulette', name: 'Roulette', shortDescription: 'European single-zero wheel', category: 'table', tags: ['popular', 'table'], route: '/roulette-money', multiplayer: false, engineKey: 'roulette', bridgeType: 'roulette', popularity: 90, isNew: false, featured: true, sortOrder: 30, limits: { kind: 'roulette', variant: 'european' } },
  { key: 'sic-bo', name: 'Sic Bo', shortDescription: 'Three-dice betting board', category: 'dice', tags: ['table'], route: '/sic-bo-money', multiplayer: false, engineKey: 'dice', bridgeType: 'dice', popularity: 70, isNew: false, featured: false, sortOrder: 40, limits: { kind: 'dice', variant: 'sic-bo' } },
  { key: 'lottery', name: 'Number Lottery', shortDescription: 'Pick numbers for the shared draw', category: 'instant', tags: ['draw'], route: '/lottery-money', multiplayer: true, engineKey: 'lottery', bridgeType: 'lottery', popularity: 65, isNew: false, featured: false, sortOrder: 50, limits: { kind: 'lottery' } },
  { key: 'baccarat', name: 'Baccarat', shortDescription: 'Player vs Banker point total', category: 'card', tags: ['table', 'card'], route: '/baccarat-money', multiplayer: false, engineKey: 'card', bridgeType: 'card', popularity: 80, isNew: false, featured: false, sortOrder: 60, limits: { kind: 'card', variant: 'baccarat' } },
  { key: 'blackjack', name: 'Blackjack', shortDescription: 'Beat the dealer to 21', category: 'card', tags: ['popular', 'card'], route: '/blackjack-money', multiplayer: false, engineKey: 'card', bridgeType: 'card', popularity: 92, isNew: false, featured: true, sortOrder: 70, limits: { kind: 'card', variant: 'blackjack' } },
  { key: 'plinko', name: 'Plinko', shortDescription: 'Drop the ball, hit a multiplier', category: 'instant', tags: ['popular', 'arcade'], route: '/plinko-money', multiplayer: false, engineKey: 'plinko', bridgeType: 'plinko', popularity: 94, isNew: false, featured: true, sortOrder: 80, limits: FIXED },
  { key: 'mines', name: 'Mines', shortDescription: 'Reveal gems, dodge the mines', category: 'instant', tags: ['popular', 'arcade'], route: '/mines-money', multiplayer: false, engineKey: 'mines', bridgeType: 'mines', popularity: 93, isNew: false, featured: true, sortOrder: 90, limits: FIXED },
  { key: 'limbo', name: 'Limbo', shortDescription: 'Beat your target multiplier', category: 'instant', tags: ['new', 'instant'], route: '/limbo-money', multiplayer: false, engineKey: 'limbo', bridgeType: 'instant', popularity: 60, isNew: true, featured: false, sortOrder: 100, limits: FIXED },
  { key: 'coin-flip', name: 'Coin Flip', shortDescription: 'Call heads or tails', category: 'instant', tags: ['new', 'instant'], route: '/coin-flip-money', multiplayer: false, engineKey: 'coin-flip', bridgeType: 'instant', popularity: 55, isNew: true, featured: false, sortOrder: 110, limits: FIXED },
  { key: 'wheel', name: 'Wheel', shortDescription: 'Spin for a segment multiplier', category: 'instant', tags: ['new', 'instant'], route: '/wheel-money', multiplayer: false, engineKey: 'wheel', bridgeType: 'instant', popularity: 58, isNew: true, featured: false, sortOrder: 120, limits: FIXED },
  { key: 'dragon-tiger', name: 'Dragon Tiger', shortDescription: 'Higher card wins', category: 'card', tags: ['new', 'india', 'card'], route: '/dragon-tiger-money', multiplayer: false, engineKey: 'card', bridgeType: 'card', popularity: 75, isNew: true, featured: true, sortOrder: 130, limits: { kind: 'card', variant: 'dragon-tiger' } },
  { key: 'andar-bahar', name: 'Andar Bahar', shortDescription: 'Pick the winning side', category: 'card', tags: ['new', 'india', 'card'], route: '/andar-bahar-money', multiplayer: false, engineKey: 'card', bridgeType: 'card', popularity: 78, isNew: true, featured: true, sortOrder: 140, limits: { kind: 'card', variant: 'andar-bahar' } },
  { key: 'teen-patti', name: 'Teen Patti', shortDescription: 'Player vs dealer, best 3-card hand', category: 'card', tags: ['new', 'india', 'card'], route: '/teen-patti-money', multiplayer: false, engineKey: 'card', bridgeType: 'card', popularity: 85, isNew: true, featured: true, sortOrder: 150, limits: { kind: 'card', variant: 'teen-patti' } },
];

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly diceVariants: DiceVariantService,
    private readonly crashVariants: CrashVariantService,
    private readonly rouletteVariants: RouletteVariantService,
    private readonly cardVariants: CardVariantService,
    private readonly lottery: LotteryDrawService,
  ) {}

  /** Server-controlled disabled set (client cannot override). */
  private disabledKeys(): Set<string> {
    return new Set((process.env.CATALOG_DISABLED_GAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  }

  /** The full real-money catalog with server-authoritative enabled/maintenance + live display limits. */
  async list(): Promise<{ games: CatalogGame[]; categories: string[]; currencies: string[] }> {
    const disabled = this.disabledKeys();
    const games = await Promise.all(
      DESCRIPTORS.map(async (d) => {
        const limits = await this.resolveLimits(d);
        const enabled = !disabled.has(d.key);
        const { limits: _omit, ...meta } = d;
        return {
          ...meta,
          realMoney: true as const,
          currencies: ['INR'],
          responsibleGamingEligible: true as const,
          enabled,
          maintenance: !enabled,
          limits,
        } satisfies CatalogGame;
      }),
    );
    games.sort((a, b) => a.sortOrder - b.sortOrder);
    return { games, categories: ['instant', 'table', 'card', 'crash', 'dice'], currencies: ['INR'] };
  }

  /** Single game by key (or null). */
  async findByKey(key: string): Promise<CatalogGame | null> {
    const all = await this.list();
    return all.games.find((g) => g.key === key) ?? null;
  }

  /** Resolve authoritative display limits, falling back safely (per-game config remains the live authority). */
  private async resolveLimits(d: Descriptor): Promise<{ min: number; max: number }> {
    try {
      switch (d.limits.kind) {
        case 'const':
          return { min: d.limits.min, max: d.limits.max };
        case 'dice': {
          const rs = await this.diceVariants.resolve(d.limits.variant);
          return { min: Number(rs.limits.min), max: Number(rs.limits.max) };
        }
        case 'crash': {
          const rs = await this.crashVariants.resolve(d.limits.variant);
          return { min: Number(rs.limits.min), max: Number(rs.limits.max) };
        }
        case 'roulette': {
          const rs = await this.rouletteVariants.resolve(d.limits.variant);
          return { min: Number(rs.limits.min), max: Number(rs.limits.max) };
        }
        case 'card': {
          const rs = await this.cardVariants.resolve(d.limits.variant);
          return { min: Number(rs.betLimits.min), max: Number(rs.betLimits.max) };
        }
        case 'lottery': {
          const price = Number(this.lottery.config.ticketPrice);
          return { min: price, max: price };
        }
      }
    } catch (err) {
      this.logger.warn(`catalog: limits fallback for ${d.key}: ${(err as Error).message}`);
    }
    return { min: 1, max: 10000 };
  }
}
