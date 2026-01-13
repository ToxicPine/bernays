// src/events/mod.ts
// Event sourcing definitions barrel

export { type StorableEvent, StorableEventSchema } from "$/store/mod.ts";

export {
  type CorrelationMetadata,
  CorrelationMetadataSchema,
} from "./metadata.ts";

// Core Events (scope: "core")
export {
  type AuthStatusChangedEvent,
  AuthStatusChangedEventSchema,
  type BrowserCommandCompletedEvent,
  BrowserCommandCompletedEventSchema,
  type BrowserCommandFailedEvent,
  BrowserCommandFailedEventSchema,
  type BrowserCommandSentEvent,
  BrowserCommandSentEventSchema,
  type CoreEvent,
  CoreEventSchema,
  type IntentAbandonedEvent,
  IntentAbandonedEventSchema,
  type IntentDispatchStartedEvent,
  IntentDispatchStartedEventSchema,
  type IntentReceivedEvent,
  IntentReceivedEventSchema,
  type RateLimitDetectedEvent,
  RateLimitDetectedEventSchema,
  type RetryScheduledEvent,
  RetryScheduledEventSchema,
  type StateReconciledEvent,
  StateReconciledEventSchema,
  type UIChangedEvent,
  UIChangedEventSchema,
} from "./core.ts";

// Journal Events (scope: "journal")
export {
  type JournalEntry,
  JournalEntrySchema,
  type JournalEvent,
  JournalEventSchema,
} from "./journal.ts";

// Event Templates
export {
  AnchorMessageObservedBase,
  type AnchorMessageObservedBaseType,
  MessageObservedBase,
  type MessageObservedBaseType,
} from "./templates/mod.ts";
