// src/platforms/x/behavior.ts
// X (Twitter) platform behavior - pure derivation only

import {
  type BrowserConfigId,
  ParticipantId,
  ParticipantIdFromString,
  type ParticipantId as ParticipantIdType,
  type ThreadId,
} from "@bernays/server/core";
import {
  applyGraphEvent,
  calculateUnreadCount,
  emptyGraphState,
  type GraphMessage,
  type GraphState,
  graphNodesToMessages,
  materializeThreadGraphs,
  type ThreadGraph,
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

// Plugin State

export interface XPluginState {
  graph: GraphState;
  browserStatus: Map<string, {
    authStatus: XAuthStatus;
    rateLimitedUntil?: string;
    suspended: boolean;
    canRead: boolean;
    canWrite: boolean;
  }>;
  accountSuspended: boolean;
  contacts: Map<string, {
    handle?: string;
    following: boolean;
    lastInteraction?: string;
  }>;
}

// Helper Functions

/**
 * Convert ThreadGraph to XThread
 */
const toXThread = (
  graph: ThreadGraph<XScope, GraphMessage, XAnchor>,
  participantId: ParticipantIdType<"x">,
): XThread => {
  const messages = graphNodesToMessages(graph.nodes).map((m) => ({
    id: m.canonicalId,
    senderId: ParticipantIdFromString<"x">(m.senderId),
    content: m.content,
    timestamp: m.timestamp,
  }));
  const unreadCount = calculateUnreadCount(messages, participantId);

  return {
    threadId: graph.id,
    messages,
    participants: graph.anchor.participants.map((id) => ({ id })),
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
  XContact,
  XPluginState
> = {
  scope: X_SCOPE,
  identity: "x",

  // ─────────────────────────────────────────────────────────────────────────
  // Incremental state management
  // ─────────────────────────────────────────────────────────────────────────

  emptyState: (): XPluginState => ({
    graph: emptyGraphState(),
    browserStatus: new Map(),
    accountSuspended: false,
    contacts: new Map(),
  }),

  applyEvent: (state: XPluginState, event: XEvent): void => {
    // Always apply to graph state (non-graph events are silently ignored)
    applyGraphEvent(state.graph, event);

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
        state.browserStatus.set(configId, {
          authStatus: authEvent.authenticated ? "authenticated" : "expired",
          rateLimitedUntil: state.browserStatus.get(configId)?.rateLimitedUntil,
          suspended: isSuspended,
          canRead: authEvent.canRead ?? false,
          canWrite: authEvent.canWrite ?? false,
        });
      }
    }

    if (event.type === "RateLimitObserved") {
      const rateLimitEvent = event as {
        configId: string;
        retryAfter?: string;
      };
      const existing = state.browserStatus.get(rateLimitEvent.configId);
      if (existing) {
        state.browserStatus.set(rateLimitEvent.configId, {
          ...existing,
          rateLimitedUntil: rateLimitEvent.retryAfter,
        });
      }
    }

    if (event.type === "AccountSuspended") {
      state.accountSuspended = true;
    }

    if (event.type === "TweetObserved") {
      const tweetEvent = event as {
        authorId: string;
        authorHandle: string;
        createdAt: string;
      };
      const contactId = tweetEvent.authorId;
      const existing = state.contacts.get(contactId);
      const lastInteraction = existing?.lastInteraction;
      state.contacts.set(contactId, {
        handle: tweetEvent.authorHandle,
        following: existing?.following ?? false,
        lastInteraction:
          !lastInteraction || tweetEvent.createdAt > lastInteraction
            ? tweetEvent.createdAt
            : lastInteraction,
      });
    }

    if (event.type === "FollowObserved") {
      const followEvent = event as {
        targetUserId: string;
        targetHandle: string;
        followedAt: string;
      };
      const contactId = followEvent.targetUserId;
      const existing = state.contacts.get(contactId);
      const lastInteraction = existing?.lastInteraction;
      state.contacts.set(contactId, {
        handle: followEvent.targetHandle,
        following: true,
        lastInteraction:
          !lastInteraction || followEvent.followedAt > lastInteraction
            ? followEvent.followedAt
            : lastInteraction,
      });
    }

    if (event.type === "AnchorMessageObserved") {
      const anchorEvent = event as {
        anchor: { participants: readonly string[] };
      };
      for (const pid of anchorEvent.anchor.participants) {
        const existing = state.contacts.get(pid);
        const lastInteraction = existing?.lastInteraction;
        if (!lastInteraction || event.timestamp > lastInteraction) {
          state.contacts.set(pid, {
            handle: existing?.handle,
            following: existing?.following ?? false,
            lastInteraction: event.timestamp,
          });
        }
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // View materialization
  // ─────────────────────────────────────────────────────────────────────────

  materializeInbox: (
    state: XPluginState,
    participantId: ParticipantIdType<"x">,
  ): XInbox => {
    const threads = materializeThreadGraphs<XScope, GraphMessage, XAnchor>(
      X_SCOPE,
      state.graph,
    );

    const byThreadId: Record<string, XIndexMeta> = {};
    let totalUnread = 0;

    for (const thread of threads.values()) {
      const messages = graphNodesToMessages(thread.nodes).map((m) => ({
        id: m.canonicalId,
        senderId: ParticipantIdFromString<"x">(m.senderId),
        content: m.content,
        timestamp: m.timestamp,
      }));
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

  materializeThread: (
    state: XPluginState,
    threadId: ThreadId,
  ): XThread | undefined => {
    const threads = materializeThreadGraphs<XScope, GraphMessage, XAnchor>(
      X_SCOPE,
      state.graph,
    );
    const thread = threads.get(threadId);

    if (!thread) {
      return undefined;
    }

    // Find participantId from the first anchor node's participants
    // (incremental path doesn't have access to raw events, so we derive from the graph)
    const participantId = ParticipantId("x", "");
    return toXThread(thread, participantId);
  },

  materializeBrowsers: (
    state: XPluginState,
    account: XAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly XBrowser[] => {
    return account.browserBindings.map((binding) => {
      const status = state.browserStatus.get(binding.configId) ?? {
        authStatus: "unknown" as const,
        suspended: false,
        canRead: false,
        canWrite: false,
      };

      const suspended = state.accountSuspended || status.suspended;
      const canWrite = state.accountSuspended ? false : status.canWrite;

      return {
        configId: binding.configId,
        isRunning: runningConfigIds.has(binding.configId),
        metadata: binding.metadata,
        authStatus: status.authStatus,
        suspended,
        rateLimitedUntil: status.rateLimitedUntil,
        canRead: status.canRead,
        canWrite,
      };
    });
  },

  materializeContact: (
    state: XPluginState,
    participantId: ParticipantIdType<"x">,
  ): XContact | undefined => {
    const contact = state.contacts.get(participantId as string);

    if (!contact) {
      return undefined;
    }

    // Only return contact if we found any info
    if (!contact.handle && !contact.lastInteraction) {
      return undefined;
    }

    return {
      id: participantId,
      handle: contact.handle,
      following: contact.following,
      lastInteraction: contact.lastInteraction,
    };
  },

};
