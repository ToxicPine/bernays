// plugins/linkedindojo/behavior.ts
// LinkedIn Dojo behavior — reuses LinkedIn types, pure derivation only

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
import { makeInjectorTag } from "@bernays/server/projections";

import type { LinkedInAnchor } from "../linkedin/schemas.ts";
import type {
  LinkedInInbox,
  LinkedInIndexMeta,
  LinkedInThread,
} from "../linkedin/views.ts";
import type { LinkedInAccount } from "../linkedin/account.ts";
import type { LinkedInBrowser } from "../linkedin/browser.ts";
import type { LinkedInAuthStatus, LinkedInChallengeType } from "../linkedin/browser.ts";
import type { LinkedInContact } from "../linkedin/contact.ts";

import {
  LINKEDIN_DOJO_SCOPE,
  type LinkedInDojoEvent,
  type LinkedInDojoScope,
} from "./schemas.ts";

const LINKEDIN_IDENTITY = "linkedin" as const;
type LinkedInIdentity = typeof LINKEDIN_IDENTITY;

// =============================================================================
// Plugin State
// =============================================================================

export interface LinkedInDojoPluginState {
  graph: GraphState;
  browserStatus: Map<string, {
    authStatus: LinkedInAuthStatus;
    challengeType?: LinkedInChallengeType;
    restrictions: Map<string, string>;
  }>;
  contacts: Map<string, {
    lastInteraction?: string;
    hasReplied?: boolean;
    lastReplyAt?: string;
  }>;
  authParticipantId?: ParticipantIdType<LinkedInIdentity>;
}

// =============================================================================
// Injector Tag
// =============================================================================

export const LinkedInDojoInjector = makeInjectorTag<LinkedInDojoEvent>(
  "LinkedInDojoInjector",
);

// =============================================================================
// Helpers
// =============================================================================

