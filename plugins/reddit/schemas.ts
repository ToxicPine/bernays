// src/platforms/reddit/schemas.ts
// Reddit platform schemas - events and intents

import { z } from "@zod/zod";
import {
  CanonicalId,
  IntentId,
  participantIdSchema,
  Scope,
  ThreadId,
} from "@bernays/server/core";
import { CorrelationMetadataSchema } from "@bernays/server/events";
import {
  AnchorMessageObservedBase,
  authObservedBase,
  MessageObservedBase,
  rateLimitObservedBase,
} from "@bernays/server/events";
import {
  SendMessageBase,
  SyncConversationsBase,
} from "@bernays/server/intents";

// Scope

export const REDDIT_SCOPE = Scope("reddit");
export type RedditScope = typeof REDDIT_SCOPE;

const redditScopeSchema = z.literal("reddit").transform(() => REDDIT_SCOPE);

// Reddit Anchor

export const RedditAnchorSchema = z.object({
  roomId: z.string(),
  participants: z.array(participantIdSchema("reddit")),
});

export type RedditAnchor = z.infer<typeof RedditAnchorSchema>;

// Event Schemas

export const RedditAuthObservedSchema = authObservedBase("reddit").extend({
  scope: redditScopeSchema,
  type: z.literal("AuthObserved"),
  tabId: z.string(),
  authenticated: z.boolean(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
  isBanned: z.boolean().optional(),
  bannedReason: z.string().optional(),
});

export type RedditAuthObserved = z.infer<typeof RedditAuthObservedSchema>;

export const RedditDirectMessageObservedSchema = AnchorMessageObservedBase
  .extend({
    scope: redditScopeSchema,
    type: z.literal("DirectMessageObserved"),
    anchor: RedditAnchorSchema,
    threadId: z.string().transform(ThreadId),
  });

export type RedditDirectMessageObserved = z.infer<
  typeof RedditDirectMessageObservedSchema
>;

export const RedditMessageObservedSchema = MessageObservedBase.extend({
  scope: redditScopeSchema,
  type: z.literal("MessageObserved"),
  threadId: z.string().transform(ThreadId),
});

export type RedditMessageObserved = z.infer<typeof RedditMessageObservedSchema>;

export const RedditMessageSentSchema = CorrelationMetadataSchema.extend({
  scope: redditScopeSchema,
  type: z.literal("MessageSent"),
  threadId: z.string().transform(ThreadId),
  canonicalId: z.string().transform(CanonicalId),
  content: z.string(),
});

export type RedditMessageSent = z.infer<typeof RedditMessageSentSchema>;

export const RedditUserDiscoveredSchema = CorrelationMetadataSchema.extend({
  scope: redditScopeSchema,
  type: z.literal("UserDiscovered"),
  userId: z.string(),
  username: z.string(),
  karma: z.number().optional(),
  accountAge: z.string().optional(),
  subreddit: z.string().optional(),
  discoveredFrom: z.enum(["thread", "subreddit", "search"]),
});

export type RedditUserDiscovered = z.infer<typeof RedditUserDiscoveredSchema>;

export const RedditRateLimitObservedSchema = rateLimitObservedBase("reddit")
  .extend({
    scope: redditScopeSchema,
    type: z.literal("RateLimitObserved"),
    limitType: z.enum(["message", "chat", "general"]),
  });

export type RedditRateLimitObserved = z.infer<
  typeof RedditRateLimitObservedSchema
>;

export const RedditAccountBannedSchema = CorrelationMetadataSchema.extend({
  scope: redditScopeSchema,
  type: z.literal("AccountBanned"),
  participantId: participantIdSchema("reddit"),
  banType: z.enum(["suspended", "shadowbanned", "subreddit"]),
  reason: z.string().optional(),
  subreddit: z.string().optional(),
  permanent: z.boolean().optional(),
  expiresAt: z.iso.datetime().optional(),
});

export type RedditAccountBanned = z.infer<typeof RedditAccountBannedSchema>;

export const RedditConversationsSyncedSchema = CorrelationMetadataSchema
  .extend({
    scope: redditScopeSchema,
    type: z.literal("ConversationsSynced"),
    participantId: participantIdSchema("reddit"),
    threadCount: z.number(),
    syncedAt: z.iso.datetime(),
  });

export type RedditConversationsSynced = z.infer<
  typeof RedditConversationsSyncedSchema
>;

// Event Union
export const RedditEventSchema = z.discriminatedUnion("type", [
  RedditAuthObservedSchema,
  RedditDirectMessageObservedSchema,
  RedditMessageObservedSchema,
  RedditMessageSentSchema,
  RedditUserDiscoveredSchema,
  RedditRateLimitObservedSchema,
  RedditAccountBannedSchema,
  RedditConversationsSyncedSchema,
]);

export type RedditEvent = z.infer<typeof RedditEventSchema>;

// Intent Schemas

const RedditIntentBase = z.object({
  scope: redditScopeSchema,
  intentId: z.uuid().transform(IntentId),
  timestamp: z.iso.datetime(),
});

export const RedditSendDirectMessageSchema = RedditIntentBase.extend(
  SendMessageBase.shape,
).extend({
  type: z.literal("SendDirectMessage"),
  recipientUsername: z.string().optional(),
});

export type RedditSendDirectMessage = z.infer<
  typeof RedditSendDirectMessageSchema
>;

export const RedditSyncConversationsSchema = RedditIntentBase.extend(
  SyncConversationsBase.shape,
).extend({
  type: z.literal("SyncConversations"),
});

export type RedditSyncConversations = z.infer<
  typeof RedditSyncConversationsSchema
>;

export const RedditDiscoverUsersSchema = RedditIntentBase.extend({
  type: z.literal("DiscoverUsers"),
  subreddit: z.string().optional(),
  threadUrl: z.string().optional(),
  limit: z.number().positive().optional(),
});

export type RedditDiscoverUsers = z.infer<typeof RedditDiscoverUsersSchema>;

// Intent Union
export const RedditIntentSchema = z.discriminatedUnion("type", [
  RedditSendDirectMessageSchema,
  RedditSyncConversationsSchema,
  RedditDiscoverUsersSchema,
]);

export type RedditIntent = z.infer<typeof RedditIntentSchema>;
