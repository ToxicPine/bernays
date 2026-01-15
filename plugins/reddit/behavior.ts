// src/platforms/reddit/behavior.ts
// Reddit platform behavior - pure derivation only

import {
  type BrowserConfigId,
  ParticipantId,
  type ParticipantId as ParticipantIdType,
  type ThreadId,
} from "@bernays/server/core";
import {
  buildThreadGraphs,
  calculateUnreadCount,
  extractParticipants,
  type GraphMessage,
  type ThreadGraph,
  toMessageViews,
} from "@bernays/server/views";
import type { PlatformBehavior } from "@bernays/server/platforms";

// Platform-specific types
import type { RedditAnchor, RedditEvent } from "./schemas.ts";
import type { RedditInbox, RedditIndexMeta, RedditThread } from "./views.ts";
import type { RedditAccount } from "./account.ts";
import { type RedditAuthStatus, type RedditBrowser } from "./browser.ts";
import type { RedditContact } from "./contact.ts";
import { REDDIT_SCOPE } from "./schemas.ts";

// Type Alias

type RedditScope = typeof REDDIT_SCOPE;

// Helper Functions

/**
 * Convert ThreadGraph to RedditThread
 */
const toRedditThread = (
  graph: ThreadGraph<RedditScope, GraphMessage, RedditAnchor>,
  participantId: ParticipantIdType<"reddit">,
): RedditThread => {
  const messages = toMessageViews<"reddit">(graph);
  const unreadCount = calculateUnreadCount(messages, participantId);

  return {
    threadId: graph.id,
    messages,
    participants: extractParticipants<"reddit">(graph.anchor),
    anchor: graph.anchor,
    unreadCount,
    lastActivity: graph.lastActivity,
    isGroupChat: graph.anchor.participants.length > 2,
  };
};

// Reddit Behavior

export const redditBehavior: PlatformBehavior<
  RedditScope,
  "reddit",
  RedditEvent,
  RedditAnchor,
  RedditThread,
  RedditInbox,
  RedditAccount,
  RedditBrowser,
  RedditContact
