// src/runtime/sockpuppet/services.ts
// Effect-based services for sockpuppets (new architecture)

import { Context, type Effect, Option } from "effect";
import type {
  AccountId,
  BrowserConfigId,
  Scope,
  ThreadId,
} from "$/core/branded.ts";
import type { JournalEntry } from "$/events/journal.ts";
import type { EventStoreError } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import type { BaseIntent, ExecuteError } from "$/platforms/mod.ts";

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

// Platform Service Interface (for sockpuppets)

/**
 * Platform service for sockpuppets.
 * Provides access to inbox, threads, browsers, and intent execution.
 *
 * This is the type-erased version used in sockpuppet context.
 * For fully-typed access, use PlatformService from $/platform/mod.ts.
 */
export interface PlatformServiceInterface {
  readonly scope: Scope;
  readonly accountId: AccountId;
  readonly account: BaseAccount;

  /** Get inbox view (thread summaries) */
  readonly inbox: Effect.Effect<BaseInboxView<unknown>, EventStoreError>;

  /** Get a specific thread with full message history */
  readonly thread: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<BaseThreadView<unknown>>, EventStoreError>;

  /** Get available browsers with platform-specific status */
  readonly browsers: Effect.Effect<
    readonly BaseBoundBrowser[],
    EventStoreError
  >;

  /** Execute an intent via a browser */
  readonly execute: (
    intent: BaseIntent,
    options?: { preferConfigId?: BrowserConfigId },
  ) => Effect.Effect<
    { usedConfigId: BrowserConfigId },
    ExecuteError | EventStoreError
  >;
}

/** Tag for the Platform service */
export class Platform extends Context.Tag("sockpuppet/Platform")<
  Platform,
  PlatformServiceInterface
>() {}

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
