// plugins/linkedindojo/mod.ts
// LinkedIn Dojo platform definition - browser-free testing environment

import type { PlatformDefinition } from "@bernays/server/platforms";

// Schemas (dojo-specific scope)
import {
  LINKEDIN_DOJO_SCOPE,
  type LinkedInDojoEvent,
  LinkedInDojoEventSchema,
  type LinkedInDojoScope,
} from "./schemas.ts";

// Anchor schema (reused from LinkedIn)
import { type LinkedInAnchor, LinkedInAnchorSchema } from "./schemas.ts";

// Views (reused from LinkedIn)
import type { LinkedInInbox, LinkedInThread } from "../linkedin/views.ts";

// Account, Browser & Contact (reused from LinkedIn)
import type { LinkedInAccount } from "../linkedin/account.ts";
import type { LinkedInBrowser } from "../linkedin/browser.ts";
import type { LinkedInContact } from "../linkedin/contact.ts";

// Behavior (dojo-specific, pure derivation)
import { linkedInDojoBehavior, type LinkedInDojoPluginState } from "./behavior.ts";

// Identity namespace - dojo uses same identity as production LinkedIn
const LINKEDIN_IDENTITY = "linkedin" as const;
type LinkedInIdentity = typeof LINKEDIN_IDENTITY;

// Platform Definition

export const linkedInDojoPlatform: PlatformDefinition<
  LinkedInDojoScope,
  LinkedInIdentity,
  LinkedInDojoEvent,
  LinkedInAnchor,
  LinkedInThread,
  LinkedInInbox,
  LinkedInAccount,
  LinkedInBrowser,
  LinkedInContact,
  LinkedInDojoPluginState
> = {
  scope: LINKEDIN_DOJO_SCOPE,
  identity: LINKEDIN_IDENTITY,
  eventSchema: LinkedInDojoEventSchema,
  anchorSchema: LinkedInAnchorSchema,
  behavior: linkedInDojoBehavior,
};

// Exports

export { LINKEDIN_DOJO_SCOPE } from "./schemas.ts";

// Schemas (events)
export {
  type LinkedInDojoAnchorMessageObserved,
  LinkedInDojoAnchorMessageObservedSchema,
  type LinkedInDojoAuthObserved,
  LinkedInDojoAuthObservedSchema,
  type LinkedInDojoEvent,
  LinkedInDojoEventSchema,
  type LinkedInDojoMessageObserved,
  LinkedInDojoMessageObservedSchema,
  type LinkedInDojoMessageSent,
  LinkedInDojoMessageSentSchema,
  type LinkedInDojoRateLimitObserved,
  LinkedInDojoRateLimitObservedSchema,
} from "./schemas.ts";

// Intent schemas (kept for dojo-specific action layer)
export {
  type LinkedInDojoIntent,
  LinkedInDojoIntentSchema,
  type LinkedInDojoSendMessage,
  LinkedInDojoSendMessageSchema,
  type LinkedInDojoSyncConversations,
  LinkedInDojoSyncConversationsSchema,
} from "./schemas.ts";

// Behavior & Injector tag (injector used by dojo actions layer)
export { linkedInDojoBehavior, LinkedInDojoInjector, type LinkedInDojoPluginState } from "./behavior.ts";

// Re-export types from LinkedIn plugin for convenience
export type { LinkedInAnchor } from "./schemas.ts";
export type { LinkedInAccount } from "../linkedin/account.ts";
export type { LinkedInBrowser } from "../linkedin/browser.ts";
export type { LinkedInContact } from "../linkedin/contact.ts";
export type { LinkedInInbox, LinkedInThread } from "../linkedin/views.ts";
