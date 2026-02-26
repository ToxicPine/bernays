// packages/master/src/core/mod.ts
// Barrel file for core module exports

// Branded Types
export {
  AgentId,
  type Brand,
  BriefingId,
  BrowserConfigId,
  CanonicalId,
  CausationId,
  CorrelationId,
  EventId,
  getParticipantPlatformId,
  getParticipantScope,
  IntentId,
  isUUID,
  ParticipantId,
  ParticipantIdFromString,
  participantIdSchema,
  Scope,
  ThreadId,
} from "./branded.ts";

// Scope Infrastructure
export {
  BRIEFING_SCOPE,
  CORE_SCOPE,
  makeJournalScope,
  ScopeSchema,
} from "./scope.ts";

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
