// src/platforms/reddit/schemas.ts
// Reddit platform schemas - events and intents

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

export const REDDIT_SCOPE = Scope("reddit");
export type RedditScope = typeof REDDIT_SCOPE;

const redditScopeSchema = z.literal("reddit").transform(() => REDDIT_SCOPE);

// Reddit Anchor

export const RedditAnchorSchema = z.object({
  roomId: z.string(),
  participants: z.array(z.string()),
});

export type RedditAnchor = z.infer<typeof RedditAnchorSchema>;

// Event Schemas

export const RedditAuthObservedSchema = CorrelationMetadataSchema.extend({
  scope: redditScopeSchema,
  type: z.literal("AuthObserved"),
  accountId: z.string().transform((val) => val as AccountId),
  browserId: z.string(),
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
    threadId: z.string().transform((val) => val as ThreadId),
  });

export type RedditDirectMessageObserved = z.infer<
  typeof RedditDirectMessageObservedSchema
>;

export const RedditMessageObservedSchema = MessageObservedBase.extend({
  scope: redditScopeSchema,
  type: z.literal("MessageObserved"),
  threadId: z.string().transform((val) => val as ThreadId),
});

export type RedditMessageObserved = z.infer<typeof RedditMessageObservedSchema>;

export const RedditMessageSentSchema = CorrelationMetadataSchema.extend({
  scope: redditScopeSchema,
  type: z.literal("MessageSent"),
  threadId: z.string().transform((val) => val as ThreadId),
  canonicalId: z.string().transform((val) => val as CanonicalId),
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

export const RedditRateLimitObservedSchema = CorrelationMetadataSchema.extend({
  scope: redditScopeSchema,
  type: z.literal("RateLimitObserved"),
  browserId: z.string(),
  retryAfter: z.string().optional(),
  limitType: z.enum(["message", "chat", "general"]),
});

export type RedditRateLimitObserved = z.infer<
  typeof RedditRateLimitObservedSchema
>;

export const RedditAccountBannedSchema = CorrelationMetadataSchema.extend({
  scope: redditScopeSchema,
  type: z.literal("AccountBanned"),
  accountId: z.string().transform((val) => val as AccountId),
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
    accountId: z.string().transform((val) => val as AccountId),
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
  intentId: z.uuid().transform((val) => val as IntentId),
  timestamp: z.iso.datetime(),
});

export const RedditSendDirectMessageSchema = RedditIntentBase.merge(
  SendMessageBase,
).extend({
  type: z.literal("SendDirectMessage"),
  recipientUsername: z.string().optional(),
});

export type RedditSendDirectMessage = z.infer<
  typeof RedditSendDirectMessageSchema
>;

export const RedditSyncConversationsSchema = RedditIntentBase.merge(
  SyncConversationsBase,
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
