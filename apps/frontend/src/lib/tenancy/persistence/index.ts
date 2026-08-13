/**
 * Persistence layer public surface (Phase 3.2, STEP 23).
 *
 * The durable foundation for the tenant control plane: a transactional `PersistenceDriver`
 * (in-memory now; SQL/Prisma in production behind the same interface), the schema +
 * migrations, and the repositories. Additive — no frozen module is referenced.
 */
export * from './errors';
export * from './records';
export { InMemoryPersistenceDriver, type PersistenceDriver, type IndexDef } from './driver';
export { TABLES, TABLE_INDEXES, MIGRATIONS, applySchema, type Migration } from './schema';
export { secureId, assertVersion, bump } from './util';
export {
  TenantRepository,
  type ITenantRepository,
  type CreateTenantRecord,
  type UpdateTenantRecord,
  type TenantSearch,
} from './tenant-repository';
export {
  DomainRepository,
  type IDomainRepository,
  ApiKeyRepository,
  type IApiKeyRepository,
  ConfigurationRepository,
  type IConfigurationRepository,
  FeatureFlagRepository,
  type IFeatureFlagRepository,
  QuotaRepository,
  LifecycleRepository,
  AuditRepository,
  ProvisioningRepository,
  SecretRefRepository,
} from './repositories';
