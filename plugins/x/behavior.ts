// src/platforms/x/behavior.ts
// X (Twitter) platform behavior - derivation and execution

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
import type { XAnchor, XEvent } from "./schemas.ts";
import type { XIntent } from "./schemas.ts";
import type { XInbox, XIndexMeta, XThread } from "./views.ts";
import type { XAccount } from "./account.ts";
import type { XAuthStatus, XBrowser } from "./browser.ts";
import { X_SCOPE } from "./schemas.ts";

// ============================================================================
// Type Alias
// ============================================================================

type XScope = typeof X_SCOPE;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert graph nodes to MessageView format
 */
const toMessageViews = (
  graph: ThreadGraph<GraphMessage, XAnchor>,
): readonly MessageView[] =>
  graphNodesToMessages(graph.nodes).map((m) => ({
    id: m.canonicalId,
    senderId: m.senderId,
    content: m.content,
    timestamp: m.timestamp,
  }));

/**
 * Extract participants from X anchor
 */
const extractParticipants = (anchor: XAnchor): readonly Participant[] =>
  anchor.participants.map((id) => ({ id }));

/**
 * Convert ThreadGraph to XThread
 */
const toXThread = (
  graph: ThreadGraph<GraphMessage, XAnchor>,
  accountId: string,
): XThread => {
  const messages = toMessageViews(graph);
  const unreadCount = calculateUnreadCount(messages, accountId);

  return {
    threadId: graph.id,
    messages,
    participants: extractParticipants(graph.anchor),
    anchor: graph.anchor,
    unreadCount,
    lastActivity: graph.lastActivity,
    isArchived: false,
  };
};

// ============================================================================
// X Behavior
// ============================================================================

export const xBehavior: PlatformBehavior<
  XScope,
  XEvent,
  XIntent,
  XAnchor,
  XThread,
  XInbox,
  XAccount,
  XBrowser
