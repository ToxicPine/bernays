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
  type XScope,
} from "./schemas.ts";

// Views
import type { XInbox, XThread } from "./views.ts";

// Account & Browser
import type { XAccount } from "./account.ts";
import type { XBrowser } from "./browser.ts";
import type { XContact } from "./contact.ts";

// Behavior
import { xBehavior, type XPluginState } from "./behavior.ts";

export const xPlatform: PlatformDefinition<
  XScope,
  "x",
  XEvent,
  XAnchor,
  XThread,
  XInbox,
  XAccount,
  XBrowser,
  XContact,
  XPluginState
> = {
  scope: X_SCOPE,
  identity: "x",
  eventSchema: XEventSchema,
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

// Views
export type { XInbox, XIndexMeta, XThread } from "./views.ts";

// Browser
export type { XBrowser } from "./browser.ts";

// Contact
export type { XContact } from "./contact.ts";

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
export { xBehavior, type XPluginState } from "./behavior.ts";
