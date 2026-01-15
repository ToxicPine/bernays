// packages/master/src/runtime/sockpuppet/journal-runtime.ts
// Journal service layer using Effect.ts
// The journal is a projection of the global event store,
// filtered by scope: "journal" and accountId.
// All writes go through Injector for validated writes per ARCHITECTURE.md.

import { Effect, Layer } from "effect";
import {
  Journal,
  type JournalEntryInput,
  type JournalService,
} from "./services.ts";
import {
  createInMemoryEventStore,
  type EventStore,
  type StorableEvent,
} from "$/store/mod.ts";
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
import { type Injector, makeInjector } from "$/projections/mod.ts";

export interface JournalRuntimeConfig {
  readonly participantId: ParticipantId;
  readonly eventStore: EventStore<StorableEvent>;
  readonly generateCorrelationId?: () => CorrelationId;
}

/**
 * Create a Journal service that uses the global event store.
 * Journal entries are stored as scope: "journal", type: "Entry" events with the participantId.
 * All writes go through Injector for validated writes per ARCHITECTURE.md.
 */
const makeJournalService = (config: JournalRuntimeConfig): JournalService => {
  const { participantId, eventStore, generateCorrelationId } = config;

  const genCorrelationId = generateCorrelationId ??
    (() => CorrelationId(crypto.randomUUID()));

  // Create journal-specific Injector for validated writes
  const injector: Injector<JournalEntry> = makeInjector(
    JOURNAL_SCOPE,
    JournalEntrySchema,
    eventStore,
  );

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

        // Write through Injector (validates + appends)
        // Convert InjectorError to thrown exception to match interface
        yield* injector.append(entry).pipe(
          Effect.catchAll((err) =>
            Effect.die(
              new Error(`Failed to record journal entry: ${err.message}`),
            )
          ),
        );
      }),

    entries: (since?: string) =>
      Effect.promise(async () => {
        const query = since
          ? { type: "since" as const, timestamp: since }
          : { type: "all" as const };
        const result = await eventStore.fetch(query);

        if (!result.ok) {
          throw new Error(
            `Failed to fetch journal entries: ${result.error.message}`,
          );
        }

        const journalEntries: JournalEntry[] = [];

        for (const event of result.value) {
          if (event.scope !== "journal" || event.type !== "Entry") continue;

          const parsed = JournalEntrySchema.safeParse(event);
          if (!parsed.success) continue;

          if (parsed.data.participantId !== participantId) continue;

          journalEntries.push(parsed.data);
        }

        journalEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        return journalEntries;
      }),
  };
};

/**
 * Create a Layer that provides the Journal service using the global event store.
 */
export const makeJournalLayer = (
  config: JournalRuntimeConfig,
): Layer.Layer<Journal> => Layer.succeed(Journal, makeJournalService(config));

/**
 * Create an in-memory Journal layer for testing.
 * Uses the shared createInMemoryEventStore from store/memory.ts.
 */
export const makeInMemoryJournalLayer = (
  participantId: ParticipantId,
): Layer.Layer<Journal> =>
  makeJournalLayer({
    participantId,
    eventStore: createInMemoryEventStore(),
  });
