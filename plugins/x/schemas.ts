// src/platforms/x/schemas.ts
// X (Twitter) platform schemas - events and intents

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

// ============================================================================
// Scope
// ============================================================================

export const X_SCOPE = Scope("x");
export type XScope = typeof X_SCOPE;

const xScopeSchema = z.literal("x").transform(() => X_SCOPE);

// ============================================================================
// X Anchor (for DM conversations)
// ============================================================================

export const XAnchorSchema = z.object({
  conversationId: z.string(),
  participants: z.array(z.string()),
});

export type XAnchor = z.infer<typeof XAnchorSchema>;

// ============================================================================
// Event Schemas
// ============================================================================

// 1. XAuthObservedSchema - extends AuthObservedBase with X-specific fields
export const XAuthObservedSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("AuthObserved"),
  accountId: z.string().transform((val) => val as AccountId),
  browserId: z.string(),
  tabId: z.string(),
  authenticated: z.boolean(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
  issue: z.string().optional(), // e.g., "suspended", "locked", "restricted"
});

export type XAuthObserved = z.infer<typeof XAuthObservedSchema>;

// 2. XRateLimitObservedSchema - rate limit detection
export const XRateLimitObservedSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("RateLimitObserved"),
  accountId: z.string().transform((val) => val as AccountId),
  configId: z.string(),
  retryAfter: z.iso.datetime().optional(),
  limitType: z.enum(["tweets", "dms", "follows", "likes", "api"]),
});

export type XRateLimitObserved = z.infer<typeof XRateLimitObservedSchema>;

// 3. XAnchorMessageObservedSchema - for DM thread starts
export const XAnchorMessageObservedSchema = AnchorMessageObservedBase.extend({
  scope: xScopeSchema,
  type: z.literal("AnchorMessageObserved"),
  anchor: XAnchorSchema,
  threadId: z.string().transform((val) => val as ThreadId),
});

export type XAnchorMessageObserved = z.infer<
  typeof XAnchorMessageObservedSchema
>;

// 4. XMessageObservedSchema - for DM replies
export const XMessageObservedSchema = MessageObservedBase.extend({
  scope: xScopeSchema,
  type: z.literal("MessageObserved"),
  threadId: z.string().transform((val) => val as ThreadId),
});

export type XMessageObserved = z.infer<typeof XMessageObservedSchema>;

// 5. XMessageSentSchema - DM sent confirmation
export const XMessageSentSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("MessageSent"),
  threadId: z.string().transform((val) => val as ThreadId),
  canonicalId: z.string().transform((val) => val as CanonicalId),
  content: z.string(),
});

export type XMessageSent = z.infer<typeof XMessageSentSchema>;

// 6. XConversationsSyncedSchema - DM sync complete
export const XConversationsSyncedSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("ConversationsSynced"),
  accountId: z.string().transform((val) => val as AccountId),
  threadCount: z.number(),
  syncedAt: z.iso.datetime(),
});

export type XConversationsSynced = z.infer<typeof XConversationsSyncedSchema>;

// 7. XTweetObservedSchema - observed tweet with metrics
export const XTweetObservedSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("TweetObserved"),
  tweetId: z.string(),
  authorId: z.string(),
  authorHandle: z.string(),
  content: z.string(),
  inReplyToTweetId: z.string().optional(),
  quotedTweetId: z.string().optional(),
  metrics: z.object({
    likes: z.number(),
    retweets: z.number(),
    replies: z.number(),
    views: z.number().optional(),
    bookmarks: z.number().optional(),
  }),
  createdAt: z.iso.datetime(),
});

export type XTweetObserved = z.infer<typeof XTweetObservedSchema>;

// 8. XTweetSentSchema - posted tweet confirmation
export const XTweetSentSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("TweetSent"),
  tweetId: z.string(),
  content: z.string(),
  inReplyToTweetId: z.string().optional(),
  quotedTweetId: z.string().optional(),
  postedAt: z.iso.datetime(),
});

export type XTweetSent = z.infer<typeof XTweetSentSchema>;

// 9. XFollowObservedSchema - follow action
export const XFollowObservedSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("FollowObserved"),
  targetUserId: z.string(),
  targetHandle: z.string(),
  followedAt: z.iso.datetime(),
});

export type XFollowObserved = z.infer<typeof XFollowObservedSchema>;

// 10. XLikeObservedSchema - like action
export const XLikeObservedSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("LikeObserved"),
  tweetId: z.string(),
  likedAt: z.iso.datetime(),
});

export type XLikeObserved = z.infer<typeof XLikeObservedSchema>;

// 11. XRetweetObservedSchema - retweet action
export const XRetweetObservedSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("RetweetObserved"),
  tweetId: z.string(),
  retweetedAt: z.iso.datetime(),
});

export type XRetweetObserved = z.infer<typeof XRetweetObservedSchema>;

// 12. XAccountSuspendedSchema - suspension detection
export const XAccountSuspendedSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("AccountSuspended"),
  accountId: z.string().transform((val) => val as AccountId),
  reason: z.string().optional(),
  suspendedAt: z.iso.datetime(),
  appealUrl: z.string().optional(),
});

