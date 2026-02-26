// src/events/journal.ts
// Journal events - sockpuppet decision/action log

import { z } from "@zod/zod";
import { CorrelationMetadataSchema } from "./metadata.ts";
import { ParticipantIdFromString, Scope, ThreadId } from "$/core/mod.ts";

// Journal Entry Event

/**
 * Journal entry - records what the sockpuppet decided and did.
 * On restart, the sockpuppet folds its journal to reconstruct its own state.
 *
 * The journal uses per-participant scopes (e.g., "journal:messageboard:bot")
 * so that queries are efficient at the EventStore level.
 */
export const JournalEntrySchema = CorrelationMetadataSchema.extend({
  scope: z.string().startsWith("journal:").transform(Scope),
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
