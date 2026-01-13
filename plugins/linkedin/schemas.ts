// src/platforms/linkedin/schemas.ts
// LinkedIn platform schemas - events and intents

import { z } from "@zod/zod";
import {
  type AccountId,
  type CanonicalId,
  type IntentId,
  Scope,
  type ThreadId,
} from "@bernays/server/core";
import { CorrelationMetadataSchema } from "@bernays/server/events";
import {
  AnchorMessageObservedBase,
  MessageObservedBase,
} from "@bernays/server/events";
import {
  SendMessageBase,
  SyncConversationsBase,
} from "@bernays/server/intents";

// Scope

export const LINKEDIN_SCOPE = Scope("linkedin");
export type LinkedInScope = typeof LINKEDIN_SCOPE;

const linkedInScopeSchema = z.literal("linkedin").transform(() =>
  LINKEDIN_SCOPE
);

// LinkedIn Anchor

export const LinkedInAnchorSchema = z.object({
  conversationId: z.string(),
  participants: z.array(z.string()),
});

export type LinkedInAnchor = z.infer<typeof LinkedInAnchorSchema>;

// Event Schemas

export const LinkedInAuthObservedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("AuthObserved"),
  accountId: z.string().transform((val) => val as AccountId),
  browserId: z.string(),
  tabId: z.string(),
  authenticated: z.boolean(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
});

export type LinkedInAuthObserved = z.infer<typeof LinkedInAuthObservedSchema>;

export const LinkedInAnchorMessageObservedSchema = AnchorMessageObservedBase
  .extend({
    scope: linkedInScopeSchema,
    type: z.literal("AnchorMessageObserved"),
    anchor: LinkedInAnchorSchema,
    threadId: z.string().transform((val) => val as ThreadId),
  });

export type LinkedInAnchorMessageObserved = z.infer<
  typeof LinkedInAnchorMessageObservedSchema
>;

export const LinkedInMessageObservedSchema = MessageObservedBase.extend({
  scope: linkedInScopeSchema,
  type: z.literal("MessageObserved"),
  threadId: z.string().transform((val) => val as ThreadId),
});

export type LinkedInMessageObserved = z.infer<
  typeof LinkedInMessageObservedSchema
>;

export const LinkedInMessageMutatedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("MessageMutated"),
  canonicalId: z.string().transform((val) => val as CanonicalId),
  threadId: z.string().transform((val) => val as ThreadId),
  mutation: z.enum(["deleted", "edited"]),
  editedContent: z.string().optional(),
});

export type LinkedInMessageMutated = z.infer<
  typeof LinkedInMessageMutatedSchema
>;

export const LinkedInMessageSentSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("MessageSent"),
  threadId: z.string().transform((val) => val as ThreadId),
  canonicalId: z.string().transform((val) => val as CanonicalId),
  content: z.string(),
});

export type LinkedInMessageSent = z.infer<typeof LinkedInMessageSentSchema>;

export const LinkedInConversationsSyncedSchema = CorrelationMetadataSchema
  .extend({
    scope: linkedInScopeSchema,
    type: z.literal("ConversationsSynced"),
    accountId: z.string().transform((val) => val as AccountId),
    threadCount: z.number(),
    syncedAt: z.iso.datetime(),
  });

export type LinkedInConversationsSynced = z.infer<
  typeof LinkedInConversationsSyncedSchema
>;

export const LinkedInConnectionRequestSentSchema = CorrelationMetadataSchema
  .extend({
    scope: linkedInScopeSchema,
    type: z.literal("ConnectionRequestSent"),
    targetUserId: z.string(),
    note: z.string().optional(),
  });

export type LinkedInConnectionRequestSent = z.infer<
  typeof LinkedInConnectionRequestSentSchema
>;

export const LinkedInUserFollowedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("UserFollowed"),
  targetUserId: z.string(),
});

export type LinkedInUserFollowed = z.infer<typeof LinkedInUserFollowedSchema>;

