// src/events/journal.ts
// Journal events - sockpuppet decision/action log

import { z } from "@zod/zod";
import { CorrelationMetadataSchema } from "./metadata.ts";
import { ParticipantIdFromString, ThreadId } from "$/core/mod.ts";
import { JOURNAL_SCOPE } from "$/core/scope.ts";

// Re-export for convenience
export { JOURNAL_SCOPE };

// Journal Entry Event

/**
 * Journal entry - records what the sockpuppet decided and did.
 * On restart, the sockpuppet folds its journal to reconstruct its own state.
 *
 * The journal is a projection of the global event store,
 * filtered by scope: "journal" and participantId.
 */
export const JournalEntrySchema = CorrelationMetadataSchema.extend({
  scope: z.literal("journal").transform(() => JOURNAL_SCOPE),
  type: z.literal("Entry"),
  participantId: z.string().transform(ParticipantIdFromString),
  kind: z.string(), // e.g., "had_thought", "decided_to_check_later", "sent_reply"
  threadId: z.string().transform(ThreadId).optional(),
});

export type JournalEntry = z.infer<typeof JournalEntrySchema>;

// Journal Event Union

export const JournalEventSchema = z.discriminatedUnion("type", [
  JournalEntrySchema,
]);

export type JournalEvent = z.infer<typeof JournalEventSchema>;