const toLinkedInThread = (
  graph: ThreadGraph<LinkedInDojoScope, GraphMessage, LinkedInAnchor>,
  participantId: ParticipantIdType<LinkedInIdentity>,
): LinkedInThread => {
  const messages = graphNodesToMessages(graph.nodes).map((m) => ({
    id: m.canonicalId,
    senderId: ParticipantIdFromString<LinkedInIdentity>(m.senderId),
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

// =============================================================================
// Behavior
// =============================================================================

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

  emptyState: (): LinkedInDojoPluginState => ({
    graph: emptyGraphState(),
    browserStatus: new Map(),
    contacts: new Map(),
  }),

  applyEvent: (state: LinkedInDojoPluginState, event: LinkedInDojoEvent): void => {
    applyGraphEvent(state.graph, event);

    switch (event.type) {
      case "AuthObserved": {
        const configId = event.configId;
        let bs = state.browserStatus.get(configId);
        if (!bs) {
          bs = { authStatus: "unknown", restrictions: new Map() };
          state.browserStatus.set(configId, bs);
        }
        bs.authStatus = event.status;
        if (event.status === "challenged" && event.challengeType) {
          bs.challengeType = event.challengeType as LinkedInChallengeType;
        } else {
          bs.challengeType = undefined;
        }
        state.authParticipantId = event.participantId;
        break;
      }

      case "AnchorMessageObserved": {
        for (const pid of event.anchor.participants) {
          const existing = state.contacts.get(pid);
          if (!existing?.lastInteraction || event.timestamp > existing.lastInteraction) {
            state.contacts.set(pid, {
              ...existing,
              lastInteraction: event.timestamp,
            });
          }
        }
        break;
      }

      case "MessageObserved": {
        const senderId = (event as unknown as { senderId: string }).senderId;
        if (senderId) {
          const existing = state.contacts.get(senderId);
          state.contacts.set(senderId, {
            ...existing,
            lastInteraction: event.timestamp,
            hasReplied: true,
            lastReplyAt: event.timestamp,
          });
        }
        break;
      }

      case "MessageSent": {
        if (event.senderId) {
          const existing = state.contacts.get(event.senderId);
          if (!existing?.lastInteraction || event.timestamp > existing.lastInteraction) {
            state.contacts.set(event.senderId, {
              ...existing,
              lastInteraction: event.timestamp,
            });
          }
        }
        break;
      }

      case "RestrictionObserved": {
        let bs = state.browserStatus.get(event.configId);
        if (!bs) {
          bs = { authStatus: "unknown", restrictions: new Map() };
          state.browserStatus.set(event.configId, bs);
        }
        bs.restrictions.set(
          event.restrictionType,
          event.retryAfter ?? new Date().toISOString(),
        );
        break;
      }

      case "RestrictionCleared": {
        const bs = state.browserStatus.get(event.configId);
        if (bs) {
          bs.restrictions.delete(event.restrictionType);
        }
        break;
      }
    }
  },

  materializeInbox: (
    state: LinkedInDojoPluginState,
    participantId: ParticipantIdType<LinkedInIdentity>,
  ): LinkedInInbox => {
    const threads = materializeThreadGraphs<
      LinkedInDojoScope,
      GraphMessage,
      LinkedInAnchor
    >(LINKEDIN_DOJO_SCOPE, state.graph);

    const byThreadId: Record<string, LinkedInIndexMeta> = {};
    for (const thread of threads.values()) {
      const messages = graphNodesToMessages(thread.nodes).map((m) => ({
        id: m.canonicalId,
        senderId: ParticipantIdFromString<LinkedInIdentity>(m.senderId),
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

    return {
      byThreadId,
      syncedAt: new Date().toISOString(),
      pendingInvitations: 0,
      weeklyInvitesRemaining: 100,
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
    >(LINKEDIN_DOJO_SCOPE, state.graph);
    const thread = threads.get(threadId);
    if (!thread) return undefined;

    const participantId = state.authParticipantId ??
      ParticipantId(LINKEDIN_IDENTITY, "");
    return toLinkedInThread(thread, participantId);
  },

  materializeBrowsers: (
    state: LinkedInDojoPluginState,
    account: LinkedInAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly LinkedInBrowser[] => {
    const effectiveRunningIds = runningConfigIds.size > 0
      ? runningConfigIds
      : new Set(account.browserBindings.map((b) => b.configId));

    return account.browserBindings.map((binding): LinkedInBrowser => {
      const bs = state.browserStatus.get(binding.configId);
      const authStatus = bs?.authStatus ?? "unknown";

      const restrictions: Record<string, string> = {};
      if (bs) {
        const nowIso = new Date().toISOString();
        for (const [type, retryAfter] of bs.restrictions) {
          if (retryAfter > nowIso) {
            restrictions[type] = retryAfter;
          }
        }
      }

      const base = {
        configId: binding.configId,
        isRunning: effectiveRunningIds.has(binding.configId),
        metadata: binding.metadata,
        restrictions,
        weeklyInvitesRemaining: 100 as number | undefined,
      };

      switch (authStatus) {
        case "authenticated":
          return {
            ...base,
            authStatus: "authenticated" as const,
            profileViewingMode: "full" as const,
          };
        case "challenged":
          return {
            ...base,
            authStatus: "challenged" as const,
            challengeType: bs?.challengeType ?? "unknown",
          };
        case "expired":
          return { ...base, authStatus: "expired" as const };
        case "unknown":
        default:
          return { ...base, authStatus: "unknown" as const };
      }
    });
  },

  materializeContact: (
    state: LinkedInDojoPluginState,
    participantId: ParticipantIdType<LinkedInIdentity>,
  ): LinkedInContact | undefined => {
    const contact = state.contacts.get(participantId as string);
    if (!contact) return undefined;

    return {
      id: participantId,
      lastInteraction: contact.lastInteraction,
      hasReplied: contact.hasReplied,
      lastReplyAt: contact.lastReplyAt,
    };
  },
};
