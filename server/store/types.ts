// src/store/types.ts
// Core EventStore types, interfaces, and Effect service tag.
//
// Extracted into a separate file so implementations (memory.ts, postgres.ts)
// can import these without creating a circular dependency through mod.ts.

import { Context, Effect, Stream } from "effect";
import { z } from "@zod/zod";
import { type Scope, Scope as makeScope } from "$/core/branded.ts";
import { EventId } from "$/core/branded.ts";

// =============================================================================
// Error
// =============================================================================

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

// =============================================================================
// StorableEvent
// =============================================================================

export const StorableEventSchema = z.object({
  scope: z.string().min(1).transform((val) => makeScope(val)),
  type: z.string().min(1),
  eventId: z.uuid().default(() => crypto.randomUUID()).transform(EventId),
  timestamp: z.iso.datetime().default(() => new Date().toISOString()),
});

export type StorableEvent = z.infer<typeof StorableEventSchema>;

// =============================================================================
// Query
// =============================================================================

export type EventStoreQuery =
  | { type: "all" }
  | { type: "since"; timestamp: string }
  | { type: "byScope"; scope: Scope }
  | { type: "byScope"; scope: Scope; since: string }
  | { type: "byCorrelation"; correlationId: string }
  | { type: "byIntent"; intentId: string };

// =============================================================================
// Effect service interface + Context tag
// =============================================================================

export interface EventStoreService {
  readonly append: (
    events: readonly StorableEvent[],
  ) => Effect.Effect<void, EventStoreError>;

  readonly fetch: (
    query?: EventStoreQuery,
  ) => Effect.Effect<readonly StorableEvent[], EventStoreError>;

  /**
   * Scope-filtered stream of new events.
   * Implementation decides how the stream is produced:
   * - In-memory: push on append via PubSub (zero latency)
   * - Postgres: internal poll on a short interval
   */
  readonly subscribe: (
    scope: Scope,
    since?: string,
  ) => Stream.Stream<readonly StorableEvent[], EventStoreError>;
}

export class EventStoreTag extends Context.Tag("EventStore")<
  EventStoreTag,
  EventStoreService
>() {}
