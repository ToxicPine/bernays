// packages/master/src/core/mod.ts
// Barrel file for core module exports

// Branded Types
export {
  AccountId,
  type Brand,
  BrowserConfigId,
  CanonicalId,
  CausationId,
  CorrelationId,
  EventId,
  ExtensionId,
  IntentId,
  isUUID,
  Scope,
  ThreadId,
} from "./branded.ts";

// Scope Infrastructure
export { CORE_SCOPE, JOURNAL_SCOPE, ScopeSchema } from "./scope.ts";

// Hashing Utilities
export {
  actionId,
  contentHash,
  correlationId,
  dedupeKey,
  eventId,
  hash,
  messageId,
  type MessageIdParams,
  threadId,
  type ThreadIdParams,
} from "./hashing.ts";

// Result Utilities
export {
  Err,
  flatMapResult,
  flatMapResultWithErrorMap,
  isErr,
  isOk,
  mapResult,
  Ok,
  type Result,
} from "./result.ts";

// Store Factory
export {
  createInMemoryStore,
  type Identifiable,
  type StoreService,
} from "./store-factory.ts";
