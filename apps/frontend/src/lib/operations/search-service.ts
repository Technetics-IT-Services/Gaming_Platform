/**
 * Player search (Phase 6A, STEP 3).
 *
 * A back-office player directory/index. Real deployments feed it from the player
 * platform; here it is an in-memory index supporting substring match on id/username/
 * email with cursor pagination. Read-only — it indexes identifiers, never PII secrets.
 */
import { type Page } from './types';

export interface PlayerIndexEntry {
  playerId: string;
  username?: string;
  /** Masked email for display (never the raw value). */
  emailMasked?: string;
  registeredAt?: number;
}

export class SearchService {
  private readonly index = new Map<string, PlayerIndexEntry>();

  /** Register/refresh a player in the directory (fed from the player platform). */
  register(entry: PlayerIndexEntry): void {
    this.index.set(entry.playerId, { ...this.index.get(entry.playerId), ...entry });
  }

  size(): number {
    return this.index.size;
  }

  /** All known player ids (back-office aggregation over a bounded directory). */
  allIds(): string[] {
    return [...this.index.keys()];
  }

  /** Substring search over id/username/email with stable-ordered cursor paging. */
  search(query: { text?: string; limit?: number; cursor?: string } = {}): Page<PlayerIndexEntry> {
    const text = query.text?.trim().toLowerCase();
    const limit = query.limit ?? 25;
    let all = [...this.index.values()];
    if (text) {
      all = all.filter((e) => `${e.playerId} ${e.username ?? ''} ${e.emailMasked ?? ''}`.toLowerCase().includes(text));
    }
    all = all.sort((a, b) => a.playerId.localeCompare(b.playerId));
    let start = 0;
    if (query.cursor) {
      const idx = all.findIndex((e) => e.playerId === query.cursor);
      if (idx >= 0) start = idx + 1;
    }
    const items = all.slice(start, start + limit);
    const nextIndex = start + limit;
    return { items, total: all.length, nextCursor: nextIndex < all.length ? items[items.length - 1]?.playerId : undefined };
  }
}
