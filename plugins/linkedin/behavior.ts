// plugins/linkedin/behavior.ts
// LinkedIn platform behavior — applyEvent reducer + pure materialization

import {
  type BrowserConfigId,
  ParticipantId,
  type ParticipantId as ParticipantIdType,
  ParticipantIdFromString,
  ThreadId,
} from "@bernays/server/core";
import {
  applyGraphEvent,
  calculateUnreadCount,
  emptyGraphState as _emptyGraphState,
  type GraphMessage,
  GraphReplySchema,
  graphNodesToMessages,
  type GraphState as _GraphState,
  materializeThreadGraphs,
  type ThreadGraph,
} from "@bernays/server/views";
import type { PlatformBehavior } from "@bernays/server/platforms";

import type {
  LinkedInAnchor,
  LinkedInEvent,
  LinkedInScope,
} from "./schemas.ts";
import { LINKEDIN_SCOPE } from "./schemas.ts";
import type {
  LinkedInInbox,
  LinkedInIndexMeta,
  LinkedInThread,
} from "./views.ts";
import type { LinkedInAccount } from "./account.ts";
import type { LinkedInBrowser } from "./browser.ts";
import type { LinkedInContact } from "./contact.ts";
import {
  type BrowserStatusState,
  type ContactState,
  emptyLinkedInState,
  type LinkedInPluginState,
} from "./state.ts";

export type { LinkedInPluginState } from "./state.ts";

// =============================================================================
// Helpers
// =============================================================================

const getOrCreateBrowser = (
  state: LinkedInPluginState,
  configId: string,
): BrowserStatusState => {
  let bs = state.browserStatus.get(configId);
  if (!bs) {
    bs = { authStatus: "unknown", restrictions: new Map() };
    state.browserStatus.set(configId, bs);
  }
  return bs;
};

const getOrCreateContact = (
  state: LinkedInPluginState,
  id: string,
): ContactState => {
  let c = state.contacts.get(id);
  if (!c) {
    // Extract memberId from participant ID string "linkedin:ABC123"
    const memberId = id.includes(":") ? id.split(":").slice(1).join(":") : id;
    c = { memberId };
    state.contacts.set(id, c);
  }
  return c;
};

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

/** Count invites in the last 7 days from a list of timestamps */
const countWeeklyInvites = (
  timestamps: readonly string[],
  now: Date,
): number => {
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const cutoff = oneWeekAgo.toISOString();
  let count = 0;
  for (const ts of timestamps) {
    if (ts > cutoff) count++;
  }
  return count;
};

// =============================================================================
// Apply Event — single event reducer (mutates state in place)
// =============================================================================