export type XAccountSuspended = z.infer<typeof XAccountSuspendedSchema>;

// Event Union
export const XEventSchema = z.discriminatedUnion("type", [
  XAuthObservedSchema,
  XRateLimitObservedSchema,
  XAnchorMessageObservedSchema,
  XMessageObservedSchema,
  XMessageSentSchema,
  XConversationsSyncedSchema,
  XTweetObservedSchema,
  XTweetSentSchema,
  XFollowObservedSchema,
  XLikeObservedSchema,
  XRetweetObservedSchema,
  XAccountSuspendedSchema,
]);

export type XEvent = z.infer<typeof XEventSchema>;

// ============================================================================
// Intent Schemas
// ============================================================================

const XIntentBase = z.object({
  scope: xScopeSchema,
  intentId: z.uuid().transform((val) => val as IntentId),
  timestamp: z.iso.datetime(),
});

// 1. XSendMessageSchema - send DM
export const XSendMessageSchema = XIntentBase.merge(SendMessageBase).extend({
  type: z.literal("SendMessage"),
});

export type XSendMessage = z.infer<typeof XSendMessageSchema>;

// 2. XSyncConversationsSchema - sync DM conversations
export const XSyncConversationsSchema = XIntentBase.merge(
  SyncConversationsBase,
).extend({
  type: z.literal("SyncConversations"),
});

export type XSyncConversations = z.infer<typeof XSyncConversationsSchema>;

// 3. XPostTweetSchema - create tweet (280 char limit)
export const XPostTweetSchema = XIntentBase.extend({
  type: z.literal("PostTweet"),
  content: z.string().min(1).max(280),
  mediaIds: z.array(z.string()).optional(),
});

export type XPostTweet = z.infer<typeof XPostTweetSchema>;

// 4. XReplyToTweetSchema - reply to tweet
export const XReplyToTweetSchema = XIntentBase.extend({
  type: z.literal("ReplyToTweet"),
  inReplyToTweetId: z.string(),
  content: z.string().min(1).max(280),
  mediaIds: z.array(z.string()).optional(),
});

export type XReplyToTweet = z.infer<typeof XReplyToTweetSchema>;

// 5. XRetweetSchema - retweet
export const XRetweetSchema = XIntentBase.extend({
  type: z.literal("Retweet"),
  tweetId: z.string(),
});

export type XRetweet = z.infer<typeof XRetweetSchema>;

// 6. XLikeSchema - like tweet
export const XLikeSchema = XIntentBase.extend({
  type: z.literal("Like"),
  tweetId: z.string(),
});

export type XLike = z.infer<typeof XLikeSchema>;

// 7. XUnlikeSchema - unlike tweet
export const XUnlikeSchema = XIntentBase.extend({
  type: z.literal("Unlike"),
  tweetId: z.string(),
});

export type XUnlike = z.infer<typeof XUnlikeSchema>;

// 8. XFollowSchema - follow user
export const XFollowSchema = XIntentBase.extend({
  type: z.literal("Follow"),
  targetUserId: z.string(),
});

export type XFollow = z.infer<typeof XFollowSchema>;

// 9. XUnfollowSchema - unfollow user
export const XUnfollowSchema = XIntentBase.extend({
  type: z.literal("Unfollow"),
  targetUserId: z.string(),
});

export type XUnfollow = z.infer<typeof XUnfollowSchema>;

// 10. XDeleteTweetSchema - delete tweet
export const XDeleteTweetSchema = XIntentBase.extend({
  type: z.literal("DeleteTweet"),
  tweetId: z.string(),
});

export type XDeleteTweet = z.infer<typeof XDeleteTweetSchema>;

// 11. XBookmarkTweetSchema - bookmark tweet
export const XBookmarkTweetSchema = XIntentBase.extend({
  type: z.literal("BookmarkTweet"),
  tweetId: z.string(),
});

export type XBookmarkTweet = z.infer<typeof XBookmarkTweetSchema>;

// 12. XSearchTweetsSchema - search tweets
export const XSearchTweetsSchema = XIntentBase.extend({
  type: z.literal("SearchTweets"),
  query: z.string(),
  limit: z.number().positive().optional(),
  filter: z.enum(["top", "latest", "people", "photos", "videos"]).optional(),
});

export type XSearchTweets = z.infer<typeof XSearchTweetsSchema>;

// Intent Union
export const XIntentSchema = z.discriminatedUnion("type", [
  XSendMessageSchema,
  XSyncConversationsSchema,
  XPostTweetSchema,
  XReplyToTweetSchema,
  XRetweetSchema,
  XLikeSchema,
  XUnlikeSchema,
  XFollowSchema,
  XUnfollowSchema,
  XDeleteTweetSchema,
  XBookmarkTweetSchema,
  XSearchTweetsSchema,
]);

export type XIntent = z.infer<typeof XIntentSchema>;
