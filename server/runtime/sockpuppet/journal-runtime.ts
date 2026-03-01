// src/runtime/sockpuppet/journal-runtime.ts
// Journal service layer using Effect.ts
// Writes through Injector, reads through Projection. Never sees raw EventStore.

import { Effect, Layer } from "effect";
import {
  Journal,
  type JournalEntryInput,
  type JournalService,
} from "./services.ts";
import {
  CorrelationId,
  EventId,
  type ParticipantId,
  type Scope,
  ThreadId,
} from "$/core/branded.ts";
import { makeJournalScope } from "$/core/scope.ts";
import { type JournalEntry, JournalEntrySchema } from "$/events/journal.ts";
import {
  type Injector,
  makeInjectionLayer,
  makeInjectorTag,
} from "$/projections/injector.ts";
import {
  makeProjectionLayer,
  makeProjectionTag,
  type Projection,
} from "$/projections/projection.ts";
import { EventStoreTag } from "$/store/types.ts";

// =============================================================================
// Scoped Tags for Journal's Injection/Projection
// =============================================================================

/** Injector tag for journal events. */
export const JournalInjection = makeInjectorTag<JournalEntry>(
  "journal/Injection",
);

/** Projection tag for journal events. */
export const JournalProjection = makeProjectionTag<JournalEntry>(
  "journal/Projection",
);

// =============================================================================
// Journal Service Factory
// =============================================================================

/**
 * Create a Journal service that writes through Injector and reads through
 * Projection. Never sees the raw EventStore.
 */
const makeJournalService = (
  participantId: ParticipantId,
  scope: Scope,
  injector: Injector<JournalEntry>,
  projection: Projection<JournalEntry>,
  generateCorrelationId?: () => CorrelationId,
): JournalService => {
  const genCorrelationId = generateCorrelationId ??
    (() => CorrelationId(crypto.randomUUID()));

  return {
    record: (input: JournalEntryInput) =>
      Effect.gen(function* () {
        const entry: JournalEntry = {
          scope,
          type: "Entry",
          eventId: EventId(crypto.randomUUID()),
          correlationId: genCorrelationId(),
          timestamp: new Date().toISOString(),
          participantId,
          kind: input.kind,
          ...(input.threadId ? { threadId: ThreadId(input.threadId) } : {}),
          ...Object.fromEntries(
            Object.entries(input).filter(
              ([key]) => key !== "kind" && key !== "threadId",
            ),
          ),
        };

        yield* injector.append(entry).pipe(
          Effect.catchAll((err) =>
            Effect.die(
              new Error(`Failed to record journal entry: ${err.message}`),
            )
          ),
        );
      }),

    entries: (since?: string) =>
      Effect.gen(function* () {
        const events = yield* projection.query(since).pipe(
          Effect.catchAll(() => Effect.succeed([] as readonly JournalEntry[])),
        );

        // No in-memory filter needed — scope is per-participant, so all
        // events returned belong to this participant. Just sort by timestamp.
        const sorted = [...events].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp)
        );

        return sorted;
      }),
  };
};

// =============================================================================
// Journal Layer
// =============================================================================

/**
 * Create a Layer that provides the Journal service for a specific participant.
 *
 * Uses a per-participant scope (e.g., "journal:messageboard:bot") so that
 * queries are efficient at the EventStore level — no in-memory filtering
 * required.
 *
 * Depends on EventStoreTag. Creates and provides its own JournalInjection
 * and JournalProjection layers internally.
 */
export const makeJournalLayer = (
  participantId: ParticipantId,
  generateCorrelationId?: () => CorrelationId,
): Layer.Layer<Journal, never, EventStoreTag> => {
  const scope = makeJournalScope(participantId);

  // Create injection/projection layers with participant-specific scope
  const injectionLayer = makeInjectionLayer(
    JournalInjection,
    scope,
    JournalEntrySchema,
  );
  const projectionLayer = makeProjectionLayer(
    JournalProjection,
    scope,
    JournalEntrySchema,
  );

  return Layer.effect(
    Journal,
    Effect.gen(function* () {
      const injector = yield* JournalInjection;
      const projection = yield* JournalProjection;
      return makeJournalService(
        participantId,
        scope,
        injector,
        projection,
        generateCorrelationId,
      );
    }),
  ).pipe(
    Layer.provide(injectionLayer),
    Layer.provide(projectionLayer),
  );
};
