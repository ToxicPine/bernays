// src/platforms/reddit/mod.ts
// Reddit platform definition

import type { PlatformDefinition } from "@bernays/server/platforms";

// Schemas
import {
  REDDIT_SCOPE,
  type RedditAnchor,
  RedditAnchorSchema,
  type RedditEvent,
  RedditEventSchema,
  type RedditIntent,
  RedditIntentSchema,
  type RedditScope,
} from "./schemas.ts";

// Views
import type { RedditInbox, RedditThread } from "./views.ts";

// Account & Browser
import type { RedditAccount } from "./account.ts";
import type { RedditBrowser } from "./browser.ts";

// Behavior
import { redditBehavior } from "./behavior.ts";

export const redditPlatform: PlatformDefinition<
  RedditScope,
  RedditEvent,
  RedditIntent,
  RedditAnchor,
  RedditThread,
  RedditInbox,
  RedditAccount,
  RedditBrowser
> = {
  scope: REDDIT_SCOPE,
  eventSchema: RedditEventSchema,
  intentSchema: RedditIntentSchema,
  anchorSchema: RedditAnchorSchema,
  behavior: redditBehavior,
};

// Scope
export { REDDIT_SCOPE } from "./schemas.ts";

// Schemas (events)
export {
  type RedditAccountBanned,
  RedditAccountBannedSchema,
  type RedditAnchor,
  RedditAnchorSchema,
  type RedditAuthObserved,
  RedditAuthObservedSchema,
  type RedditConversationsSynced,
  RedditConversationsSyncedSchema,
  type RedditDirectMessageObserved,
  RedditDirectMessageObservedSchema,
  type RedditEvent,
  RedditEventSchema,
  type RedditMessageObserved,
  RedditMessageObservedSchema,
  type RedditMessageSent,
  RedditMessageSentSchema,
  type RedditRateLimitObserved,
  RedditRateLimitObservedSchema,
  type RedditUserDiscovered,
  RedditUserDiscoveredSchema,
} from "./schemas.ts";

// Schemas (intents)
export {
  type RedditDiscoverUsers,
  RedditDiscoverUsersSchema,
  type RedditIntent,
  RedditIntentSchema,
  type RedditSendDirectMessage,
  RedditSendDirectMessageSchema,
  type RedditSyncConversations,
  RedditSyncConversationsSchema,
} from "./schemas.ts";

// Views
export type {
  RedditInbox,
  RedditIndexMeta,
  RedditThread,
} from "./views.ts";

// Browser
export type { RedditAuthStatus, RedditBrowser } from "./browser.ts";

// Account
export {
  createPostgresRedditAccountStore,
  type RedditAccount,
  RedditAccountStore,
  type RedditAccountStoreService,
  makeInMemoryRedditAccountStoreLayer,
} from "./account.ts";

// Behavior
export { redditBehavior } from "./behavior.ts";
