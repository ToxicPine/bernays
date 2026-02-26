// store/memory.ts
// In-memory EventStore implementation with reactive subscribe via PubSub

import { Effect, Layer, PubSub, Stream } from "effect";
import type { Scope } from "$/core/branded.ts";
import {
  type EventStoreQuery,
  type EventStoreService,
  EventStoreTag,
  type StorableEvent,
} from "./types.ts";
import { createEventIndex, indexEvent } from "./utils.ts";

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
    const events: StorableEvent[] = [];
    const seen = new Set<string>();
    const index = createEventIndex<StorableEvent>();
    const pubsub = yield* PubSub.unbounded<readonly StorableEvent[]>();

    const fetch = (
      query?: EventStoreQuery,
    ): Effect.Effect<readonly StorableEvent[]> =>
      Effect.sync(() => {
        const q = query ?? { type: "all" };
        switch (q.type) {
          case "all":
            return [...events];
          case "since":
            return events.filter((e) => e.timestamp >= q.timestamp);
          case "byScope": {
            let filtered = events.filter((e) => e.scope === q.scope);
            if ("since" in q && q.since) {
              filtered = filtered.filter((e) => e.timestamp >= q.since);
            }
            return filtered;
          }
          case "byCorrelation":
            return [...(index.byCorrelationId.get(q.correlationId) ?? [])];
          case "byIntent":
            return [...(index.byIntentId.get(q.intentId) ?? [])];
        }
      });

    const service: EventStoreService = {
      fetch,

      append: (newEvents) =>
        Effect.gen(function* () {
          for (const event of newEvents) {
            if (seen.has(event.eventId)) continue;
            seen.add(event.eventId);
            events.push(event);
            indexEvent(event, index);
          }
          if (newEvents.length > 0) {
            yield* PubSub.publish(pubsub, newEvents);
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
