// plugins/linkedin/schemas.ts
// LinkedIn platform event schemas — the complete event catalog per LINKEDIN_TESTING.md

import { z } from "@zod/zod";
import {
  BrowserConfigId,
  CanonicalId,
  participantIdSchema,
  Scope,
  ThreadId,
} from "@bernays/server/core";
import { CorrelationMetadataSchema } from "@bernays/server/events";
import {
  AnchorMessageObservedBase,
  MessageObservedBase,
} from "@bernays/server/events";

// =============================================================================
// Scope
// =============================================================================

export const LINKEDIN_SCOPE = Scope("linkedin");
export type LinkedInScope = typeof LINKEDIN_SCOPE;

const linkedInScopeSchema = z.literal("linkedin").transform(() =>
  LINKEDIN_SCOPE
);

// =============================================================================
// Anchor
// =============================================================================

export const LinkedInAnchorSchema = z.object({
  conversationId: z.string(),
  participants: z.array(participantIdSchema("linkedin")),
});

export type LinkedInAnchor = z.infer<typeof LinkedInAnchorSchema>;

// =============================================================================
// Auth Events
// =============================================================================

/**
 * Periodic auth health check. Sync fiber reads `li_at` cookie and page state.
 * `challenged` means LinkedIn is showing a checkpoint page — all API calls blocked.
 */
export const LinkedInAuthObservedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("AuthObserved"),
  configId: z.string().transform(BrowserConfigId),
  participantId: participantIdSchema("linkedin"),
  status: z.enum(["authenticated", "expired", "challenged", "unknown"]),
  challengeType: z.string().optional(),
  previousLiAt: z.string().optional(),
});

export type LinkedInAuthObserved = z.infer<typeof LinkedInAuthObservedSchema>;

/**
 * Detected when LinkedIn redirects to /checkpoint/challenge/.
 * Challenge types from Waalaxy's DOM marker detection.
 */
export const LinkedInTwoFactorChallengeObservedSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("TwoFactorChallengeObserved"),
    configId: z.string().transform(BrowserConfigId),
    challengeType: z.enum([
      "email",
      "phone",
      "mobile_app",
      "authenticator",
      "captcha",
      "unknown",
    ]),
    deliveryHint: z.string().optional(),
    challengeId: z.string().optional(),
  });

export type LinkedInTwoFactorChallengeObserved = z.infer<
  typeof LinkedInTwoFactorChallengeObservedSchema
>;

/**
 * Result of challenge submission.
 */
export const LinkedInTwoFactorResultObservedSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("TwoFactorResultObserved"),
    configId: z.string().transform(BrowserConfigId),
    success: z.boolean(),
    errorCode: z
      .enum([
        "wrong_credentials",
        "challenge_failed",
        "rate_limited",
        "account_restricted",
        "captcha_rejected",
        "unknown",
      ])
      .optional(),
  });

export type LinkedInTwoFactorResultObserved = z.infer<
  typeof LinkedInTwoFactorResultObservedSchema
>;

// =============================================================================
// Message Events
// =============================================================================

/**
 * First message observed in a conversation. Establishes the thread anchor.
 */
export const LinkedInAnchorMessageObservedSchema =
  AnchorMessageObservedBase.extend({
    scope: linkedInScopeSchema,
    type: z.literal("AnchorMessageObserved"),
    anchor: LinkedInAnchorSchema,
    threadId: z.string().transform(ThreadId),
  });

export type LinkedInAnchorMessageObserved = z.infer<
  typeof LinkedInAnchorMessageObservedSchema
>;

/**
 * Subsequent message in an existing thread.
 */
export const LinkedInMessageObservedSchema = MessageObservedBase.extend({
  scope: linkedInScopeSchema,
  type: z.literal("MessageObserved"),
  threadId: z.string().transform(ThreadId),
});

export type LinkedInMessageObserved = z.infer<
  typeof LinkedInMessageObservedSchema
>;

/**
 * Consequence of the sockpuppet sending a message.
 */
export const LinkedInMessageSentSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("MessageSent"),
  threadId: z.string().transform(ThreadId),
  canonicalId: z.string().transform(CanonicalId),
  content: z.string(),
});

export type LinkedInMessageSent = z.infer<typeof LinkedInMessageSentSchema>;

/**
 * Detected when a message changes or disappears.
 * Includes `kind: "mutation"` for graph engine processing.
 */
export const LinkedInMessageMutatedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("MessageMutated"),
  kind: z.literal("mutation").default("mutation"),
  canonicalId: z.string().transform(CanonicalId),
  threadId: z.string().transform(ThreadId),
  mutation: z.enum(["deleted", "edited"]),
  editedContent: z.string().optional(),
});

export type LinkedInMessageMutated = z.infer<
  typeof LinkedInMessageMutatedSchema
>;

// =============================================================================
// Connection Events
// =============================================================================

/**
 * Consequence of sending an invitation.
 */
export const LinkedInConnectionRequestSentSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("ConnectionRequestSent"),
    targetUserId: z.string(),
    note: z.string().optional(),
  });

export type LinkedInConnectionRequestSent = z.infer<
  typeof LinkedInConnectionRequestSentSchema
>;

/**
 * Consequence of withdrawing an invitation.
 */
export const LinkedInInvitationWithdrawnSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("InvitationWithdrawn"),
    invitationId: z.string(),
    targetUserId: z.string(),
  });