const applyEvent = (state: LinkedInPluginState, event: LinkedInEvent): void => {
  // Always delegate to graph (handles anchor/reply/mutation events)
  applyGraphEvent(state.graph, event);

  switch (event.type) {
    // ── Auth events ───────────────────────────────────────────────
    case "AuthObserved": {
      const bs = getOrCreateBrowser(state, event.configId);
      bs.authStatus = event.status;
      if (event.status === "challenged" && event.challengeType) {
        bs.challengeType = event.challengeType;
      } else {
        bs.challengeType = undefined;
      }
      if (event.previousLiAt) {
        bs.lastLiAt = event.previousLiAt;
      }
      if (event.profileViewingMode) {
        bs.profileViewingMode = event.profileViewingMode;
      }
      break;
    }

    case "TwoFactorChallengeObserved":
    case "TwoFactorResultObserved":
      // Informational — auth state captured by AuthObserved
      break;

    // ── Message events ────────────────────────────────────────────
    case "AnchorMessageObserved": {
      // Map conversationId → canonicalId (which becomes the graph thread ID)
      if (event.anchor.conversationId) {
        state.conversationThreadMap.set(
          event.anchor.conversationId,
          event.canonicalId,
        );
      }
      // Track contacts from participants
      for (const pid of event.anchor.participants) {
        const c = getOrCreateContact(state, pid);
        if (!c.lastInteraction || event.timestamp > c.lastInteraction) {
          c.lastInteraction = event.timestamp;
        }
        // Participants in a DM are likely 1st degree
        if (!c.connectionDegree) {
          c.connectionDegree = "1st";
        }
      }
      break;
    }

    case "MessageObserved": {
      // Track reply directionality
      if (event.senderId) {
        const c = getOrCreateContact(state, event.senderId);
        if (!c.lastInteraction || event.timestamp > c.lastInteraction) {
          c.lastInteraction = event.timestamp;
        }
        // If the sender is NOT us, mark as replied
        // (We can't know who "us" is here — that's handled in materializeContact
        //  by checking hasReplied based on the account's participantId)
        c.hasReplied = true;
        c.lastReplyAt = event.timestamp;
      }
      break;
    }

    case "MessageSent": {
      // Manually add to graph as a reply node (MessageSent lacks `kind` so
      // applyGraphEvent ignores it). Find the last node in this thread and
      // chain to it.
      const sentCanonicalId = event.canonicalId;
      const sentThreadId = String(event.threadId);

      // Resolve the graph thread ID from conversation ID
      const graphThreadId = state.conversationThreadMap.get(sentThreadId);
      if (graphThreadId && !state.graph.nodes.has(sentCanonicalId)) {
        // Find the last node in this thread for predecessorId
        let lastNodeId = graphThreadId;
        const visited = new Set<string>();
        const findLast = (nodeId: string): string => {
          if (visited.has(nodeId)) return nodeId;
          visited.add(nodeId);
          const children = state.graph.children.get(nodeId) ?? [];
          if (children.length === 0) return nodeId;
          return findLast(children[children.length - 1]);
        };
        lastNodeId = findLast(graphThreadId);

        // Build a proper GraphReply via schema parse
        const syntheticReply = GraphReplySchema.parse({
          kind: "reply",
          scope: LINKEDIN_SCOPE,
          type: "MessageObserved",
          eventId: event.eventId,
          timestamp: event.timestamp,
          canonicalId: sentCanonicalId,
          senderId: "",
          predecessorId: lastNodeId,
          content: event.content,
        });

        state.graph.nodes.set(sentCanonicalId, {
          message: syntheticReply,
          deleted: false,
        });
        const children = state.graph.children.get(lastNodeId) ?? [];
        children.push(sentCanonicalId);
        state.graph.children.set(lastNodeId, children);
      }
      break;
    }

    case "MessageMutated":
      // Graph already handled via applyGraphEvent
      break;

    // ── Connection events ─────────────────────────────────────────
    case "ConnectionRequestSent": {
      state.weeklyInviteTimestamps.push(event.timestamp);
      state.pendingInvitations.set(event.targetUserId, {
        invitationId: event.invitationId,
        sentAt: event.timestamp,
        status: "pending",
      });
      const c = getOrCreateContact(state, event.targetUserId);
      if (!c.connectionDegree || c.connectionDegree !== "1st") {
        c.connectionDegree = "out";
      }
      break;
    }

    case "ConnectionAccepted": {
      const inv = state.pendingInvitations.get(event.userId);
      if (inv) {
        inv.status = "accepted";
        inv.invitationId = event.invitationId;
      }
      const c = getOrCreateContact(state, event.userId);
      c.connectionDegree = "1st";
      break;
    }

    case "ConnectionRejected": {
      const inv = state.pendingInvitations.get(event.userId);
      if (inv) {
        inv.status = "rejected";
        inv.invitationId = event.invitationId;
      }
      break;
    }

    case "ConnectionStatusUnknown": {
      const inv = state.pendingInvitations.get(event.userId);
      if (inv) {
        inv.status = "unknown";
        inv.invitationId = event.invitationId;
      }
      break;
    }

    case "InvitationWithdrawn": {
      const inv = state.pendingInvitations.get(event.targetUserId);
      if (inv) {
        inv.status = "withdrawn";
        inv.invitationId = event.invitationId;
      }
      break;
    }

    // ── Profile events ────────────────────────────────────────────
    case "ProfileViewed": {
      const c = getOrCreateContact(state, event.targetUserId);
      if (event.profileUrl) c.profileUrl = event.profileUrl;
      if (!c.lastInteraction || event.viewedAt > c.lastInteraction) {
        c.lastInteraction = event.viewedAt;
      }
      break;
    }

    case "UserFollowed":
      // Informational — no state change beyond what events already capture
      break;

    // ── Message request events ────────────────────────────────────
    case "MessageRequestSent": {
      const c = getOrCreateContact(state, event.targetUserId);
      if (!c.lastInteraction || event.timestamp > c.lastInteraction) {
        c.lastInteraction = event.timestamp;
      }
      break;
    }

    // ── Restriction events ────────────────────────────────────────
    case "RestrictionObserved": {
      const bs = getOrCreateBrowser(state, event.configId);
      bs.restrictions.set(
        event.restrictionType,
        event.retryAfter ?? new Date().toISOString(),
      );
      break;
    }

    case "RestrictionCleared": {
      const bs = getOrCreateBrowser(state, event.configId);
      bs.restrictions.delete(event.restrictionType);
      break;
    }

    // ── Sync events ───────────────────────────────────────────────
    case "ConversationsSynced":
      state.lastSyncedAt = event.syncedAt;
      break;
  }
};

// =============================================================================
// View Materialization — pure projections from accumulated state
// =============================================================================

