// src/platforms/linkedin/behavior.ts
// LinkedIn platform behavior - pure derivation only

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
import type { LinkedInAnchor, LinkedInEvent } from "./schemas.ts";
import type {
  LinkedInInbox,
  LinkedInIndexMeta,
  LinkedInThread,
} from "./views.ts";
import type { LinkedInAccount } from "./account.ts";
import { type LinkedInAuthStatus, type LinkedInBrowser } from "./browser.ts";
import type { LinkedInContact } from "./contact.ts";
import { LINKEDIN_SCOPE } from "./schemas.ts";

// Type Alias

type LinkedInScope = typeof LINKEDIN_SCOPE;

// Helper Functions

/**
 * Convert ThreadGraph to LinkedInThread
 */
const toLinkedInThread = (
  graph: ThreadGraph<LinkedInScope, GraphMessage, LinkedInAnchor>,
  participantId: ParticipantIdType<"linkedin">,
): LinkedInThread => {
  const messages = graphNodesToMessages(graph.nodes).map((m) => ({
    id: m.canonicalId,
    senderId: ParticipantIdFromString<"linkedin">(m.senderId),
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
    isSponsored: false,
    lastActivity: graph.lastActivity,
  };
};

// Plugin State

export interface LinkedInPluginState {
  graph: GraphState;
  sentInvitations: number;
  resolvedInvitations: number;
  weeklyInviteTimestamps: string[];  // timestamps of ConnectionRequestSent events
  browserStatus: Map<string, {
    authStatus: LinkedInAuthStatus;
    rateLimitedUntil?: string;
  }>;
  contacts: Map<string, {
    name?: string;
    headline?: string;
    profileUrl?: string;
    lastInteraction?: string;
    connectionDegree?: "1st" | "2nd" | "3rd" | "out";
  }>;
}

// LinkedIn Behavior

export const linkedInBehavior: PlatformBehavior<
  LinkedInScope,
  "linkedin",
  LinkedInEvent,
  LinkedInAnchor,
  LinkedInThread,
  LinkedInInbox,
  LinkedInAccount,
  LinkedInBrowser,
  LinkedInContact,
  LinkedInPluginState
> = {
  scope: LINKEDIN_SCOPE,
  identity: "linkedin",

  // ─────────────────────────────────────────────────────────────────────────
  // Incremental state management
  // ─────────────────────────────────────────────────────────────────────────

  emptyState: (): LinkedInPluginState => ({
    graph: emptyGraphState(),
    sentInvitations: 0,
    resolvedInvitations: 0,
    weeklyInviteTimestamps: [],
    browserStatus: new Map(),
    contacts: new Map(),
  }),

  applyEvent: (state: LinkedInPluginState, event: LinkedInEvent): void => {
    // Always apply to graph state (handles anchor/reply/mutation events)
    applyGraphEvent(state.graph, event);

    // Invitation tracking
    if (event.type === "ConnectionRequestSent") {
      state.sentInvitations++;
      state.weeklyInviteTimestamps.push(event.timestamp);

      // Update contact: mark as "out" (pending)
      const connEvent = event as { targetUserId: string };
      if (connEvent.targetUserId) {
        const existing = state.contacts.get(connEvent.targetUserId) ?? {};
        state.contacts.set(connEvent.targetUserId, {
          ...existing,
          connectionDegree: "out",
        });
      }
    } else if (
      event.type === "ConnectionAccepted" ||
      event.type === "ConnectionRejected" ||
      event.type === "InvitationWithdrawn"
    ) {
      state.resolvedInvitations++;

      // Update contact: mark as "1st" on acceptance
      if (event.type === "ConnectionAccepted") {
        const connEvent = event as { userId: string };
        if (connEvent.userId) {
          const existing = state.contacts.get(connEvent.userId) ?? {};
          state.contacts.set(connEvent.userId, {
            ...existing,
            connectionDegree: "1st",
          });
        }
      }
    }

    // Browser auth tracking
    if (event.type === "AuthObserved") {
      const authEvent = event as {
        configId: string;
        authenticated: boolean;
      };
      const { configId } = authEvent;
      if (configId) {
        const existing = state.browserStatus.get(configId);
        state.browserStatus.set(configId, {
          authStatus: authEvent.authenticated ? "authenticated" : "expired",
          rateLimitedUntil: existing?.rateLimitedUntil,
        });
      }
    }

    // Browser rate limit tracking
    if (event.type === "RateLimitObserved") {
      const rateLimitEvent = event as {
        configId: string;
        retryAfter?: string;
      };
      const { configId } = rateLimitEvent;
      if (configId) {
        const existing = state.browserStatus.get(configId);
        state.browserStatus.set(configId, {
          authStatus: existing?.authStatus ?? "unknown",
          rateLimitedUntil: rateLimitEvent.retryAfter,
        });
      }
    }

    // Contact tracking from search results
    if (event.type === "SearchResultsRetrieved") {
      const searchEvent = event as {
        results: Array<{ userId: string; name?: string; headline?: string }>;
      };
      for (const result of searchEvent.results) {
        const existing = state.contacts.get(result.userId) ?? {};
        state.contacts.set(result.userId, {
          ...existing,
          ...(result.name ? { name: result.name } : {}),
          ...(result.headline ? { headline: result.headline } : {}),
        });
      }
    }

    // Contact tracking from profile views
    if (event.type === "ProfileViewed") {
      const profileEvent = event as {
        targetUserId: string;
        profileUrl?: string;
        viewedAt: string;
      };
      if (profileEvent.targetUserId) {
        const existing = state.contacts.get(profileEvent.targetUserId) ?? {};
        state.contacts.set(profileEvent.targetUserId, {
          ...existing,
          ...(profileEvent.profileUrl
            ? { profileUrl: profileEvent.profileUrl }
            : {}),
          ...(!existing.lastInteraction ||
          profileEvent.viewedAt > existing.lastInteraction
            ? { lastInteraction: profileEvent.viewedAt }
            : {}),
        });
      }
    }

    // Contact tracking from message anchors
    if (event.type === "AnchorMessageObserved") {
      const anchorEvent = event as {
        anchor: { participants: readonly string[] };
        senderId: string;
      };
      for (const pid of anchorEvent.anchor.participants) {
        const existing = state.contacts.get(pid) ?? {};
        const updated: typeof existing = { ...existing };
        if (
          !existing.lastInteraction ||
          event.timestamp > existing.lastInteraction
        ) {
          updated.lastInteraction = event.timestamp;
        }
        // If they're in a DM with us, they're likely 1st degree
        if (!existing.connectionDegree) {
          updated.connectionDegree = "1st";
        }
        state.contacts.set(pid, updated);
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // View materialization
  // ─────────────────────────────────────────────────────────────────────────

  materializeInbox: (
    state: LinkedInPluginState,
    participantId: ParticipantIdType<"linkedin">,
  ): LinkedInInbox => {
    const threads = materializeThreadGraphs<
      LinkedInScope,
      GraphMessage,
      LinkedInAnchor
    >(LINKEDIN_SCOPE, state.graph);

    const byThreadId: Record<string, LinkedInIndexMeta> = {};
    for (const thread of threads.values()) {
      const messages = graphNodesToMessages(thread.nodes).map((m) => ({
        id: m.canonicalId,
        senderId: ParticipantIdFromString<"linkedin">(m.senderId),
        content: m.content,
        timestamp: m.timestamp,
      }));
      const unreadCount = calculateUnreadCount(messages, participantId);
      byThreadId[thread.id] = {
        lastActivity: thread.lastActivity,
        unreadCount,
        isSponsored: false,
      };
    }

    const pendingInvitations = Math.max(
      0,
      state.sentInvitations - state.resolvedInvitations,
    );

    // Calculate weeklyInvitesRemaining from timestamps
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoIso = oneWeekAgo.toISOString();

    let weeklyInvitesSent = 0;
    for (const ts of state.weeklyInviteTimestamps) {
      if (ts > oneWeekAgoIso) {
        weeklyInvitesSent++;
      }
    }

    const weeklyInvitesRemaining = Math.max(0, 100 - weeklyInvitesSent);

    return {
      byThreadId,
      syncedAt: new Date().toISOString(),
      pendingInvitations,
      weeklyInvitesRemaining,
    };
  },

  materializeThread: (
    state: LinkedInPluginState,
    threadId: ThreadId,
  ): LinkedInThread | undefined => {
    const threads = materializeThreadGraphs<
      LinkedInScope,
      GraphMessage,
      LinkedInAnchor
    >(LINKEDIN_SCOPE, state.graph);
    const thread = threads.get(threadId);

    if (!thread) {
      return undefined;
    }

    // Since we don't store participantId in state, fall back to empty.
    // TODO: Consider storing participantId from AuthObserved events in plugin state.
    const participantId = ParticipantId("linkedin", "");

    return toLinkedInThread(thread, participantId);
  },

  materializeBrowsers: (
    state: LinkedInPluginState,
    account: LinkedInAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly LinkedInBrowser[] => {
    // Calculate weekly invites remaining from timestamps
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoIso = oneWeekAgo.toISOString();

    let totalWeeklyInvitesSent = 0;
    for (const ts of state.weeklyInviteTimestamps) {
      if (ts > oneWeekAgoIso) {
        totalWeeklyInvitesSent++;
      }
    }

    const weeklyInvitesRemaining = Math.max(0, 100 - totalWeeklyInvitesSent);

    return account.browserBindings.map((binding) => {
      const status = state.browserStatus.get(binding.configId);

      // Only apply rateLimitedUntil if it's still in the future
      const rateLimitedUntil = status?.rateLimitedUntil;
      const isActive =
        rateLimitedUntil && rateLimitedUntil > new Date().toISOString();

      return {
        configId: binding.configId,
        isRunning: runningConfigIds.has(binding.configId),
        metadata: binding.metadata,
        authStatus: status?.authStatus ?? ("unknown" as const),
        rateLimitedUntil: isActive ? rateLimitedUntil : undefined,
        weeklyInvitesRemaining,
      };
    });
  },

  materializeContact: (
    state: LinkedInPluginState,
    participantId: ParticipantIdType<"linkedin">,
  ): LinkedInContact | undefined => {
    const contact = state.contacts.get(participantId as string);

    if (!contact) {
      return undefined;
    }

    // Only return contact if we found any info
    if (
      !contact.name &&
      !contact.headline &&
      !contact.profileUrl &&
      !contact.lastInteraction
    ) {
      return undefined;
    }

    return {
      id: participantId,
      name: contact.name,
      headline: contact.headline,
      profileUrl: contact.profileUrl,
      connectionDegree: contact.connectionDegree,
      lastInteraction: contact.lastInteraction,
    };
  },

};
