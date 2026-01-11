// store/file.ts
// File-backed EventStore implementation

import { Ok } from "$/core/result.ts";
import {
  type EventStore,
  type EventStoreQuery,
  type StorableEvent,
  StorableEventSchema,
} from "./mod.ts";
import { createEventIndex, indexEvent } from "./utils.ts";

// ============================================================================
// File-Backed Implementation Options
// ============================================================================

export interface FileEventStoreOptions {
  readonly path: string;
  readonly flushIntervalMs?: number;
}

// ============================================================================
// File-Backed Implementation
// ============================================================================

/**
 * Create a file-backed event store.
 * Events are persisted to a newline-delimited JSON file.
 */
export const createFileEventStore = async <
  TEvent extends StorableEvent = StorableEvent,
>(
  options: FileEventStoreOptions,
): Promise<EventStore<TEvent>> => {
  const { path, flushIntervalMs = 1000 } = options;

  const events: TEvent[] = [];
  const seen = new Set<string>();
  const index = createEventIndex<TEvent>();

  let dirty = false;
  let flushTimer: number | undefined;

  const flush = async (): Promise<void> => {
    if (!dirty) return;
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await Deno.writeTextFile(path, lines);
    dirty = false;
  };

  const scheduleFlush = (): void => {
    if (flushTimer !== undefined) return;
    flushTimer = setTimeout(async () => {
      flushTimer = undefined;
      await flush();
    }, flushIntervalMs);
  };

  // Load existing events
  try {
    const content = await Deno.readTextFile(path);
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        // Validate base event structure before accepting
        const baseResult = StorableEventSchema.safeParse(parsed);
        if (!baseResult.success) {
          continue; // Skip events that don't match base schema
        }
        // The event passes base validation - trust extended fields
        // (full validation happens at ingestion time, not on load)
        const event = parsed as TEvent;
        if (!seen.has(event.eventId)) {
          seen.add(event.eventId);
          events.push(event);
          indexEvent(event, index);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File doesn't exist yet
  }

  return {
    append(newEvents) {
      for (const event of newEvents) {
        if (seen.has(event.eventId)) continue;
        seen.add(event.eventId);
        events.push(event);
        indexEvent(event, index);
      }
      dirty = true;
      scheduleFlush();
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
