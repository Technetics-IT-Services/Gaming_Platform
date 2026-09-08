import { apiClient, unwrap } from './api-client';

/**
 * Game catalog administration client (Phase 2D.13, AD-03).
 *
 * Four guarded backend surfaces — categories, providers, collections and launchers, 18 routes in
 * total — had no frontend at all, so an operator could not organise the game catalogue inside the
 * product. This is the last requirement whose remaining work was pure engineering.
 *
 * PERMISSIONS: reading needs `games:read`; every mutation needs `games:write`. The backend already
 * wraps these routes in an audit interceptor, so each change is attributed to the operator.
 *
 * NOTHING HERE TOUCHES MONEY. A category, provider, collection or launcher is presentation and
 * routing metadata; it sets no odds, no RTP, no stake limit and no payout. Game *variant*
 * configuration — the money-affecting part — remains on its own surfaces and is deliberately not
 * reachable from this client.
 */

export interface GameCategory {
  id: string;
  name: string;
  slug?: string;
  parentId?: string | null;
  description?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  gameCount?: number;
}

export interface GameProvider {
  id: string;
  name: string;
  code?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  isActive?: boolean;
  gameCount?: number;
}

export interface GameCollection {
  id: string;
  name: string;
  description?: string | null;
  isFeatured?: boolean;
  displayOrder?: number;
  isActive?: boolean;
  gameCount?: number;
}

export interface GameLauncher {
  id: string;
  key: string;
  name: string;
  type?: string;
  isActive?: boolean;
}

/** Anything the API returns as either a bare array or a paginated envelope. */
const asList = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  const env = value as { items?: T[] } | null;
  return env?.items ?? [];
};

export const gameCatalogApi = {
  categories: () => unwrap<unknown>(apiClient.get('/admin/game-categories')).then(asList<GameCategory>),
  createCategory: (input: { name: string; description?: string; displayOrder?: number }) =>
    unwrap<GameCategory>(apiClient.post('/admin/game-categories', input)),
  updateCategory: (id: string, input: { name?: string; description?: string; isActive?: boolean }) =>
    unwrap<GameCategory>(apiClient.patch(`/admin/game-categories/${id}`, input)),
  deleteCategory: (id: string) => unwrap<unknown>(apiClient.delete(`/admin/game-categories/${id}`)),

  providers: () => unwrap<unknown>(apiClient.get('/admin/game-providers')).then(asList<GameProvider>),
  createProvider: (input: { name: string; code?: string; website?: string }) =>
    unwrap<GameProvider>(apiClient.post('/admin/game-providers', input)),
  updateProvider: (id: string, input: { name?: string; code?: string; website?: string }) =>
    unwrap<GameProvider>(apiClient.patch(`/admin/game-providers/${id}`, input)),
  deleteProvider: (id: string) => unwrap<unknown>(apiClient.delete(`/admin/game-providers/${id}`)),

  collections: () => unwrap<unknown>(apiClient.get('/admin/game-collections')).then(asList<GameCollection>),
  createCollection: (input: { name: string; description?: string; isFeatured?: boolean }) =>
    unwrap<GameCollection>(apiClient.post('/admin/game-collections', input)),
  updateCollection: (id: string, input: { name?: string; description?: string; isFeatured?: boolean; isActive?: boolean }) =>
    unwrap<GameCollection>(apiClient.patch(`/admin/game-collections/${id}`, input)),
  deleteCollection: (id: string) => unwrap<unknown>(apiClient.delete(`/admin/game-collections/${id}`)),

  launchers: () => unwrap<unknown>(apiClient.get('/admin/game-launchers')).then(asList<GameLauncher>),
};
