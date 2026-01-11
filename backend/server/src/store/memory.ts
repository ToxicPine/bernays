// store/memory.ts
// In-memory EventStore implementation

import { Ok } from "$/core/result.ts";
import type { EventStore, EventStoreQuery, StorableEvent } from "./mod.ts";
import { createEventIndex, indexEvent } from "./utils.ts";

// ============================================================================
// In-Memory Implementation
// ============================================================================

/**
 * Create an in-memory event store.
 * Events are stored in memory and lost on process restart.
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
