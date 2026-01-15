// src/runtime/sockpuppet/services.ts
// Effect-based services for sockpuppets

import { Context, type Effect } from "effect";
import type { JournalEntry } from "$/events/journal.ts";

// Re-export PlatformService type for convenience
// Note: Platform tags are now platform-specific (e.g., LinkedInPlatform)
export type { PlatformService } from "$/platforms/mod.ts";

// Re-export JournalEntry from events for convenience
export type { JournalEntry };

// Journal Entry Input

/**
 * Input for recording a journal entry.
 * The service will add eventId, timestamp, and type automatically.
 */
export interface JournalEntryInput {
  readonly kind: string;
  readonly threadId?: string;
  readonly [key: string]: unknown;
}

// Journal Service

/**
 * Service for the sockpuppet's chronological log.
 * The journal is a projection of the global event store,
 * filtered by type: "journal:Entry" and accountId.
 *
 * Used for maintaining state across runs via folding.
 */
export interface JournalService {
  /**
   * Record a journal entry.
   * The service adds eventId, timestamp, correlationId, and type automatically.
   */
  readonly record: (entry: JournalEntryInput) => Effect.Effect<void>;

  /**
   * Get all journal entries for this account.
   * Returns entries ordered by timestamp (oldest first).
   *
   * @param since - Optional ISO timestamp to filter entries after
   */
  readonly entries: (since?: string) => Effect.Effect<readonly JournalEntry[]>;
}

/** Tag for the JournalService */
export class Journal extends Context.Tag("sockpuppet/Journal")<
  Journal,
  JournalService
>() {}
