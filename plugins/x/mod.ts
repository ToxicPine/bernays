// src/platforms/x/mod.ts
// X (Twitter) platform definition

import type { PlatformDefinition } from "@bernays/server/platforms";

// Schemas
import {
  X_SCOPE,
  type XAnchor,
  XAnchorSchema,
  type XEvent,
  XEventSchema,
  type XIntent,
  XIntentSchema,
  type XScope,
} from "./schemas.ts";

// Views
import type { XInbox, XThread } from "./views.ts";

// Account & Browser
import type { XAccount } from "./account.ts";
import type { XBrowser } from "./browser.ts";

// Behavior
import { xBehavior } from "./behavior.ts";

export const xPlatform: PlatformDefinition<
  XScope,
  XEvent,
  XIntent,
  XAnchor,
  XThread,
  XInbox,
  XAccount,
  XBrowser
> = {
  scope: X_SCOPE,
  eventSchema: XEventSchema,
  intentSchema: XIntentSchema,
  anchorSchema: XAnchorSchema,
  behavior: xBehavior,
};

// Scope
export { X_SCOPE } from "./schemas.ts";

// Schemas (events)
export {
  type XAccountSuspended,
  XAccountSuspendedSchema,
  type XAnchor,
  type XAnchorMessageObserved,
  XAnchorMessageObservedSchema,
  XAnchorSchema,
  type XAuthObserved,
  XAuthObservedSchema,
  type XConversationsSynced,
  XConversationsSyncedSchema,
  type XEvent,
  XEventSchema,
  type XFollowObserved,
  XFollowObservedSchema,
  type XLikeObserved,
  XLikeObservedSchema,
  type XMessageObserved,
  XMessageObservedSchema,
  type XMessageSent,
  XMessageSentSchema,
  type XRateLimitObserved,
  XRateLimitObservedSchema,
  type XRetweetObserved,
  XRetweetObservedSchema,
  type XScope,
  type XTweetObserved,
  XTweetObservedSchema,
  type XTweetSent,
  XTweetSentSchema,
} from "./schemas.ts";

// Schemas (intents)
export {
  type XBookmarkTweet,
  XBookmarkTweetSchema,
  type XDeleteTweet,
  XDeleteTweetSchema,
  type XFollow,
  XFollowSchema,
  type XIntent,
  XIntentSchema,
  type XLike,
  XLikeSchema,
  type XPostTweet,
  XPostTweetSchema,
  type XReplyToTweet,
  XReplyToTweetSchema,
  type XRetweet,
  XRetweetSchema,
  type XSearchTweets,
  XSearchTweetsSchema,
  type XSendMessage,
  XSendMessageSchema,
  type XSyncConversations,
  XSyncConversationsSchema,
  type XUnfollow,
  XUnfollowSchema,
  type XUnlike,
  XUnlikeSchema,
} from "./schemas.ts";

// Views
export type { XInbox, XIndexMeta, XThread } from "./views.ts";

// Browser
export type { XAuthStatus, XBrowser } from "./browser.ts";

// Account
export {
  createPostgresXAccountStore,
  makeInMemoryXAccountStoreLayer,
  type PostgresXAccountStoreOptions,
  type XAccount,
  XAccountStore,
  type XAccountStoreService,
} from "./account.ts";

// Behavior
export { xBehavior } from "./behavior.ts";
