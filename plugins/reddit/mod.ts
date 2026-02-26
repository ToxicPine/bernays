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
  type RedditScope,
} from "./schemas.ts";

// Views
import type { RedditInbox, RedditThread } from "./views.ts";

// Account & Browser
import type { RedditAccount } from "./account.ts";
import type { RedditBrowser } from "./browser.ts";
import type { RedditContact } from "./contact.ts";

// Behavior
import { redditBehavior, type RedditPluginState } from "./behavior.ts";

export const redditPlatform: PlatformDefinition<
  RedditScope,
  "reddit",
  RedditEvent,
  RedditAnchor,
  RedditThread,
  RedditInbox,
  RedditAccount,
  RedditBrowser,
  RedditContact,
  RedditPluginState
> = {
  scope: REDDIT_SCOPE,
  identity: "reddit",
  eventSchema: RedditEventSchema,
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

// Views
export type { RedditInbox, RedditIndexMeta, RedditThread } from "./views.ts";

// Browser
export type { RedditBrowser } from "./browser.ts";

// Contact
export type { RedditContact } from "./contact.ts";

// Account
export {
  createPostgresRedditAccountStore,
  makeInMemoryRedditAccountStoreLayer,
  type RedditAccount,
  RedditAccountStore,
  type RedditAccountStoreService,
} from "./account.ts";

// Behavior
export { redditBehavior, type RedditPluginState } from "./behavior.ts";
