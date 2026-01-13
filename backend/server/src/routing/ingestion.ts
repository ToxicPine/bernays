// src/routing/ingestion.ts
// Event ingestion - consumes bridge events, validates, and stores

import { Context, Effect, Layer, Stream } from "effect";
import { z } from "@zod/zod";
import { EventId, Scope, type Scope as ScopeType } from "$/core/branded.ts";
import { correlationId as genCorrelationId } from "$/core/hashing.ts";
import { BrowserPool, type TaggedBridgeEvent } from "$/backend/mod.ts";
import {
  type EventStore as EventStoreType,
  type EventStoreQuery,
  type StorableEvent,
} from "$/store/mod.ts";

// Event Ingestion Service

/**
 * EventIngestion is an active service - it starts consuming the event stream
 * when its layer initializes. There's no API surface; it just processes events
 * from the browser pool and stores them.
 */
// deno-lint-ignore no-empty-interface
export interface EventIngestionService {}

export class EventIngestion extends Context.Tag("EventIngestion")<
  EventIngestion,
  EventIngestionService
>() {}

// Implementation

/**
 * Creates an EventIngestion layer.
 *
 * The ingestion service:
 * 1. Consumes events from BrowserPool.events stream
 * 2. Enriches with eventId and timestamp if missing
 * 3. Validates against scope-specific schema
 * 4. Stores valid events to EventStore
 *
 * Invalid events are logged and dropped.
 *
 * @param schemas - Map of scope to event schema for validation
 */
export const makeEventIngestion = (
  schemas: ReadonlyMap<ScopeType, z.ZodType<StorableEvent>>,
): Layer.Layer<EventIngestion, never, BrowserPool | EventStore> =>
  Layer.scoped(
    EventIngestion,
    Effect.gen(function* () {
      const pool = yield* BrowserPool;
      const store = yield* EventStore;

      const processEvent = ({ configId, event }: TaggedBridgeEvent) =>
        Effect.gen(function* () {
          // 1. Check scope
          const scope = Scope(event.scope);
          const schema = schemas.get(scope);

          if (!schema) {
            yield* Effect.logWarning("Unknown scope, dropping event", {
              scope,
              type: event.type,
              configId,
            });
            return;
          }

          // 2. Enrich with required fields if missing
          const enriched = {
            ...event,
            eventId: EventId(crypto.randomUUID()),
            timestamp: new Date().toISOString(),
            correlationId: genCorrelationId(),
            configId,
          };

          // 3. Validate against schema
          const result = schema.safeParse(enriched);

          if (!result.success) {
            yield* Effect.logWarning("Event validation failed, dropping", {
              scope,
              type: event.type,
              configId,
              errors: result.error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
            });
            return;
          }

          // 4. Store the validated event
          yield* store.append([result.data]).pipe(
            Effect.catchAll((err) =>
              Effect.logError("Failed to store event", {
                scope,
                type: event.type,
                error: err.message,
              })
            ),
          );
        });

      yield* Effect.forkScoped(
        pool.events.pipe(
          Stream.tap((e) =>
            Effect.logDebug("Received bridge event", {
              scope: e.event.scope,
              type: e.event.type,
              configId: e.configId,
            })
          ),
          Stream.runForEach(processEvent),
        ),
      );

      return {};
    }),
  );

// EventStore Effect Service

/**
 * EventStore as an Effect service tag.
 * This allows using EventStore in Effect compositions.
 */
interface EventStoreEffect {
  readonly append: (
    events: readonly StorableEvent[],
  ) => Effect.Effect<void, { readonly message: string }>;
  readonly query: (
    query?: EventStoreQuery,
  ) => Effect.Effect<readonly StorableEvent[], { readonly message: string }>;
}

export class EventStore extends Context.Tag("EventStore")<
  EventStore,
  EventStoreEffect
>() {}

/**
 * Creates an EventStore layer from an EventStore implementation.
 */
export const makeEventStoreLayer = (
  store: EventStoreType,
): Layer.Layer<EventStore> =>
  Layer.succeed(EventStore, {
    append: (events) =>
      Effect.tryPromise({
        try: async () => {
          const result = await store.append(events);
          if (!result.ok) {
            throw new Error(result.error.message);
          }
        },
        catch: (err) => ({
          message: err instanceof Error ? err.message : String(err),
        }),
      }),
    query: (query) =>
      Effect.tryPromise({
        try: async () => {
          const result = await store.fetch(query);
          if (!result.ok) {
            throw new Error(result.error.message);
          }
          return result.value;
        },
        catch: (err) => ({
          message: err instanceof Error ? err.message : String(err),
        }),
      }),
  });
