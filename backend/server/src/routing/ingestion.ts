// src/routing/ingestion.ts
// Event ingestion - consumes bridge events, validates, and stores via Injector

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
import { type Injector, makeInjector } from "$/projections/mod.ts";

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
 * 3. Validates and stores via scope-specific Injector
 *
 * Invalid events are logged and dropped.
 * All writes go through Injector for validated writes per ARCHITECTURE.md.
 *
 * @param schemas - Map of scope to event schema for validation
 * @param eventStore - The raw EventStore implementation
 */
export const makeEventIngestion = (
  schemas: ReadonlyMap<ScopeType, z.ZodType<StorableEvent>>,
  eventStore: EventStoreType,
): Layer.Layer<EventIngestion, never, BrowserPool> =>
  Layer.scoped(
    EventIngestion,
    Effect.gen(function* () {
      const pool = yield* BrowserPool;

      // Create injectors per scope for validated writes
      const injectors = new Map<ScopeType, Injector<StorableEvent>>();
      for (const [scope, schema] of schemas) {
        injectors.set(scope, makeInjector(scope, schema, eventStore));
      }

      const processEvent = ({ configId, event }: TaggedBridgeEvent) =>
        Effect.gen(function* () {
          // 1. Check scope and get injector
          const scope = Scope(event.scope);
          const injector = injectors.get(scope);

          if (!injector) {
            yield* Effect.logWarning("Unknown scope, dropping event", {
              scope,
              type: event.type,
              configId,
            });
            return;
          }

          // 2. Enrich with required fields
          const enriched = {
            ...event,
            scope, // Use branded Scope instead of raw string
            eventId: EventId(crypto.randomUUID()),
            timestamp: new Date().toISOString(),
            correlationId: genCorrelationId(),
            configId,
          };

          // 3. Validate and store via Injector (validation + append are atomic)
          yield* injector.append(enriched as unknown as StorableEvent).pipe(
            Effect.catchAll((err) => {
              if (err.code === "ValidationFailed") {
                return Effect.logWarning("Event validation failed, dropping", {
                  scope,
                  type: event.type,
                  configId,
                  error: err.message,
                });
              }
              return Effect.logError("Failed to store event", {
                scope,
                type: event.type,
                configId,
                error: err.message,
              });
            }),
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
