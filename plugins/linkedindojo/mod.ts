// plugins/linkedindojo/mod.ts
// LinkedIn Dojo platform definition — browser-free testing environment

import type { PlatformDefinition } from "@bernays/server/platforms";

import {
  LINKEDIN_DOJO_SCOPE,
  type LinkedInDojoEvent,
  LinkedInDojoEventSchema,
  type LinkedInDojoScope,
} from "./schemas.ts";
import { type LinkedInAnchor, LinkedInAnchorSchema } from "./schemas.ts";
import type { LinkedInInbox, LinkedInThread } from "../linkedin/views.ts";
import type { LinkedInAccount } from "../linkedin/account.ts";
import type { LinkedInBrowser } from "../linkedin/browser.ts";
import type { LinkedInContact } from "../linkedin/contact.ts";
import {
  linkedInDojoBehavior,
  type LinkedInDojoPluginState,
} from "./behavior.ts";

const LINKEDIN_IDENTITY = "linkedin" as const;
type LinkedInIdentity = typeof LINKEDIN_IDENTITY;

// =============================================================================
// Platform Definition
// =============================================================================

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

// =============================================================================
// Re-exports
// =============================================================================

export { LINKEDIN_DOJO_SCOPE } from "./schemas.ts";

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
  type LinkedInDojoRestrictionCleared,
  LinkedInDojoRestrictionClearedSchema,
  type LinkedInDojoRestrictionObserved,
  LinkedInDojoRestrictionObservedSchema,
} from "./schemas.ts";

export {
  linkedInDojoBehavior,
  LinkedInDojoInjector,
  type LinkedInDojoPluginState,
} from "./behavior.ts";

// Re-export types from LinkedIn plugin for convenience
export type { LinkedInAnchor } from "./schemas.ts";
export type { LinkedInAccount } from "../linkedin/account.ts";
export type { LinkedInBrowser } from "../linkedin/browser.ts";
export type { LinkedInContact } from "../linkedin/contact.ts";
export type { LinkedInInbox, LinkedInThread } from "../linkedin/views.ts";
