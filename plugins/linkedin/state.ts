// plugins/linkedin/state.ts
// LinkedIn plugin state — the mutable accumulator that events fold into.
// All views are derived from this state via pure materialization functions.

import type { GraphState } from "@bernays/server/views";
import { emptyGraphState } from "@bernays/server/views";
import type {
  LinkedInAuthStatus,
  LinkedInChallengeType,
  LinkedInProfileViewingMode,
} from "./browser.ts";

// =============================================================================
// Plugin State
// =============================================================================

/**
 * Per-target invitation tracking entry.
 */
export interface InvitationState {
  invitationId?: string;
  sentAt: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn" | "unknown";
}

/**
 * Per-browser status tracking entry.
 */
export interface BrowserStatusState {
  authStatus: LinkedInAuthStatus;
  challengeType?: LinkedInChallengeType;
  profileViewingMode?: LinkedInProfileViewingMode;
  lastLiAt?: string;
  restrictions: Map<string, string>; // restrictionType → retryAfter ISO
}

/**
 * Per-contact tracking entry.
 */
export interface ContactState {
  publicIdentifier?: string;
  memberId?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  occupation?: string;
  company?: { name: string; logoUrl?: string };
  profilePictureUrl?: string;
  profileUrl?: string;
  isOpenProfile?: boolean;
  isPremium?: boolean;
  isJobSeeker?: boolean;
  connectionDegree?: "self" | "1st" | "2nd" | "3rd" | "out";
  sharedGroups?: string[];
  sharedEvents?: string[];
  lastInteraction?: string;
  hasReplied?: boolean;
  lastReplyAt?: string;
}

/**
 * The full plugin-wide state. Opaque to the framework — only the behavior
 * knows how to fold events into it and materialize views from it.
 */
export interface LinkedInPluginState {
  /** Thread graph — shared infra, handles anchor/reply/mutation */
  graph: GraphState;

  /** Connection tracking: targetId → invitation state */
  pendingInvitations: Map<string, InvitationState>;

  /** Timestamps of ConnectionRequestSent events for rolling 7-day window */
  weeklyInviteTimestamps: string[];

  /** Per-browser status (keyed by configId) */
  browserStatus: Map<string, BrowserStatusState>;

  /** Contact directory — built from observations */
  contacts: Map<string, ContactState>;

  /** Conversation ID → graph ThreadId mapping (for lookups by LinkedIn conversation ID) */
  conversationThreadMap: Map<string, string>;

  /** Last successful sync timestamp */
  lastSyncedAt?: string;
}

// =============================================================================
// Empty State Constructor
// =============================================================================

export const emptyLinkedInState = (): LinkedInPluginState => ({
  graph: emptyGraphState(),
  pendingInvitations: new Map(),
  weeklyInviteTimestamps: [],
  browserStatus: new Map(),
  contacts: new Map(),
  conversationThreadMap: new Map(),
});
