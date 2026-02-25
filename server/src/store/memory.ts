// store/memory.ts
// In-memory EventStore implementation with reactive subscribe via PubSub

import { Effect, Layer, PubSub, Stream } from "effect";
import { Ok } from "$/core/result.ts";
import type { Scope } from "$/core/branded.ts";
import {
  type EventStore,
  type EventStoreQuery,
  type EventStoreService,
  EventStoreTag,
  liftStoreToEffect,
  type StorableEvent,
} from "./mod.ts";
import { createEventIndex, indexEvent } from "./utils.ts";

// =============================================================================
// Plain EventStore (no subscribe — for backward compat / tests)
// =============================================================================

/**
 * Create an in-memory event store (plain Promise-based interface).
 * Events are stored in memory and lost on process restart.
 * Does NOT support subscribe — use EventStoreInMemory Layer for that.
 */
export const createInMemoryEventStore = <
  TEvent extends StorableEvent = StorableEvent,
>(): EventStore<TEvent> => {
  const events: TEvent[] = [];
  const seen = new Set<string>();
  const index = createEventIndex<TEvent>();

  return {
    append(newEvents: readonly TEvent[]) {
      for (const event of newEvents) {
        if (seen.has(event.eventId)) continue;
        seen.add(event.eventId);
        events.push(event);
        indexEvent(event, index);
      }
      return Promise.resolve(Ok(undefined));
    },

    fetch(query?: EventStoreQuery) {
      const q = query ?? { type: "all" };

      switch (q.type) {
        case "all":
          return Promise.resolve(Ok([...events]));
        case "since": {
          const filtered = events.filter((e) => e.timestamp >= q.timestamp);
          return Promise.resolve(Ok(filtered));
        }
        case "byScope": {
          let filtered = events.filter((e) => e.scope === q.scope);
          if ("since" in q && q.since) {
            filtered = filtered.filter((e) => e.timestamp >= q.since);
          }
          return Promise.resolve(Ok(filtered));
        }
        case "byCorrelation": {
          const result = index.byCorrelationId.get(q.correlationId) ?? [];
          return Promise.resolve(Ok([...result]));
        }
        case "byIntent": {
          const result = index.byIntentId.get(q.intentId) ?? [];
          return Promise.resolve(Ok([...result]));
        }
      }
    },
  };
};

// =============================================================================
// Reactive in-memory EventStore Layer (with subscribe via PubSub)
// =============================================================================

/**
 * In-memory EventStore Layer with reactive subscribe.
 *
 * Uses an Effect PubSub to deliver events to subscribers on append.
 * Scoped — the PubSub is created when the layer is built and shut down
 * when the scope closes.
 */
export const EventStoreInMemory: Layer.Layer<EventStoreTag> = Layer.scoped(
  EventStoreTag,
  Effect.gen(function* () {
    const store = createInMemoryEventStore();
    const base = liftStoreToEffect(store);

    // Unbounded PubSub — append should never block waiting for subscribers.
    // Each published message is a chunk of events from one append call.
    const pubsub = yield* PubSub.unbounded<readonly StorableEvent[]>();

    const service: EventStoreService = {
      fetch: base.fetch,

      append: (events) =>
        Effect.gen(function* () {
          yield* base.append(events);
          // Publish the appended events to all subscribers.
          // We publish the full batch — subscribers see exactly what was appended.
          if (events.length > 0) {
            yield* PubSub.publish(pubsub, events);
          }
        }),

      subscribe: (scope: Scope, since?: string) =>
        Stream.unwrapScoped(
          Effect.gen(function* () {
            const queue = yield* PubSub.subscribe(pubsub);

            return Stream.fromQueue(queue).pipe(
              // Flatten: each queue item is a chunk of events
              // Filter to matching scope and timestamp
              Stream.map((chunk) => {
                const filtered = chunk.filter((e) => {
                  if (e.scope !== scope) return false;
                  if (since && e.timestamp <= since) return false;
                  return true;
                });
                return filtered;
              }),
              // Drop empty chunks (events for other scopes)
              Stream.filter((chunk) => chunk.length > 0),
            );
          }),
        ),
    };

    return service;
  }),
);
