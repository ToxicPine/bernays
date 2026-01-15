// src/platforms/x/behavior.ts
// X (Twitter) platform behavior - pure derivation only

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
import type { XAnchor, XEvent } from "./schemas.ts";
import type { XInbox, XIndexMeta, XThread } from "./views.ts";
import type { XAccount } from "./account.ts";
import { type XAuthStatus, type XBrowser } from "./browser.ts";
import type { XContact } from "./contact.ts";
import { X_SCOPE } from "./schemas.ts";

// Type Alias

type XScope = typeof X_SCOPE;

// Helper Functions

/**
 * Convert ThreadGraph to XThread
 */
const toXThread = (
  graph: ThreadGraph<XScope, GraphMessage, XAnchor>,
  participantId: ParticipantIdType<"x">,
): XThread => {
  const messages = toMessageViews<"x">(graph);
  const unreadCount = calculateUnreadCount(messages, participantId);

  return {
    threadId: graph.id,
    messages,
    participants: extractParticipants<"x">(graph.anchor),
    anchor: graph.anchor,
    unreadCount,
    lastActivity: graph.lastActivity,
    isArchived: false,
  };
};

// X Behavior

export const xBehavior: PlatformBehavior<
  XScope,
  "x",
  XEvent,
  XAnchor,
  XThread,
  XInbox,
  XAccount,
  XBrowser,
  XContact
> = {
  scope: X_SCOPE,
  identity: "x",

  // ─────────────────────────────────────────────────────────────────────────
  // Derivation
  // ─────────────────────────────────────────────────────────────────────────

  deriveInbox: (
    events: readonly XEvent[],
    participantId: ParticipantIdType<"x">,
  ): XInbox => {
    // Events are pre-filtered by scope via the Projection layer
    const threads = buildThreadGraphs<XScope, GraphMessage, XAnchor>(
      X_SCOPE,
      events,
    );

    const byThreadId: Record<string, XIndexMeta> = {};
    let totalUnread = 0;

    for (const thread of threads.values()) {
      const messages = toMessageViews<"x">(thread);
      const unreadCount = calculateUnreadCount(messages, participantId);
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
    // Events are pre-filtered by scope via the Projection layer
    const threads = buildThreadGraphs<XScope, GraphMessage, XAnchor>(
      X_SCOPE,
      events,
    );
    const thread = threads.get(threadId);

    if (!thread) {
      return undefined;
    }

    const authEvent = events.find((e) => e.type === "AuthObserved");
    const participantId = authEvent
      ? (authEvent as { participantId: ParticipantIdType<"x"> }).participantId
      : ParticipantId("x", "");

    return toXThread(thread, participantId);
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
          configId: string;
          authenticated: boolean;
          canRead?: boolean;
          canWrite?: boolean;
          issue?: string;
        };
        const { configId } = authEvent;
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
        authStatus: "unknown" as const,
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

  deriveContact: (
    events: readonly XEvent[],
    participantId: ParticipantIdType<"x">,
  ): XContact | undefined => {
    let handle: string | undefined;
    let following = false;
    let lastInteraction: string | undefined;

    for (const event of events) {
      // Extract info from tweets
      if (event.type === "TweetObserved") {
        const tweetEvent = event as {
          authorId: string;
          authorHandle: string;
          createdAt: string;
        };
        if (tweetEvent.authorId === participantId) {
          handle = tweetEvent.authorHandle;
          if (
            !lastInteraction ||
            tweetEvent.createdAt > lastInteraction
          ) {
            lastInteraction = tweetEvent.createdAt;
          }
        }
      }

      // Track follow status
      if (event.type === "FollowObserved") {
        const followEvent = event as {
          targetUserId: string;
          targetHandle: string;
          followedAt: string;
        };
        if (followEvent.targetUserId === participantId) {
          following = true;
          handle = followEvent.targetHandle;
          if (
            !lastInteraction ||
            followEvent.followedAt > lastInteraction
          ) {
            lastInteraction = followEvent.followedAt;
          }
        }
      }

      // Extract from DM anchor participants
      if (event.type === "AnchorMessageObserved") {
        const anchorEvent = event as {
          anchor: { participants: readonly string[] };
        };
        if (anchorEvent.anchor.participants.includes(participantId as string)) {
          if (!lastInteraction || event.timestamp > lastInteraction) {
            lastInteraction = event.timestamp;
          }
        }
      }
    }

    // Only return contact if we found any info
    if (!handle && !lastInteraction) {
      return undefined;
    }

    return {
      id: participantId,
      handle,
      following,
      lastInteraction,
    };
  },
};
