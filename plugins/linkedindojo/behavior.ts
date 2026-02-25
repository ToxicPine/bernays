// plugins/linkedindojo/behavior.ts
// LinkedIn Dojo behavior - reuses LinkedIn derivation, pure derivation only

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

interface LinkedInDojoPluginState {
  graph: GraphState;
  browserStatus: Map<string, {
    authStatus: LinkedInAuthStatus;
    rateLimitedUntil?: string;
  }>;
  contacts: Map<string, {
    lastInteraction?: string;
  }>;
  authParticipantId?: ParticipantIdType<LinkedInIdentity>;
}

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
  LinkedInContact,
  LinkedInDojoPluginState
> = {
  scope: LINKEDIN_DOJO_SCOPE,
  identity: LINKEDIN_IDENTITY,

  // ─────────────────────────────────────────────────────────────────────────
  // Incremental state management
  // ─────────────────────────────────────────────────────────────────────────

  emptyState: (): LinkedInDojoPluginState => ({
    graph: emptyGraphState(),
    browserStatus: new Map(),
    contacts: new Map(),
  }),

  applyEvent: (state: LinkedInDojoPluginState, event: LinkedInDojoEvent): void => {
    applyGraphEvent(state.graph, event);

    if (event.type === "AuthObserved") {
      const authEvent = event as {
        configId: string;
        authenticated: boolean;
        participantId: ParticipantIdType<LinkedInIdentity>;
      };
      const configId = authEvent.configId;
      if (configId) {
        const existing = state.browserStatus.get(configId);
        state.browserStatus.set(configId, {
          authStatus: authEvent.authenticated ? "authenticated" : "expired",
          rateLimitedUntil: existing?.rateLimitedUntil,
        });
      }
      state.authParticipantId = authEvent.participantId;
    } else if (event.type === "RateLimitObserved") {
      const rateLimitEvent = event as {
        configId: string;
        retryAfter?: string;
      };
      const configId = rateLimitEvent.configId;
      if (configId) {
        const existing = state.browserStatus.get(configId);
        const retryAfter = rateLimitEvent.retryAfter;
        const isActive = retryAfter && retryAfter > new Date().toISOString();
        state.browserStatus.set(configId, {
          authStatus: existing?.authStatus ?? "unknown",
          rateLimitedUntil: isActive ? retryAfter : undefined,
        });
      }
    } else if (event.type === "AnchorMessageObserved") {
      const anchorEvent = event as {
        anchor: { participants: readonly string[] };
        timestamp: string;
      };
      for (const pid of anchorEvent.anchor.participants) {
        const existing = state.contacts.get(pid);
        if (!existing?.lastInteraction || event.timestamp > existing.lastInteraction) {
          state.contacts.set(pid, { lastInteraction: event.timestamp });
        }
      }
    } else if (event.type === "MessageObserved" || event.type === "MessageSent") {
      const msgEvent = event as { senderId: string; timestamp: string };
      if (msgEvent.senderId) {
        const existing = state.contacts.get(msgEvent.senderId);
        if (!existing?.lastInteraction || event.timestamp > existing.lastInteraction) {
          state.contacts.set(msgEvent.senderId, { lastInteraction: event.timestamp });
        }
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // View materialization — pure projections from accumulated state
  // ─────────────────────────────────────────────────────────────────────────

  materializeInbox: (
    state: LinkedInDojoPluginState,
    participantId: ParticipantIdType<LinkedInIdentity>,
  ): LinkedInInbox => {
    const threads = materializeThreadGraphs<
      LinkedInDojoScope,
      GraphMessage,
      LinkedInAnchor
    >(
      LINKEDIN_DOJO_SCOPE,
      state.graph,
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

  materializeThread: (
    state: LinkedInDojoPluginState,
    threadId: ThreadId,
  ): LinkedInThread | undefined => {
    const threads = materializeThreadGraphs<
      LinkedInDojoScope,
      GraphMessage,
      LinkedInAnchor
    >(
      LINKEDIN_DOJO_SCOPE,
      state.graph,
    );
    const thread = threads.get(threadId);

    if (!thread) {
      return undefined;
    }

    const participantId = state.authParticipantId ?? ParticipantId(LINKEDIN_IDENTITY, "");

    return toLinkedInThread(thread, participantId);
  },

  materializeBrowsers: (
    state: LinkedInDojoPluginState,
    account: LinkedInAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly LinkedInBrowser[] => {
    // For dojo, all bound browsers are considered "running" (phantom browsers)
    // Use the provided runningConfigIds OR treat all as running if empty
    const effectiveRunningIds = runningConfigIds.size > 0
      ? runningConfigIds
      : new Set(account.browserBindings.map((b) => b.configId));

    return account.browserBindings.map((binding) => {
      const status = state.browserStatus.get(binding.configId) ?? {
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

  materializeContact: (
    state: LinkedInDojoPluginState,
    participantId: ParticipantIdType<LinkedInIdentity>,
  ): LinkedInContact | undefined => {
    const contact = state.contacts.get(participantId as string);
    if (!contact) {
      return undefined;
    }

    return {
      id: participantId,
      lastInteraction: contact.lastInteraction,
    };
  },

};
