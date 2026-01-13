// packages/master/src/runtime/sockpuppet/journal-runtime.ts
// Journal service layer using Effect.ts
// The journal is a projection of the global event store,
// filtered by scope: "journal" and accountId.

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
  type AccountId,
  type CorrelationId,
  type EventId,
  ThreadId,
} from "$/core/branded.ts";
import {
  JOURNAL_SCOPE,
  type JournalEntry,
  JournalEntrySchema,
} from "$/events/journal.ts";

export interface JournalRuntimeConfig {
  readonly accountId: AccountId;
  readonly eventStore: EventStore<StorableEvent>;
  readonly generateCorrelationId?: () => CorrelationId;
}

/**
 * Create a Journal service that uses the global event store.
 * Journal entries are stored as scope: "journal", type: "Entry" events with the accountId.
 */
const makeJournalService = (config: JournalRuntimeConfig): JournalService => {
  const { accountId, eventStore, generateCorrelationId } = config;

  const genCorrelationId = generateCorrelationId ??
    (() => crypto.randomUUID() as CorrelationId);

  return {
    record: (input: JournalEntryInput) =>
      Effect.promise(async () => {
        const entry: JournalEntry = {
          scope: JOURNAL_SCOPE,
          type: "Entry",
          eventId: crypto.randomUUID() as EventId,
          correlationId: genCorrelationId(),
          timestamp: new Date().toISOString(),
          accountId,
          kind: input.kind,
          ...(input.threadId ? { threadId: ThreadId(input.threadId) } : {}),
          ...Object.fromEntries(
            Object.entries(input).filter(
              ([key]) => key !== "kind" && key !== "threadId",
            ),
          ),
        };

        const result = await eventStore.append([entry]);
        if (!result.ok) {
          throw new Error(
            `Failed to record journal entry: ${result.error.message}`,
          );
        }
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

          if (parsed.data.accountId !== accountId) continue;

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
  accountId: AccountId,
): Layer.Layer<Journal> =>
  makeJournalLayer({
    accountId,
    eventStore: createInMemoryEventStore(),
  });