export const LinkedInSearchResultsRetrievedSchema = CorrelationMetadataSchema
  .extend({
    scope: linkedInScopeSchema,
    type: z.literal("SearchResultsRetrieved"),
    query: z.string(),
    resultCount: z.number(),
    results: z.array(z.object({
      userId: z.string(),
      name: z.string().optional(),
      headline: z.string().optional(),
    })),
  });

export type LinkedInSearchResultsRetrieved = z.infer<
  typeof LinkedInSearchResultsRetrievedSchema
>;

export const LinkedInActionAttemptedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("ActionAttempted"),
  actionType: z.string(),
  targetId: z.string().optional(),
});

export type LinkedInActionAttempted = z.infer<
  typeof LinkedInActionAttemptedSchema
>;

export const LinkedInActionConfirmedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("ActionConfirmed"),
  actionType: z.string(),
  targetId: z.string().optional(),
  confirmedAt: z.iso.datetime(),
});

export type LinkedInActionConfirmed = z.infer<
  typeof LinkedInActionConfirmedSchema
>;

export const LinkedInRateLimitObservedSchema = CorrelationMetadataSchema.extend(
  {
    scope: linkedInScopeSchema,
    type: z.literal("RateLimitObserved"),
    configId: z.string(),
    accountId: z.string().transform((val) => val as AccountId),
    retryAfter: z.iso.datetime().optional(),
    limitType: z.enum(["weekly_invites", "daily_messages", "searches"]),
  },
);

export type LinkedInRateLimitObserved = z.infer<
  typeof LinkedInRateLimitObservedSchema
>;

export const LinkedInProfileViewedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInScopeSchema,
  type: z.literal("ProfileViewed"),
  targetUserId: z.string(),
  profileUrl: z.string().optional(),
  viewedAt: z.iso.datetime(),
});

export type LinkedInProfileViewed = z.infer<typeof LinkedInProfileViewedSchema>;

export const LinkedInInvitationWithdrawnSchema = CorrelationMetadataSchema
  .extend({
    scope: linkedInScopeSchema,
    type: z.literal("InvitationWithdrawn"),
    invitationId: z.string(),
    targetUserId: z.string(),
  });

export type LinkedInInvitationWithdrawn = z.infer<
  typeof LinkedInInvitationWithdrawnSchema
>;

export const LinkedInConnectionAcceptedSchema = CorrelationMetadataSchema
  .extend({
    scope: linkedInScopeSchema,
    type: z.literal("ConnectionAccepted"),
    invitationId: z.string(),
    userId: z.string(),
  });

export type LinkedInConnectionAccepted = z.infer<
  typeof LinkedInConnectionAcceptedSchema
>;

export const LinkedInConnectionRejectedSchema = CorrelationMetadataSchema
  .extend({
    scope: linkedInScopeSchema,
    type: z.literal("ConnectionRejected"),
    invitationId: z.string(),
    userId: z.string(),
  });

export type LinkedInConnectionRejected = z.infer<
  typeof LinkedInConnectionRejectedSchema
>;

// Event Union
export const LinkedInEventSchema = z.discriminatedUnion("type", [
  LinkedInAuthObservedSchema,
  LinkedInAnchorMessageObservedSchema,
  LinkedInMessageObservedSchema,
  LinkedInMessageMutatedSchema,
  LinkedInMessageSentSchema,
  LinkedInConversationsSyncedSchema,
  LinkedInConnectionRequestSentSchema,
  LinkedInUserFollowedSchema,
  LinkedInSearchResultsRetrievedSchema,
  LinkedInActionAttemptedSchema,
  LinkedInActionConfirmedSchema,
  LinkedInRateLimitObservedSchema,
  LinkedInProfileViewedSchema,
  LinkedInInvitationWithdrawnSchema,
  LinkedInConnectionAcceptedSchema,
  LinkedInConnectionRejectedSchema,
]);

export type LinkedInEvent = z.infer<typeof LinkedInEventSchema>;

// Intent Schemas

