// src/platforms/x/mod.ts
// X (Twitter) platform definition - stub implementation

import type { PlatformDefinition } from "@bernays/server/platforms";

// Re-export from split files
export {
  X_SCOPE,
  type XAnchor,
  XAnchorSchema,
  type XScope,
} from "./schemas.ts";
export {
  type XAuthObserved,
  XAuthObservedSchema,
  type XEvent,
  XEventSchema,
} from "./schemas.ts";
export {
  type XIntent,
  XIntentSchema,
  type XSendMessage,
  XSendMessageSchema,
} from "./schemas.ts";
export { type XInbox, type XIndexMeta, type XThread } from "./views.ts";
export { type XAuthStatus, type XBrowser } from "./browser.ts";
export {
  makeInMemoryXAccountStoreLayer,
  type XAccount,
  XAccountStore,
  type XAccountStoreService,
} from "./account.ts";
export { xBehavior } from "./behavior.ts";

// Local imports for platform definition
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
import type { XInbox, XThread } from "./views.ts";
import type { XBrowser } from "./browser.ts";
import type { XAccount } from "./account.ts";
import { xBehavior } from "./behavior.ts";

// ============================================================================
// X Platform Definition
// ============================================================================

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
