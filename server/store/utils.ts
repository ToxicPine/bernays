// store/utils.ts
// Shared utilities for event store implementations

import type { StorableEvent } from "./mod.ts";

// Metadata Extraction Helpers

/**
 * Safely extract correlationId from an event.
 * Events may optionally have correlationId for tracing related events.
 */
export const getCorrelationId = (event: StorableEvent): string | undefined => {
  if ("correlationId" in event && typeof event.correlationId === "string") {
    return event.correlationId;
  }
  return undefined;
};

/**
 * Safely extract intentId from an event.
 * Events may optionally have intentId to track intent lifecycle.
 */
export const getIntentId = (event: StorableEvent): string | undefined => {
  if ("intentId" in event && typeof event.intentId === "string") {
    return event.intentId;
  }
  return undefined;
};

// Index Types

/**
 * In-memory index structure for fast lookups by correlation and intent ID.
 */
export interface EventIndex<TEvent extends StorableEvent> {
  readonly byCorrelationId: Map<string, TEvent[]>;
  readonly byIntentId: Map<string, TEvent[]>;
}

/**
 * Create empty index maps.
 */
export const createEventIndex = <
  TEvent extends StorableEvent,
>(): EventIndex<TEvent> => ({
  byCorrelationId: new Map(),
  byIntentId: new Map(),
});

/**
 * Index a single event into the provided index maps.
 * Mutates the index in place for performance.
 */
export const indexEvent = <TEvent extends StorableEvent>(
  event: TEvent,
  index: EventIndex<TEvent>,
): void => {
  const correlationId = getCorrelationId(event);
  if (correlationId) {
    const existing = index.byCorrelationId.get(correlationId) ?? [];
    existing.push(event);
    index.byCorrelationId.set(correlationId, existing);
  }

  const intentId = getIntentId(event);
  if (intentId) {
    const existing = index.byIntentId.get(intentId) ?? [];
    existing.push(event);
    index.byIntentId.set(intentId, existing);
  }
};