const materializeInbox = (
  state: LinkedInPluginState,
  participantId: ParticipantIdType<"linkedin">,
): LinkedInInbox => {
  const threads = materializeThreadGraphs<
    LinkedInScope,
    GraphMessage,
    LinkedInAnchor
  >(
    LINKEDIN_SCOPE,
    state.graph,
  );

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

  // Count pending invitations (status === "pending")
  let pendingCount = 0;
  for (const inv of state.pendingInvitations.values()) {
    if (inv.status === "pending") pendingCount++;
  }

  const now = new Date();
  const weeklyInvitesSent = countWeeklyInvites(
    state.weeklyInviteTimestamps,
    now,
  );
  const weeklyInvitesRemaining = Math.max(0, 100 - weeklyInvitesSent);

  return {
    byThreadId,
    pendingInvitations: pendingCount,
    weeklyInvitesRemaining,
    syncedAt: state.lastSyncedAt ?? new Date().toISOString(),
  };
};

const materializeThread = (
  state: LinkedInPluginState,
  threadId: ThreadId,
): LinkedInThread | undefined => {
  const threads = materializeThreadGraphs<
    LinkedInScope,
    GraphMessage,
    LinkedInAnchor
  >(
    LINKEDIN_SCOPE,
    state.graph,
  );

  // Direct lookup by graph thread ID (canonical hash)
  let thread = threads.get(threadId);

  // Fallback: try looking up by conversation ID via the mapping
  if (!thread) {
    const mappedCanonicalId = state.conversationThreadMap.get(String(threadId));
    if (mappedCanonicalId) {
      thread = threads.get(ThreadId(mappedCanonicalId));
    }
  }

  if (!thread) return undefined;

  // Use empty participant as fallback; the platform service passes the real one
  const participantId = ParticipantId("linkedin", "");
  return toLinkedInThread(thread, participantId);
};

const materializeBrowsers = (
  state: LinkedInPluginState,
  account: LinkedInAccount,
  runningConfigIds: ReadonlySet<BrowserConfigId>,
): readonly LinkedInBrowser[] => {
  const now = new Date();
  const weeklyInvitesSent = countWeeklyInvites(
    state.weeklyInviteTimestamps,
    now,
  );
  const weeklyInvitesRemaining = Math.max(0, 100 - weeklyInvitesSent);

  return account.browserBindings.map((binding): LinkedInBrowser => {
    const bs = state.browserStatus.get(binding.configId);
    const authStatus = bs?.authStatus ?? "unknown";

    // Filter active restrictions (retryAfter in the future)
    const restrictions: Record<string, string> = {};
    if (bs) {
      const nowIso = now.toISOString();
      for (const [type, retryAfter] of bs.restrictions) {
        if (retryAfter > nowIso) {
          restrictions[type] = retryAfter;
        }
      }
    }

    const base = {
      configId: binding.configId,
      isRunning: runningConfigIds.has(binding.configId),
      metadata: binding.metadata,
      restrictions,
      weeklyInvitesRemaining,
    };

    switch (authStatus) {
      case "authenticated":
        return {
          ...base,
          authStatus: "authenticated" as const,
          profileViewingMode: bs?.profileViewingMode ?? "full",
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
};

const materializeContact = (
  state: LinkedInPluginState,
  participantId: ParticipantIdType<"linkedin">,
): LinkedInContact | undefined => {
  const c = state.contacts.get(String(participantId));
  if (!c) return undefined;

  // Only return if we have some useful info
  const hasInfo = c.firstName || c.lastName || c.headline || c.profileUrl ||
    c.lastInteraction || c.connectionDegree || c.memberId || c.publicIdentifier;
  if (!hasInfo) return undefined;

  return {
    id: participantId,
    name: c.firstName && c.lastName
      ? `${c.firstName} ${c.lastName}`
      : c.firstName ?? c.lastName,
    publicIdentifier: c.publicIdentifier,
    memberId: c.memberId,
    firstName: c.firstName,
    lastName: c.lastName,
    headline: c.headline,
    occupation: c.occupation,
    company: c.company,
    profilePictureUrl: c.profilePictureUrl,
    profileUrl: c.profileUrl,
    isOpenProfile: c.isOpenProfile,
    isPremium: c.isPremium,
    isJobSeeker: c.isJobSeeker,
    connectionDegree: c.connectionDegree,
    sharedGroups: c.sharedGroups,
    sharedEvents: c.sharedEvents,
    lastInteraction: c.lastInteraction,
    hasReplied: c.hasReplied,
    lastReplyAt: c.lastReplyAt,
  };
};

// =============================================================================
// Behavior Export
// =============================================================================

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
  emptyState: emptyLinkedInState,
  applyEvent,
  materializeInbox,
  materializeThread,
  materializeBrowsers,
  materializeContact,
};