> = {
  scope: X_SCOPE,

  // ---------------------------------------------------------------------------
  // Derivation
  // ---------------------------------------------------------------------------

  deriveInbox: (
    events: readonly XEvent[],
    accountId: AccountId,
  ): XInbox => {
    const allThreads = buildThreadGraphs<GraphMessage, XAnchor>(
      events as readonly StorableEvent[],
    );

    const xThreads = [...allThreads.values()].filter(
      (t) => t.scope === X_SCOPE,
    );

    const byThreadId: Record<string, XIndexMeta> = {};
    let totalUnread = 0;

    for (const thread of xThreads) {
      const messages = toMessageViews(thread);
      const unreadCount = calculateUnreadCount(messages, accountId);
      totalUnread += unreadCount;

      byThreadId[thread.id] = {
        lastActivity: thread.lastActivity,
        unreadCount,
        participantCount: thread.anchor.participants.length,
      };
    }

    return {
      byThreadId,
      syncedAt: new Date().toISOString(),
      totalUnread,
    };
  },

  deriveThread: (
    events: readonly XEvent[],
    threadId: ThreadId,
  ): XThread | undefined => {
    const allThreads = buildThreadGraphs<GraphMessage, XAnchor>(
      events as readonly StorableEvent[],
    );
    const thread = allThreads.get(threadId);

    if (!thread || thread.scope !== X_SCOPE) {
      return undefined;
    }

    const authEvent = events.find((e) => e.type === "AuthObserved");
    const accountId = authEvent
      ? (authEvent as { accountId: string }).accountId
      : "";

    return toXThread(thread, accountId);
  },

  deriveBrowsers: (
    events: readonly XEvent[],
    account: XAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly XBrowser[] => {
    // Build browser status from events
    const browserStatus = new Map<
      string,
      {
        authStatus: XAuthStatus;
        rateLimitedUntil?: string;
        suspended: boolean;
        canRead: boolean;
        canWrite: boolean;
      }
    >();

    // Process auth events (latest wins)
    for (const event of events) {
      if (event.type === "AuthObserved") {
        const authEvent = event as {
          configId?: string;
          browserId?: string;
          authenticated: boolean;
          canRead?: boolean;
          canWrite?: boolean;
          issue?: string;
        };
        const configId = authEvent.configId ?? authEvent.browserId;
        if (configId) {
          const isSuspended = authEvent.issue === "suspended";
          browserStatus.set(configId, {
            authStatus: authEvent.authenticated ? "authenticated" : "expired",
            rateLimitedUntil: browserStatus.get(configId)?.rateLimitedUntil,
            suspended: isSuspended,
            canRead: authEvent.canRead ?? false,
            canWrite: authEvent.canWrite ?? false,
          });
        }
      }

      // Process rate limit events
      if (event.type === "RateLimitObserved") {
        const rateLimitEvent = event as {
          configId: string;
          retryAfter?: string;
        };
        const existing = browserStatus.get(rateLimitEvent.configId);
        if (existing) {
          browserStatus.set(rateLimitEvent.configId, {
            ...existing,
            rateLimitedUntil: rateLimitEvent.retryAfter,
          });
        }
      }

      // Process account suspension events
      if (event.type === "AccountSuspended") {
        // Mark all browsers for this account as suspended
        for (const binding of account.browserBindings) {
          const existing = browserStatus.get(binding.configId);
          if (existing) {
            browserStatus.set(binding.configId, {
              ...existing,
              suspended: true,
              canWrite: false,
            });
          }
        }
      }
    }

    // Map account's browser bindings to XBrowser
    return account.browserBindings.map((binding) => {
      const status = browserStatus.get(binding.configId) ?? {
        authStatus: "unknown" as XAuthStatus,
        suspended: false,
        canRead: false,
        canWrite: false,
      };

      return {
        configId: binding.configId,
        isRunning: runningConfigIds.has(binding.configId),
        metadata: binding.metadata,
        authStatus: status.authStatus,
        suspended: status.suspended,
        rateLimitedUntil: status.rateLimitedUntil,
        canRead: status.canRead,
        canWrite: status.canWrite,
      };
    });
  },

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  execute: (
    intent: XIntent,
    browsers: readonly XBrowser[],
    preferConfigId?: BrowserConfigId,
  ): Effect.Effect<
    { usedConfigId: BrowserConfigId },
    ExecuteError,
    BrowserPool
  > =>
    Effect.gen(function* () {
      const pool = yield* BrowserPool;

      // Select browser: prefer specified, then running+authenticated+not-suspended, then any running
      let selected: XBrowser | undefined;

      if (preferConfigId) {
        selected = browsers.find(
          (b) =>
            b.configId === preferConfigId &&
            b.isRunning &&
            b.authStatus === "authenticated" &&
            !b.suspended,
        );
      }

      if (!selected) {
        selected = browsers.find(
          (b) =>
            b.isRunning &&
            b.authStatus === "authenticated" &&
            !b.suspended &&
            b.canWrite,
        );
      }

      if (!selected) {
        selected = browsers.find(
          (b) => b.isRunning && b.authStatus === "authenticated" && !b.suspended,
        );
      }

      if (!selected) {
        selected = browsers.find((b) => b.isRunning && !b.suspended);
      }

      if (!selected) {
        return yield* Effect.fail(
          executeError("NoBrowserAvailable", "No running browser available"),
        );
      }

      // Check if browser is rate limited
      if (selected.rateLimitedUntil) {
        const retryAfter = new Date(selected.rateLimitedUntil);
        if (retryAfter > new Date()) {
          return yield* Effect.fail(
            executeError(
              "RateLimited",
              `Browser rate limited until ${selected.rateLimitedUntil}`,
            ),
          );
        }
      }

      const configId = selected.configId;

      logger.info(`[X] Executing intent: ${intent.type}`, { configId });

      // Map intent type to bridge command
      const command = (() => {
        switch (intent.type) {
          case "SendMessage":
            return { type: "x:sendMessage", payload: intent };
          case "SyncConversations":
            return { type: "x:syncConversations", payload: intent };
          case "PostTweet":
            return { type: "x:postTweet", payload: intent };
          case "ReplyToTweet":
            return { type: "x:replyToTweet", payload: intent };
          case "Retweet":
            return { type: "x:retweet", payload: intent };
          case "Like":
            return { type: "x:like", payload: intent };
          case "Unlike":
            return { type: "x:unlike", payload: intent };
          case "Follow":
            return { type: "x:follow", payload: intent };
          case "Unfollow":
            return { type: "x:unfollow", payload: intent };
          case "DeleteTweet":
            return { type: "x:deleteTweet", payload: intent };
          case "BookmarkTweet":
            return { type: "x:bookmarkTweet", payload: intent };
          case "SearchTweets":
            return { type: "x:searchTweets", payload: intent };
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
