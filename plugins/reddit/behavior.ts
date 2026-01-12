// src/platforms/reddit/behavior.ts
// Reddit platform behavior - derivation and execution

import { Effect } from "effect";
import type {
  AccountId,
  BrowserConfigId,
  ThreadId,
} from "@bernays/server/core";
import type { StorableEvent } from "@bernays/server/store";
import { BrowserPool } from "@bernays/server/backend";
import {
  calculateUnreadCount,
  type MessageView,
  type Participant,
} from "@bernays/server/views";
import {
  type ExecuteError,
  executeError,
  type PlatformBehavior,
} from "@bernays/server/platforms";
import {
  buildThreadGraphs,
  type GraphMessage,
  graphNodesToMessages,
  type ThreadGraph,
} from "@bernays/server/views";
import { logger } from "$/logger.ts";

// Platform-specific types
import type { RedditAnchor, RedditEvent } from "./schemas.ts";
import type { RedditIntent } from "./schemas.ts";
import type {
  RedditInbox,
  RedditIndexMeta,
  RedditThread,
} from "./views.ts";
import type { RedditAccount } from "./account.ts";
import type { RedditAuthStatus, RedditBrowser } from "./browser.ts";
import { REDDIT_SCOPE } from "./schemas.ts";

// ============================================================================
// Type Alias
// ============================================================================

type RedditScope = typeof REDDIT_SCOPE;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert graph nodes to MessageView format
 */
const toMessageViews = (
  graph: ThreadGraph<GraphMessage, RedditAnchor>,
): readonly MessageView[] =>
  graphNodesToMessages(graph.nodes).map((m) => ({
    id: m.canonicalId,
    senderId: m.senderId,
    content: m.content,
    timestamp: m.timestamp,
  }));

/**
 * Extract participants from Reddit anchor
 */
const extractParticipants = (anchor: RedditAnchor): readonly Participant[] =>
  anchor.participants.map((id) => ({ id }));

/**
 * Convert ThreadGraph to RedditThread
 */
const toRedditThread = (
  graph: ThreadGraph<GraphMessage, RedditAnchor>,
  accountId: string,
): RedditThread => {
  const messages = toMessageViews(graph);
  const unreadCount = calculateUnreadCount(messages, accountId);

  return {
    threadId: graph.id,
    messages,
    participants: extractParticipants(graph.anchor),
    anchor: graph.anchor,
    unreadCount,
    lastActivity: graph.lastActivity,
    isGroupChat: graph.anchor.participants.length > 2,
  };
};

// ============================================================================
// Reddit Behavior
// ============================================================================

export const redditBehavior: PlatformBehavior<
  RedditScope,
  RedditEvent,
  RedditIntent,
  RedditAnchor,
  RedditThread,
  RedditInbox,
  RedditAccount,
  RedditBrowser
> = {
  scope: REDDIT_SCOPE,

  // ---------------------------------------------------------------------------
  // Derivation
  // ---------------------------------------------------------------------------

  deriveInbox: (
    events: readonly RedditEvent[],
    accountId: AccountId,
  ): RedditInbox => {
    const allThreads = buildThreadGraphs<GraphMessage, RedditAnchor>(
      events as readonly StorableEvent[],
    );

    const redditThreads = [...allThreads.values()].filter(
      (t) => t.scope === REDDIT_SCOPE,
    );

    const byThreadId: Record<string, RedditIndexMeta> = {};
    let unreadTotal = 0;

    for (const thread of redditThreads) {
      const messages = toMessageViews(thread);
      const unreadCount = calculateUnreadCount(messages, accountId);
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
    const allThreads = buildThreadGraphs<GraphMessage, RedditAnchor>(
      events as readonly StorableEvent[],
    );
    const thread = allThreads.get(threadId);

    if (!thread || thread.scope !== REDDIT_SCOPE) {
      return undefined;
    }

    const authEvent = events.find((e) => e.type === "AuthObserved");
    const accountId = authEvent
      ? (authEvent as { accountId: string }).accountId
      : "";

    return toRedditThread(thread, accountId);
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
          configId?: string;
          browserId?: string;
          authenticated: boolean;
          isBanned?: boolean;
          bannedReason?: string;
        };
        const configId = authEvent.configId ?? authEvent.browserId;
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
          browserId: string;
          retryAfter?: string;
        };
        const configId = rateLimitEvent.browserId;
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
          accountId: string;
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
        authStatus: "unknown" as RedditAuthStatus,
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

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  execute: (
    intent: RedditIntent,
    browsers: readonly RedditBrowser[],
    preferConfigId?: BrowserConfigId,
  ): Effect.Effect<
    { usedConfigId: BrowserConfigId },
    ExecuteError,
    BrowserPool
  > =>
    Effect.gen(function* () {
      const pool = yield* BrowserPool;

      // Select browser: prefer specified, then running+authenticated+not banned, then any running
      let selected: RedditBrowser | undefined;

      if (preferConfigId) {
        selected = browsers.find(
          (b) =>
            b.configId === preferConfigId &&
            b.isRunning &&
            b.authStatus === "authenticated" &&
            !b.isBanned,
        );
      }

      if (!selected) {
        selected = browsers.find(
          (b) =>
            b.isRunning &&
            b.authStatus === "authenticated" &&
            !b.isBanned &&
            !b.rateLimitedUntil,
        );
      }

      if (!selected) {
        selected = browsers.find(
          (b) =>
            b.isRunning && b.authStatus === "authenticated" && !b.isBanned,
        );
      }

      if (!selected) {
        selected = browsers.find((b) => b.isRunning && !b.isBanned);
      }

      if (!selected) {
        return yield* Effect.fail(
          executeError(
            "NoBrowserAvailable",
            "No running browser available (all may be banned or not authenticated)",
          ),
        );
      }

      const configId = selected.configId;

      logger.info(`[Reddit] Executing intent: ${intent.type}`, { configId });

      // Map intent type to bridge command
      const command = (() => {
        switch (intent.type) {
          case "SendDirectMessage":
            return { type: "reddit:sendMessage", payload: intent };
          case "SyncConversations":
            return { type: "reddit:syncConversations", payload: intent };
          case "DiscoverUsers":
            return { type: "reddit:discoverUsers", payload: intent };
        }
      })();

      yield* pool.send(configId, command).pipe(
        Effect.mapError((err) =>
          executeError(
            "CommandFailed",
            `Bridge command failed: ${err.message}`,
            err,
          )
        ),
      );

      return { usedConfigId: configId };
    }),
};
