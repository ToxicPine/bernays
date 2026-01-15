// plugins/linkedindojo/behavior.ts
// LinkedIn Dojo behavior - reuses LinkedIn derivation, pure derivation only

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
import { makeInjectorTag } from "@bernays/server/projections";

import type { LinkedInAnchor } from "../linkedin/schemas.ts";
import type {
  LinkedInInbox,
  LinkedInIndexMeta,
  LinkedInThread,
} from "../linkedin/views.ts";
import type { LinkedInAccount } from "../linkedin/account.ts";
import {
  type LinkedInAuthStatus,
  type LinkedInBrowser,
} from "../linkedin/browser.ts";
import type { LinkedInContact } from "../linkedin/contact.ts";

import {
  LINKEDIN_DOJO_SCOPE,
  type LinkedInDojoEvent,
  type LinkedInDojoScope,
} from "./schemas.ts";

const LINKEDIN_IDENTITY = "linkedin" as const;
type LinkedInIdentity = typeof LINKEDIN_IDENTITY;

export const LinkedInDojoInjector = makeInjectorTag<LinkedInDojoEvent>(
  "LinkedInDojoInjector",
);

const toLinkedInThread = (
  graph: ThreadGraph<LinkedInDojoScope, GraphMessage, LinkedInAnchor>,
  participantId: ParticipantIdType<LinkedInIdentity>,
): LinkedInThread => {
  const messages = toMessageViews<LinkedInIdentity>(graph);
  const unreadCount = calculateUnreadCount(messages, participantId);

  return {
    threadId: graph.id,
    messages,
    participants: extractParticipants<LinkedInIdentity>(graph.anchor),
    anchor: graph.anchor,
    unreadCount,
    isSponsored: false,
    lastActivity: graph.lastActivity,
  };
};

export const linkedInDojoBehavior: PlatformBehavior<
  LinkedInDojoScope,
  LinkedInIdentity,
  LinkedInDojoEvent,
  LinkedInAnchor,
  LinkedInThread,
  LinkedInInbox,
  LinkedInAccount,
  LinkedInBrowser,
  LinkedInContact
> = {
  scope: LINKEDIN_DOJO_SCOPE,
  identity: LINKEDIN_IDENTITY,

  deriveInbox: (
    events: readonly LinkedInDojoEvent[],
    participantId: ParticipantIdType<LinkedInIdentity>,
  ): LinkedInInbox => {
    // Events are pre-filtered by scope via the Projection layer
    const threads = buildThreadGraphs<
      LinkedInDojoScope,
      GraphMessage,
      LinkedInAnchor
    >(
      LINKEDIN_DOJO_SCOPE,
      events,
    );

    const byThreadId: Record<string, LinkedInIndexMeta> = {};
    for (const thread of threads.values()) {
      const messages = toMessageViews<LinkedInIdentity>(thread);
      const unreadCount = calculateUnreadCount(messages, participantId);
      byThreadId[thread.id] = {
        lastActivity: thread.lastActivity,
        unreadCount,
        isSponsored: false,
      };
    }

    // Dojo simplified: no invitation tracking
    const pendingInvitations = 0;
    const weeklyInvitesRemaining = 100;

    return {
      byThreadId,
      syncedAt: new Date().toISOString(),
      pendingInvitations,
      weeklyInvitesRemaining,
    };
  },

  deriveThread: (
    events: readonly LinkedInDojoEvent[],
    threadId: ThreadId,
  ): LinkedInThread | undefined => {
    // Events are pre-filtered by scope via the Projection layer
    const threads = buildThreadGraphs<
      LinkedInDojoScope,
      GraphMessage,
      LinkedInAnchor
    >(
      LINKEDIN_DOJO_SCOPE,
      events,
    );
    const thread = threads.get(threadId);

    if (!thread) {
      return undefined;
    }

    // Find participantId from auth event
    const authEvent = events.find((e) => e.type === "AuthObserved");
    const participantId = authEvent
      ? (authEvent as { participantId: ParticipantIdType<LinkedInIdentity> })
        .participantId
      : ParticipantId(LINKEDIN_IDENTITY, "");

    return toLinkedInThread(thread, participantId);
  },

  deriveBrowsers: (
    events: readonly LinkedInDojoEvent[],
    account: LinkedInAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly LinkedInBrowser[] => {
    // Build browser status from events
    const browserStatus = new Map<
      string,
      {
        authStatus: LinkedInAuthStatus;
        rateLimitedUntil?: string;
      }
    >();

    for (const event of events) {
      if (event.type === "AuthObserved") {
        const authEvent = event as {
          configId: string;
          authenticated: boolean;
        };
        const configId = authEvent.configId;
        if (configId) {
          const existing = browserStatus.get(configId);
          browserStatus.set(configId, {
            authStatus: authEvent.authenticated ? "authenticated" : "expired",
            rateLimitedUntil: existing?.rateLimitedUntil,
          });
        }
      } else if (event.type === "RateLimitObserved") {
        const rateLimitEvent = event as {
          configId: string;
          retryAfter?: string;
        };
        const configId = rateLimitEvent.configId;
        if (configId) {
          const existing = browserStatus.get(configId);
          const retryAfter = rateLimitEvent.retryAfter;
          const isActive = retryAfter && retryAfter > new Date().toISOString();
          browserStatus.set(configId, {
            authStatus: existing?.authStatus ?? "unknown",
            rateLimitedUntil: isActive ? retryAfter : undefined,
          });
        }
      }
    }

    // For dojo, all bound browsers are considered "running" (phantom browsers)
    // Use the provided runningConfigIds OR treat all as running if empty
    const effectiveRunningIds = runningConfigIds.size > 0
      ? runningConfigIds
      : new Set(account.browserBindings.map((b) => b.configId));

    return account.browserBindings.map((binding) => {
      const status = browserStatus.get(binding.configId) ?? {
        authStatus: "unknown" as const,
      };

      return {
        configId: binding.configId,
        isRunning: effectiveRunningIds.has(binding.configId),
        metadata: binding.metadata,
        authStatus: status.authStatus,
        rateLimitedUntil: status.rateLimitedUntil,
        weeklyInvitesRemaining: 100, // Simplified for dojo
      };
    });
  },

  deriveContact: (
    events: readonly LinkedInDojoEvent[],
    participantId: ParticipantIdType<LinkedInIdentity>,
  ): LinkedInContact | undefined => {
    let lastInteraction: string | undefined;

    // In dojo, names are managed by the TUI via initialParticipants.
    // deriveContact tracks interaction times from events.
    for (const event of events) {
      // Track anchor participation
      if (event.type === "AnchorMessageObserved") {
        const anchorEvent = event as {
          anchor: { participants: readonly string[] };
          timestamp: string;
        };

        if (anchorEvent.anchor.participants.includes(participantId as string)) {
          if (!lastInteraction || event.timestamp > lastInteraction) {
            lastInteraction = event.timestamp;
          }
        }
      }

      // Track message interactions
      if (
        event.type === "MessageObserved" ||
        event.type === "MessageSent"
      ) {
        const msgEvent = event as { senderId: string; timestamp: string };
        if (msgEvent.senderId === participantId) {
          if (!lastInteraction || event.timestamp > lastInteraction) {
            lastInteraction = event.timestamp;
          }
        }
      }
    }

    return {
      id: participantId,
      lastInteraction,
    };
  },
  // Note: Actions (sendMessage, etc.) are now handled via the service layer
  // using the LinkedInDojoInjector tag for event injection.
};
