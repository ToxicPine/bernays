// src/store/mod.ts
// Event store public API — re-exports types from types.ts and implementations.

export {
  createEventStoreError,
  type EventStoreError,
  type EventStoreErrorCode,
  type EventStoreQuery,
  type EventStoreService,
  EventStoreTag,
  StorableEventSchema,
  type StorableEvent,
} from "./types.ts";

export { EventStoreInMemory } from "./memory.ts";

export { EventStorePostgres, type PostgresEventStoreOptions } from "./postgres.ts";

export {
  createEventIndex,
  type EventIndex,
  getCorrelationId,
  getIntentId,
  indexEvent,
} from "./utils.ts";

export {
  ConfigStore,
  type ConfigStoreError,
  configStoreError,
  type ConfigStoreService,
  createInMemoryConfigStore,
  createPostgresConfigStore,
  makeInMemoryConfigStoreLayer,
  type PostgresConfigStoreOptions as PostgresConfigStoreOpts,
} from "./config-store.ts";