export type LinkedInInvitationWithdrawn = z.infer<
  typeof LinkedInInvitationWithdrawnSchema
>;

/**
 * Detected when a pending invitation is accepted.
 */
export const LinkedInConnectionAcceptedSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("ConnectionAccepted"),
    invitationId: z.string(),
    userId: z.string(),
  });

export type LinkedInConnectionAccepted = z.infer<
  typeof LinkedInConnectionAcceptedSchema
>;

/**
 * Detected when a pending invitation is rejected / expires.
 */
export const LinkedInConnectionRejectedSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("ConnectionRejected"),
    invitationId: z.string(),
    userId: z.string(),
  });

export type LinkedInConnectionRejected = z.infer<
  typeof LinkedInConnectionRejectedSchema
>;

/**
 * Invitation can't be resolved after repeated checks.
 */
export const LinkedInConnectionStatusUnknownSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("ConnectionStatusUnknown"),
    invitationId: z.string(),
    userId: z.string(),
    sentAt: z.string(),
  });

export type LinkedInConnectionStatusUnknown = z.infer<
  typeof LinkedInConnectionStatusUnknownSchema
>;

// =============================================================================
// Profile Events
// =============================================================================

/**
 * Consequence of viewing a profile.
 */
export const LinkedInProfileViewedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("ProfileViewed"),
  targetUserId: z.string(),
  profileUrl: z.string().optional(),
  viewedAt: z.string(),
  viewerPrivacySetting: z.enum(["full", "anonymous", "hidden"]),
});

export type LinkedInProfileViewed = z.infer<typeof LinkedInProfileViewedSchema>;

/**
 * Consequence of following a profile without connecting.
 */
export const LinkedInUserFollowedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("UserFollowed"),
  targetUserId: z.string(),
});

export type LinkedInUserFollowed = z.infer<typeof LinkedInUserFollowedSchema>;

// =============================================================================
// Message Request Events
// =============================================================================

/**
 * Consequence of sending a message to a non-connection using shared context.
 */
export const LinkedInMessageRequestSentSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("MessageRequestSent"),
    targetUserId: z.string(),
    content: z.string(),
    contextUrn: z.string(),
  });

export type LinkedInMessageRequestSent = z.infer<
  typeof LinkedInMessageRequestSentSchema
>;

// =============================================================================
// Restriction Events
// =============================================================================

/** Restriction type enum — from Waalaxy's error handling */
export const LinkedInRestrictionTypeSchema = z.enum([
  "desktop_connect_restricted",
  "weekly_invites_exhausted",
  "connect_note_restricted",
  "message_request_restricted",
  "daily_messages_exhausted",
  "searches_exhausted",
  "account_blocked",
]);

export type LinkedInRestrictionType = z.infer<
  typeof LinkedInRestrictionTypeSchema
>;

/**
 * Detected from HTTP 429, known error codes, or restriction patterns.
 */
export const LinkedInRestrictionObservedSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("RestrictionObserved"),
    configId: z.string().transform(BrowserConfigId),
    restrictionType: LinkedInRestrictionTypeSchema,
    retryAfter: z.string().optional(),
  });

export type LinkedInRestrictionObserved = z.infer<
  typeof LinkedInRestrictionObservedSchema
>;

/**
 * Detected when a previously-observed restriction is no longer active.
 */
export const LinkedInRestrictionClearedSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("RestrictionCleared"),
    configId: z.string().transform(BrowserConfigId),
    restrictionType: LinkedInRestrictionTypeSchema,
  });

export type LinkedInRestrictionCleared = z.infer<
  typeof LinkedInRestrictionClearedSchema
>;

// =============================================================================
// Conversation Sync Events
// =============================================================================

/**
 * Emitted after a full inbox scrape completes.
 */
export const LinkedInConversationsSyncedSchema =
  CorrelationMetadataSchema.extend({
    scope: linkedInScopeSchema,
    type: z.literal("ConversationsSynced"),
    participantId: participantIdSchema("linkedin"),
    threadCount: z.number(),
    syncedAt: z.string(),
  });

export type LinkedInConversationsSynced = z.infer<
  typeof LinkedInConversationsSyncedSchema
>;

// =============================================================================
// Event Union
// =============================================================================

export const LinkedInEventSchema = z.discriminatedUnion("type", [
  // Auth
  LinkedInAuthObservedSchema,
  LinkedInTwoFactorChallengeObservedSchema,
  LinkedInTwoFactorResultObservedSchema,
  // Messages
  LinkedInAnchorMessageObservedSchema,
  LinkedInMessageObservedSchema,
  LinkedInMessageSentSchema,
  LinkedInMessageMutatedSchema,
  // Connections
  LinkedInConnectionRequestSentSchema,
  LinkedInInvitationWithdrawnSchema,
  LinkedInConnectionAcceptedSchema,
  LinkedInConnectionRejectedSchema,
  LinkedInConnectionStatusUnknownSchema,
  // Profile
  LinkedInProfileViewedSchema,
  LinkedInUserFollowedSchema,
  // Message requests
  LinkedInMessageRequestSentSchema,
  // Restrictions
  LinkedInRestrictionObservedSchema,
  LinkedInRestrictionClearedSchema,
  // Sync
  LinkedInConversationsSyncedSchema,
]);

export type LinkedInEvent = z.infer<typeof LinkedInEventSchema>;
