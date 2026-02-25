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
  ThreadId,
} from "$/core/branded.ts";
import {
  JOURNAL_SCOPE,
  type JournalEntry,
  JournalEntrySchema,
} from "$/events/journal.ts";
import {
  type Injector,
  makeInjectorTag,
  makeInjectionLayer,
} from "$/projections/injector.ts";
import {
  type Projection,
  makeProjectionTag,
  makeProjectionLayer,
} from "$/projections/projection.ts";


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
// Journal Injection/Projection Layers
// =============================================================================

/** Layer providing JournalInjection. Depends on EventStoreTag. */
export const JournalInjectionLive = makeInjectionLayer(
  JournalInjection,
  JOURNAL_SCOPE,
  JournalEntrySchema,
);

/** Layer providing JournalProjection. Depends on EventStoreTag. */
export const JournalProjectionLive = makeProjectionLayer(
  JournalProjection,
  JOURNAL_SCOPE,
  JournalEntrySchema,
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
          scope: JOURNAL_SCOPE,
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

        // Filter by participantId and sort
        const filtered = events
          .filter((e) => e.participantId === participantId)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        return filtered;
      }),
  };
};

// =============================================================================
// Journal Layer
// =============================================================================

/**
 * Create a Layer that provides the Journal service.
 * Depends on JournalInjection and JournalProjection.
 */
export const makeJournalLayer = (
  participantId: ParticipantId,
  generateCorrelationId?: () => CorrelationId,
) =>
  Layer.effect(
    Journal,
    Effect.gen(function* () {
      const injector = yield* JournalInjection;
      const projection = yield* JournalProjection;
      return makeJournalService(
        participantId,
        injector,
        projection,
        generateCorrelationId,
      );
    }),
  );
