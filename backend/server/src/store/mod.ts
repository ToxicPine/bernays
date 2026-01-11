// src/store/mod.ts
// Event store interfaces for persistence

import { z } from "@zod/zod";
import type { Result } from "$/core/result.ts";
import { type Scope, Scope as makeScope } from "$/core/branded.ts";
import type { EventId } from "$/core/branded.ts";

// ============================================================================
// Error Types
// ============================================================================

export type EventStoreErrorCode =
  | "AppendFailed"
  | "QueryFailed"
  | "ConnectionError"
  | "PersistenceError"
  | "ReadError"
  | "Unknown";

export interface EventStoreError {
  readonly code: EventStoreErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const createEventStoreError = (
  code: EventStoreErrorCode,
  message: string,
  cause?: unknown,
): EventStoreError => ({ code, message, cause });

// ============================================================================
// Storable Event Schema
// ============================================================================

/**
 * Minimum shape for event storage.
 * All events must satisfy this contract to be persisted.
 *
 * - scope: Platform or domain scope (e.g., "core", "linkedin", "journal")
 * - type: PascalCase event name (e.g., "IntentReceived", "MessageObserved")
 * - eventId: Unique identifier for deduplication
 * - timestamp: ISO 8601 datetime string
 */
export const StorableEventSchema = z.object({
  scope: z.string().min(1).transform((val) => makeScope(val)),
  type: z.string().min(1),
  eventId: z.uuid().transform((val) => val as EventId),
  timestamp: z.iso.datetime(),
});

export type StorableEvent = z.infer<typeof StorableEventSchema>;

// ============================================================================
// Query Types
// ============================================================================

export type EventStoreQuery =
  | { type: "all" }
  | { type: "since"; timestamp: string }
  | { type: "byScope"; scope: Scope }
  | { type: "byScope"; scope: Scope; since: string }
  | { type: "byCorrelation"; correlationId: string }
  | { type: "byIntent"; intentId: string };

// ============================================================================
// Base EventStore Interface
// ============================================================================

/**
 * Core EventStore interface - minimum contract for event persistence.
 *
 * Design:
 * - Stores events as opaque records (after validation)
 * - Consumers narrow to specific event types using type guards
 * - Validation happens at boundaries (on append), not on read
 * - Single `fetch` method with query union (per CLAUDE.md)
 * - Fold belongs on projections, not the store
 */
export interface EventStore<TEvent extends StorableEvent = StorableEvent> {
  /**
   * Append events atomically.
   * Implementations should:
   * 1. Validate events have required base fields
   * 2. Deduplicate by eventId
   */
  readonly append: (
    events: readonly TEvent[],
  ) => Promise<Result<void, EventStoreError>>;

  /**
   * Fetch events matching a query.
   * Defaults to all events if no query provided.
   */
  readonly fetch: (
    query?: EventStoreQuery,
  ) => Promise<Result<readonly TEvent[], EventStoreError>>;
}

// ============================================================================
// Implementations
// ============================================================================

export { createInMemoryEventStore } from "./memory.ts";

export { createFileEventStore, type FileEventStoreOptions } from "./file.ts";

export {
  configurePostgresEventStore,
  createPostgresEventStore,
  type PostgresEventStoreOptions,
} from "./postgres.ts";

// Utilities
export {
  createEventIndex,
  type EventIndex,
  getCorrelationId,
  getIntentId,
  indexEvent,
} from "./utils.ts";

// Config Store
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