> = {
  scope: REDDIT_SCOPE,
  identity: "reddit",

  // ---------------------------------------------------------------------------
  // Derivation
  // ---------------------------------------------------------------------------

  deriveInbox: (
    events: readonly RedditEvent[],
    participantId: ParticipantIdType<"reddit">,
  ): RedditInbox => {
    // Events are pre-filtered by scope via the Projection layer
    const threads = buildThreadGraphs<RedditScope, GraphMessage, RedditAnchor>(
      REDDIT_SCOPE,
      events,
    );

    const byThreadId: Record<string, RedditIndexMeta> = {};
    let unreadTotal = 0;

    for (const thread of threads.values()) {
      const messages = toMessageViews<"reddit">(thread);
      const unreadCount = calculateUnreadCount(messages, participantId);
      unreadTotal += unreadCount;

      byThreadId[thread.id] = {
        lastActivity: thread.lastActivity,
        unreadCount,
        participantCount: thread.anchor.participants.length,
      };
    }

    return {
      byThreadId,
      syncedAt: new Date().toISOString(),
      unreadTotal,
    };
  },

  deriveThread: (
    events: readonly RedditEvent[],
    threadId: ThreadId,
  ): RedditThread | undefined => {
    // Events are pre-filtered by scope via the Projection layer
    const threads = buildThreadGraphs<RedditScope, GraphMessage, RedditAnchor>(
      REDDIT_SCOPE,
      events,
    );
    const thread = threads.get(threadId);

    if (!thread) {
      return undefined;
    }

    const authEvent = events.find((e) => e.type === "AuthObserved");
    const participantId = authEvent
      ? (authEvent as { participantId: ParticipantIdType<"reddit"> })
        .participantId
      : ParticipantId("reddit", "");

    return toRedditThread(thread, participantId);
  },

  deriveBrowsers: (
    events: readonly RedditEvent[],
    account: RedditAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly RedditBrowser[] => {
    // Build browser status from events
    const browserStatus = new Map<
      string,
      {
        authStatus: RedditAuthStatus;
        isBanned: boolean;
        bannedReason?: string;
        rateLimitedUntil?: string;
      }
    >();

    // Process auth events (latest wins)
    for (const event of events) {
      if (event.type === "AuthObserved") {
        const authEvent = event as {
          configId: string;
          authenticated: boolean;
          isBanned?: boolean;
          bannedReason?: string;
        };
        const { configId } = authEvent;
        if (configId) {
          const existing = browserStatus.get(configId);
          browserStatus.set(configId, {
            authStatus: authEvent.authenticated ? "authenticated" : "expired",
            isBanned: authEvent.isBanned ?? existing?.isBanned ?? false,
            bannedReason: authEvent.bannedReason ?? existing?.bannedReason,
            rateLimitedUntil: existing?.rateLimitedUntil,
          });
        }
      }

      // Process rate limit events
      if (event.type === "RateLimitObserved") {
        const rateLimitEvent = event as {
          configId: string;
          retryAfter?: string;
        };
        const { configId } = rateLimitEvent;
        const existing = browserStatus.get(configId);
        if (existing) {
          browserStatus.set(configId, {
            ...existing,
            rateLimitedUntil: rateLimitEvent.retryAfter,
          });
        } else {
          browserStatus.set(configId, {
            authStatus: "unknown",
            isBanned: false,
            rateLimitedUntil: rateLimitEvent.retryAfter,
          });
        }
      }

      // Process ban events
      if (event.type === "AccountBanned") {
        const banEvent = event as {
          participantId: ParticipantIdType<"reddit">;
          reason?: string;
        };
        // Update all browsers associated with this account
        for (const binding of account.browserBindings) {
          const existing = browserStatus.get(binding.configId);
          browserStatus.set(binding.configId, {
            authStatus: existing?.authStatus ?? "unknown",
            isBanned: true,
            bannedReason: banEvent.reason,
            rateLimitedUntil: existing?.rateLimitedUntil,
          });
        }
      }
    }

    // Map account's browser bindings to RedditBrowser
    return account.browserBindings.map((binding) => {
      const status = browserStatus.get(binding.configId) ?? {
        authStatus: "unknown" as const,
        isBanned: false,
      };

      return {
        configId: binding.configId,
        isRunning: runningConfigIds.has(binding.configId),
        metadata: binding.metadata,
        authStatus: status.authStatus,
        isBanned: status.isBanned,
        bannedReason: status.bannedReason,
        rateLimitedUntil: status.rateLimitedUntil,
      };
    });
  },

  deriveContact: (
    events: readonly RedditEvent[],
    participantId: ParticipantIdType<"reddit">,
  ): RedditContact | undefined => {
    let username: string | undefined;
    let karma: number | undefined;
    let accountAge: string | undefined;
    let lastInteraction: string | undefined;

    for (const event of events) {
      // Extract info from user discovery
      if (event.type === "UserDiscovered") {
        const userEvent = event as {
          userId: string;
          username: string;
          karma?: number;
          accountAge?: string;
        };
        if (userEvent.userId === participantId) {
          username = userEvent.username;
          if (userEvent.karma !== undefined) karma = userEvent.karma;
          if (userEvent.accountAge) accountAge = userEvent.accountAge;
        }
      }

      // Extract from DM anchor participants
      if (event.type === "DirectMessageObserved") {
        const dmEvent = event as {
          anchor: { participants: readonly string[] };
        };
        if (dmEvent.anchor.participants.includes(participantId as string)) {
          if (!lastInteraction || event.timestamp > lastInteraction) {
            lastInteraction = event.timestamp;
          }
        }
      }
    }

    // Only return contact if we found any info
    if (!username && !lastInteraction) {
      return undefined;
    }

    return {
      id: participantId,
      name: username,
      username,
      karma,
      accountAge,
      lastInteraction,
    };
  },
};
