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

// Briefing Events (scope: "briefing")
export {
  BRIEFING_SCOPE,
  type BriefingAccepted,
  BriefingAcceptedSchema,
  type BriefingDeclined,
  BriefingDeclinedSchema,
  type BriefingEnded,
  BriefingEndedSchema,
  type BriefingEvent,
  BriefingEventSchema,
  type BriefingMessageSent,
  BriefingMessageSentSchema,
  type BriefingRequested,
  BriefingRequestedSchema,
} from "./briefing.ts";

// Event Templates
export {
  AnchorMessageObservedBase,
  type AnchorMessageObservedBaseType,
  AuthObservedBase,
  authObservedBase,
  type AuthObservedBaseType,
  type AuthObservedFields,
  type AuthStatus,
  AuthStatusSchema,
  MessageObservedBase,
  type MessageObservedBaseType,
  RateLimitObservedBase,
  rateLimitObservedBase,
  type RateLimitObservedBaseType,
  type RateLimitObservedFields,
} from "./templates/mod.ts";
