// src/store/mod.ts
// Event store interfaces for persistence

import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { z } from "@zod/zod";
import type { Result } from "$/core/result.ts";
import { type Scope, Scope as makeScope } from "$/core/branded.ts";
import { EventId } from "$/core/branded.ts";

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

// Storable Event Schema

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
  eventId: z.uuid().transform(EventId),
  timestamp: z.iso.datetime(),
});

export type StorableEvent = z.infer<typeof StorableEventSchema>;

export type EventStoreQuery =
  | { type: "all" }
  | { type: "since"; timestamp: string }
  | { type: "byScope"; scope: Scope }
  | { type: "byScope"; scope: Scope; since: string }
  | { type: "byCorrelation"; correlationId: string }
  | { type: "byIntent"; intentId: string };

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

// =============================================================================
// Effect Service
// =============================================================================

/**
 * Effect-native EventStore service interface.
 *
 * This is the idiomatic way to depend on the EventStore in Effect-TS code.
 * Injection and Projection resolve this from context rather than accepting
 * a raw EventStore as a parameter.
 *
 * The `subscribe` method exposes a reactive stream of new events. How the
 * stream is produced is an implementation detail: in-memory stores push on
 * append via PubSub, Postgres stores poll internally on a short interval.
 */
export interface EventStoreService {
  /** Append events atomically (deduplicated by eventId). */
  readonly append: (
    events: readonly StorableEvent[],
  ) => Effect.Effect<void, EventStoreError>;

  /** One-shot query (for startup hydration and API reads). */
  readonly fetch: (
    query?: EventStoreQuery,
  ) => Effect.Effect<readonly StorableEvent[], EventStoreError>;

  /**
   * Scope-filtered stream of new events.
   *
   * Each element in the stream is a chunk of one or more events that arrived
   * since the last emission. The `since` parameter sets the starting point;
   * events at or before that timestamp are excluded.
   *
   * Implementation decides how the stream is produced:
   * - In-memory: push on append via PubSub (zero latency)
   * - Postgres: internal poll on a short interval
   */
  readonly subscribe: (
    scope: Scope,
    since?: string,
  ) => Stream.Stream<readonly StorableEvent[], EventStoreError>;
}

/** Context tag for the EventStore Effect service. */
export class EventStoreTag extends Context.Tag("EventStore")<
  EventStoreTag,
  EventStoreService
>() {}

/**
 * Lift append/fetch from a plain Promise-based EventStore into Effect operations.
 * Used internally by implementation-specific Layer factories. Does NOT provide
 * `subscribe` — each implementation must add that natively.
 */
export const liftStoreToEffect = (
  store: EventStore<StorableEvent>,
): Pick<EventStoreService, "append" | "fetch"> => ({
  append: (events) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(() => store.append(events));
      if (!result.ok) {
        return yield* Effect.fail(result.error);
      }
    }),
  fetch: (query) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(() => store.fetch(query));
      if (!result.ok) {
        return yield* Effect.fail(result.error);
      }
      return result.value;
    }),
});

// =============================================================================
// Generic EventStore → Layer lift
// =============================================================================

/**
 * Wrap a raw `EventStore` into a `Layer<EventStoreTag>` with local-only
 * PubSub-based subscribe.
 *
 * Use this when you already hold a Promise-based EventStore instance and
 * need to inject it into the Effect layer stack. The resulting service
 * publishes events to subscribers only when `append` is called locally;
 * there is NO poll for external writers. If you need to react to external
 * Postgres writes, use `EventStorePostgres` instead.
 */
export const EventStoreLive = (
  store: EventStore<StorableEvent>,
): Layer.Layer<EventStoreTag> =>
  Layer.scoped(
    EventStoreTag,
    Effect.gen(function* () {
      const base = liftStoreToEffect(store);
      const pubsub = yield* PubSub.unbounded<readonly StorableEvent[]>();

      const service: EventStoreService = {
        fetch: base.fetch,

        append: (events) =>
          Effect.gen(function* () {
            yield* base.append(events);
            if (events.length > 0) {
              yield* PubSub.publish(pubsub, events);
            }
          }),

        subscribe: (scope: Scope, since?: string) =>
          Stream.unwrapScoped(
            Effect.gen(function* () {
              const queue = yield* PubSub.subscribe(pubsub);
              return Stream.fromQueue(queue).pipe(
                Stream.map((chunk) =>
                  chunk.filter((e) => {
                    if (e.scope !== scope) return false;
                    if (since && e.timestamp <= since) return false;
                    return true;
                  })
                ),
                Stream.filter((chunk) => chunk.length > 0),
              );
            }),
          ),
      };

      return service;
    }),
  );

export { createInMemoryEventStore, EventStoreInMemory } from "./memory.ts";

export { createFileEventStore, type FileEventStoreOptions } from "./file.ts";

export {
  configurePostgresEventStore,
  createPostgresEventStore,
  EventStorePostgres,
  type PostgresEventStoreOptions,
} from "./postgres.ts";

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
