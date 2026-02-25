// src/platforms/reddit/behavior.ts
// Reddit platform behavior - pure derivation only

import {
  type BrowserConfigId,
  ParticipantId,
  type ParticipantId as ParticipantIdType,
  type ThreadId,
} from "@bernays/server/core";
import {
  applyGraphEvent,
  calculateUnreadCount,
  emptyGraphState,
  extractParticipants,
  type GraphMessage,
  type GraphState,
  materializeThreadGraphs,
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

// Plugin State

interface RedditPluginState {
  graph: GraphState;
  browserStatus: Map<string, {
    authStatus: RedditAuthStatus;
    isBanned: boolean;
    bannedReason?: string;
    rateLimitedUntil?: string;
  }>;
  // Track which accounts have been banned (for updating all browsers)
  bannedAccounts: Map<string, string | undefined>; // participantId -> reason
  contacts: Map<string, {
    username?: string;
    karma?: number;
    accountAge?: string;
    lastInteraction?: string;
  }>;
}

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
  RedditContact,
  RedditPluginState
> = {
  scope: REDDIT_SCOPE,
  identity: "reddit",

  // ---------------------------------------------------------------------------
  // Incremental state management
  // ---------------------------------------------------------------------------

  emptyState: (): RedditPluginState => ({
    graph: emptyGraphState(),
    browserStatus: new Map(),
    bannedAccounts: new Map(),
    contacts: new Map(),
  }),

  applyEvent: (state: RedditPluginState, event: RedditEvent): void => {
    // Always apply graph event (silently ignores non-graph events)
    applyGraphEvent(state.graph, event);

    // AuthObserved: update browserStatus
    if (event.type === "AuthObserved") {
      const authEvent = event as {
        configId: string;
        authenticated: boolean;
        isBanned?: boolean;
        bannedReason?: string;
      };
      const { configId } = authEvent;
      if (configId) {
        const existing = state.browserStatus.get(configId);
        state.browserStatus.set(configId, {
          authStatus: authEvent.authenticated ? "authenticated" : "expired",
          isBanned: authEvent.isBanned ?? existing?.isBanned ?? false,
          bannedReason: authEvent.bannedReason ?? existing?.bannedReason,
          rateLimitedUntil: existing?.rateLimitedUntil,
        });
      }
    }

    // RateLimitObserved: update browserStatus
    if (event.type === "RateLimitObserved") {
      const rateLimitEvent = event as {
        configId: string;
        retryAfter?: string;
      };
      const { configId } = rateLimitEvent;
      const existing = state.browserStatus.get(configId);
      if (existing) {
        state.browserStatus.set(configId, {
          ...existing,
          rateLimitedUntil: rateLimitEvent.retryAfter,
        });
      } else {
        state.browserStatus.set(configId, {
          authStatus: "unknown",
          isBanned: false,
          rateLimitedUntil: rateLimitEvent.retryAfter,
        });
      }
    }

    // AccountBanned: record in bannedAccounts map
    if (event.type === "AccountBanned") {
      const banEvent = event as {
        participantId: ParticipantIdType<"reddit">;
        reason?: string;
      };
      state.bannedAccounts.set(banEvent.participantId as string, banEvent.reason);
    }

    // UserDiscovered: update contacts map
    if (event.type === "UserDiscovered") {
      const userEvent = event as {
        userId: string;
        username: string;
        karma?: number;
        accountAge?: string;
      };
      const existing = state.contacts.get(userEvent.userId) ?? {};
      state.contacts.set(userEvent.userId, {
        ...existing,
        username: userEvent.username,
        karma: userEvent.karma !== undefined ? userEvent.karma : existing.karma,
        accountAge: userEvent.accountAge ?? existing.accountAge,
      });
    }

    // DirectMessageObserved: update contacts lastInteraction
    if (event.type === "DirectMessageObserved") {
      const dmEvent = event as {
        anchor: { participants: readonly string[] };
      };
      for (const pid of dmEvent.anchor.participants) {
        const existing = state.contacts.get(pid) ?? {};
        if (!existing.lastInteraction || event.timestamp > existing.lastInteraction) {
          state.contacts.set(pid, {
            ...existing,
            lastInteraction: event.timestamp,
          });
        }
      }
    }
  },

  // ---------------------------------------------------------------------------
  // View materialization
  // ---------------------------------------------------------------------------

  materializeInbox: (
    state: RedditPluginState,
    participantId: ParticipantIdType<"reddit">,
  ): RedditInbox => {
    const threads = materializeThreadGraphs<RedditScope, GraphMessage, RedditAnchor>(
      REDDIT_SCOPE,
      state.graph,
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

  materializeThread: (
    state: RedditPluginState,
    threadId: ThreadId,
  ): RedditThread | undefined => {
    const threads = materializeThreadGraphs<RedditScope, GraphMessage, RedditAnchor>(
      REDDIT_SCOPE,
      state.graph,
    );
    const thread = threads.get(threadId);

    if (!thread) {
      return undefined;
    }

    // Find participantId from anchor participants (first participant as fallback)
    const participantId = thread.anchor.participants.length > 0
      ? ParticipantId("reddit", thread.anchor.participants[0] as string)
      : ParticipantId("reddit", "");

    return toRedditThread(thread, participantId);
  },

  materializeBrowsers: (
    state: RedditPluginState,
    account: RedditAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly RedditBrowser[] => {
    return account.browserBindings.map((binding) => {
      const status = state.browserStatus.get(binding.configId) ?? {
        authStatus: "unknown" as const,
        isBanned: false,
      };

      // Check if this account's participantId is in bannedAccounts
      const accountParticipantId = account.id as string;
      const isBannedFromAccount = state.bannedAccounts.has(accountParticipantId);
      const bannedReasonFromAccount = state.bannedAccounts.get(accountParticipantId);

      return {
        configId: binding.configId,
        isRunning: runningConfigIds.has(binding.configId),
        metadata: binding.metadata,
        authStatus: status.authStatus,
        isBanned: isBannedFromAccount || status.isBanned,
        bannedReason: isBannedFromAccount ? bannedReasonFromAccount : status.bannedReason,
        rateLimitedUntil: status.rateLimitedUntil,
      };
    });
  },

  materializeContact: (
    state: RedditPluginState,
    participantId: ParticipantIdType<"reddit">,
  ): RedditContact | undefined => {
    const contactData = state.contacts.get(participantId as string);

    // Also check if there's any data at all
    if (!contactData || (!contactData.username && !contactData.lastInteraction)) {
      return undefined;
    }

    return {
      id: participantId,
      name: contactData.username,
      username: contactData.username,
      karma: contactData.karma,
      accountAge: contactData.accountAge,
      lastInteraction: contactData.lastInteraction,
    };
  },

};