const LinkedInIntentBase = z.object({
  scope: linkedInScopeSchema,
  intentId: z.uuid().transform((val) => val as IntentId),
  timestamp: z.iso.datetime(),
});

export const LinkedInSendMessageSchema = LinkedInIntentBase.merge(
  SendMessageBase,
).extend({
  type: z.literal("SendMessage"),
});

export type LinkedInSendMessage = z.infer<typeof LinkedInSendMessageSchema>;

export const LinkedInSyncConversationsSchema = LinkedInIntentBase.merge(
  SyncConversationsBase,
).extend({
  type: z.literal("SyncConversations"),
});

export type LinkedInSyncConversations = z.infer<
  typeof LinkedInSyncConversationsSchema
>;

export const LinkedInConnectSchema = LinkedInIntentBase.extend({
  type: z.literal("Connect"),
  targetUserId: z.string(),
  note: z.string().max(300).optional(),
});

export type LinkedInConnect = z.infer<typeof LinkedInConnectSchema>;

export const LinkedInFollowSchema = LinkedInIntentBase.extend({
  type: z.literal("Follow"),
  targetUserId: z.string(),
});

export type LinkedInFollow = z.infer<typeof LinkedInFollowSchema>;

export const LinkedInPeopleSearchSchema = LinkedInIntentBase.extend({
  type: z.literal("PeopleSearch"),
  query: z.string(),
  limit: z.number().positive().optional(),
});

export type LinkedInPeopleSearch = z.infer<typeof LinkedInPeopleSearchSchema>;

export const LinkedInRecallMessageSchema = LinkedInIntentBase.extend({
  type: z.literal("RecallMessage"),
  messageId: z.string(),
  threadId: z.string().transform((val) => val as ThreadId),
});

export type LinkedInRecallMessage = z.infer<typeof LinkedInRecallMessageSchema>;

export const LinkedInWithdrawInvitationSchema = LinkedInIntentBase.extend({
  type: z.literal("WithdrawInvitation"),
  invitationId: z.string(),
  targetUserId: z.string(),
});

export type LinkedInWithdrawInvitation = z.infer<
  typeof LinkedInWithdrawInvitationSchema
>;

export const LinkedInViewProfileSchema = LinkedInIntentBase.extend({
  type: z.literal("ViewProfile"),
  targetUserId: z.string(),
  profileUrl: z.string().optional(),
  fetchData: z.boolean().optional(),
});

export type LinkedInViewProfile = z.infer<typeof LinkedInViewProfileSchema>;

export const LinkedInAcceptInvitationSchema = LinkedInIntentBase.extend({
  type: z.literal("AcceptInvitation"),
  invitationId: z.string(),
  userId: z.string(),
});

export type LinkedInAcceptInvitation = z.infer<
  typeof LinkedInAcceptInvitationSchema
>;

export const LinkedInRejectInvitationSchema = LinkedInIntentBase.extend({
  type: z.literal("RejectInvitation"),
  invitationId: z.string(),
  userId: z.string(),
});

export type LinkedInRejectInvitation = z.infer<
  typeof LinkedInRejectInvitationSchema
>;

export const LinkedInSearchCompaniesSchema = LinkedInIntentBase.extend({
  type: z.literal("SearchCompanies"),
  query: z.string(),
  limit: z.number().positive().optional(),
});

export type LinkedInSearchCompanies = z.infer<
  typeof LinkedInSearchCompaniesSchema
>;

// Intent Union
export const LinkedInIntentSchema = z.discriminatedUnion("type", [
  LinkedInSendMessageSchema,
  LinkedInSyncConversationsSchema,
  LinkedInConnectSchema,
  LinkedInFollowSchema,
  LinkedInPeopleSearchSchema,
  LinkedInRecallMessageSchema,
  LinkedInWithdrawInvitationSchema,
  LinkedInViewProfileSchema,
  LinkedInAcceptInvitationSchema,
  LinkedInRejectInvitationSchema,
  LinkedInSearchCompaniesSchema,
]);

export type LinkedInIntent = z.infer<typeof LinkedInIntentSchema>;
