// src/platforms/linkedin/behavior.ts
// LinkedIn platform behavior - pure derivation only

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
  const messages = toMessageViews<"linkedin">(graph);
  const unreadCount = calculateUnreadCount(messages, participantId);

  return {
    threadId: graph.id,
    messages,
    participants: extractParticipants<"linkedin">(graph.anchor),
    anchor: graph.anchor,
    unreadCount,
    isSponsored: false,
    lastActivity: graph.lastActivity,
  };
};

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
  LinkedInContact
> = {
  scope: LINKEDIN_SCOPE,
  identity: "linkedin",

  // ─────────────────────────────────────────────────────────────────────────
  // Derivation
  // ─────────────────────────────────────────────────────────────────────────

  deriveInbox: (
    events: readonly LinkedInEvent[],
    participantId: ParticipantIdType<"linkedin">,
  ): LinkedInInbox => {
    // Events are pre-filtered by scope via the Projection layer
    const threads = buildThreadGraphs<
      LinkedInScope,
      GraphMessage,
      LinkedInAnchor
    >(
      LINKEDIN_SCOPE,
      events,
    );

    const byThreadId: Record<string, LinkedInIndexMeta> = {};
    for (const thread of threads.values()) {
      const messages = toMessageViews<"linkedin">(thread);
      const unreadCount = calculateUnreadCount(messages, participantId);
      byThreadId[thread.id] = {
        lastActivity: thread.lastActivity,
        unreadCount,
        isSponsored: false,
      };
    }

    // Calculate pendingInvitations from events
    // Count sent invitations minus accepted/rejected/withdrawn
    let sentInvitations = 0;
    let resolvedInvitations = 0;

    for (const event of events) {
      if (event.type === "ConnectionRequestSent") {
        sentInvitations++;
      } else if (
        event.type === "ConnectionAccepted" ||
        event.type === "ConnectionRejected" ||
        event.type === "InvitationWithdrawn"
      ) {
        resolvedInvitations++;
      }
    }

    const pendingInvitations = Math.max(
      0,
      sentInvitations - resolvedInvitations,
    );

    // Calculate weeklyInvitesRemaining from events
    // LinkedIn allows ~100 invites per week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoIso = oneWeekAgo.toISOString();

    let weeklyInvitesSent = 0;
    for (const event of events) {
      if (
        event.type === "ConnectionRequestSent" &&
        event.timestamp > oneWeekAgoIso
      ) {
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

  deriveThread: (
    events: readonly LinkedInEvent[],
    threadId: ThreadId,
  ): LinkedInThread | undefined => {
    // Events are pre-filtered by scope via the Projection layer
    const threads = buildThreadGraphs<
      LinkedInScope,
      GraphMessage,
      LinkedInAnchor
    >(
      LINKEDIN_SCOPE,
      events,
    );
    const thread = threads.get(threadId);

    if (!thread) {
      return undefined;
    }

    const authEvent = events.find((e) => e.type === "AuthObserved");
    const participantId = authEvent
      ? (authEvent as { participantId: ParticipantIdType<"linkedin"> })
        .participantId
      : ParticipantId("linkedin", "");

    return toLinkedInThread(thread, participantId);
  },

  deriveBrowsers: (
    events: readonly LinkedInEvent[],
    account: LinkedInAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly LinkedInBrowser[] => {
    // Build browser status from events
    const browserStatus = new Map<
      string,
      {
        authStatus: LinkedInAuthStatus;
        rateLimitedUntil?: string;
        weeklyInvitesSent: number;
      }
    >();

    // Calculate weekly invites sent per browser
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoIso = oneWeekAgo.toISOString();

    // Process events (latest wins for auth, accumulate for rate limits)
    for (const event of events) {
      if (event.type === "AuthObserved") {
        const authEvent = event as {
          configId: string;
          authenticated: boolean;
        };
        const { configId } = authEvent;
        if (configId) {
          const existing = browserStatus.get(configId);
          browserStatus.set(configId, {
            authStatus: authEvent.authenticated ? "authenticated" : "expired",
            rateLimitedUntil: existing?.rateLimitedUntil,
            weeklyInvitesSent: existing?.weeklyInvitesSent ?? 0,
          });
        }
      } else if (event.type === "RateLimitObserved") {
        const rateLimitEvent = event as {
          configId: string;
          retryAfter?: string;
        };
        const { configId } = rateLimitEvent;
        if (configId) {
          const existing = browserStatus.get(configId);
          // Only set rateLimitedUntil if retryAfter is in the future
          const retryAfter = rateLimitEvent.retryAfter;
          const isActive = retryAfter && retryAfter > new Date().toISOString();
          browserStatus.set(configId, {
            authStatus: existing?.authStatus ?? "unknown",
            rateLimitedUntil: isActive ? retryAfter : undefined,
            weeklyInvitesSent: existing?.weeklyInvitesSent ?? 0,
          });
        }
      } else if (
        event.type === "ConnectionRequestSent" &&
        event.timestamp > oneWeekAgoIso
      ) {
        // Track weekly invites per browser using correlationId to identify browser
        // For now, we track globally since events don't have configId
        // In a full implementation, we'd track per-browser
      }
    }

    // Count total weekly invites sent (global for now)
    let totalWeeklyInvitesSent = 0;
    for (const event of events) {
      if (
        event.type === "ConnectionRequestSent" &&
        event.timestamp > oneWeekAgoIso
      ) {
        totalWeeklyInvitesSent++;
      }
    }

    const weeklyInvitesRemaining = Math.max(0, 100 - totalWeeklyInvitesSent);

    // Map account's browser bindings to LinkedInBrowser
    return account.browserBindings.map((binding) => {
      const status = browserStatus.get(binding.configId) ?? {
        authStatus: "unknown" as const,
        weeklyInvitesSent: 0,
      };

      return {
        configId: binding.configId,
        isRunning: runningConfigIds.has(binding.configId),
        metadata: binding.metadata,
        authStatus: status.authStatus,
        rateLimitedUntil: status.rateLimitedUntil,
        weeklyInvitesRemaining,
      };
    });
  },

  deriveContact: (
    events: readonly LinkedInEvent[],
    participantId: ParticipantIdType<"linkedin">,
  ): LinkedInContact | undefined => {
    let name: string | undefined;
    let headline: string | undefined;
    let profileUrl: string | undefined;
    let lastInteraction: string | undefined;
    let connectionDegree: "1st" | "2nd" | "3rd" | "out" | undefined;

    for (const event of events) {
      // Extract info from search results
      if (event.type === "SearchResultsRetrieved") {
        const searchEvent = event as {
          results: Array<{ userId: string; name?: string; headline?: string }>;
        };
        const match = searchEvent.results.find(
          (r) => r.userId === participantId,
        );
        if (match) {
          if (match.name) name = match.name;
          if (match.headline) headline = match.headline;
        }
      }

      // Extract info from profile views
      if (event.type === "ProfileViewed") {
        const profileEvent = event as {
          targetUserId: string;
          profileUrl?: string;
          viewedAt: string;
        };
        if (profileEvent.targetUserId === participantId) {
          if (profileEvent.profileUrl) profileUrl = profileEvent.profileUrl;
          if (
            !lastInteraction ||
            profileEvent.viewedAt > lastInteraction
          ) {
            lastInteraction = profileEvent.viewedAt;
          }
        }
      }

      // Track connection status
      if (event.type === "ConnectionRequestSent") {
        const connEvent = event as { targetUserId: string };
        if (connEvent.targetUserId === participantId) {
          connectionDegree = "out"; // pending
        }
      }

      if (event.type === "ConnectionAccepted") {
        const connEvent = event as { userId: string };
        if (connEvent.userId === participantId) {
          connectionDegree = "1st";
        }
      }

      // Extract names from message anchor participants
      if (event.type === "AnchorMessageObserved") {
        const anchorEvent = event as {
          anchor: { participants: readonly string[] };
          senderId: string;
        };
        if (anchorEvent.anchor.participants.includes(participantId as string)) {
          if (
            !lastInteraction ||
            event.timestamp > lastInteraction
          ) {
            lastInteraction = event.timestamp;
          }
          // If they're in a DM with us, they're likely 1st degree
          if (!connectionDegree) {
            connectionDegree = "1st";
          }
        }
      }
    }

    // Only return contact if we found any info
    if (!name && !headline && !profileUrl && !lastInteraction) {
      return undefined;
    }

    return {
      id: participantId,
      name,
      headline,
      profileUrl,
      connectionDegree,
      lastInteraction,
    };
  },
};
