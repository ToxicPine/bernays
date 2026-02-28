// plugins/linkedin/mod.ts
// LinkedIn platform definition and barrel exports

import type { PlatformDefinition } from "@bernays/server/platforms";
import { makeInjectionLayer } from "@bernays/server/projections";
import {
  makeProjectionLayer,
  makeProjectionTag,
} from "@bernays/server/projections";
import { LinkedInInjectionTag } from "./service.ts";

import {
  LINKEDIN_SCOPE,
  type LinkedInAnchor,
  LinkedInAnchorSchema,
  type LinkedInEvent,
  LinkedInEventSchema,
  type LinkedInScope,
} from "./schemas.ts";
import type { LinkedInInbox, LinkedInThread } from "./views.ts";
import type { LinkedInAccount } from "./account.ts";
import type { LinkedInBrowser } from "./browser.ts";
import type { LinkedInContact } from "./contact.ts";
import { linkedInBehavior, type LinkedInPluginState } from "./behavior.ts";

// =============================================================================
// Platform Definition
// =============================================================================

export const linkedInPlatform: PlatformDefinition<
  LinkedInScope,
  "linkedin",
  LinkedInEvent,
  LinkedInAnchor,
  LinkedInThread,
  LinkedInInbox,
  LinkedInAccount,
  LinkedInBrowser,
  LinkedInContact,
  LinkedInPluginState
> = {
  scope: LINKEDIN_SCOPE,
  identity: "linkedin",
  eventSchema: LinkedInEventSchema,
  anchorSchema: LinkedInAnchorSchema,
  behavior: linkedInBehavior,
};

// =============================================================================
// Injection / Projection Tags & Layers
// =============================================================================

export const LinkedInInjection = LinkedInInjectionTag;

export const LinkedInProjection = makeProjectionTag<LinkedInEvent>(
  "linkedin/Projection",
);

export const LinkedInInjectionLive = makeInjectionLayer(
  LinkedInInjection,
  LINKEDIN_SCOPE,
  LinkedInEventSchema,
);

export const LinkedInProjectionLive = makeProjectionLayer(
  LinkedInProjection,
  LINKEDIN_SCOPE,
  LinkedInEventSchema,
);

// =============================================================================
// Re-exports
// =============================================================================

// Scope
export { LINKEDIN_SCOPE, type LinkedInScope } from "./schemas.ts";

// Schemas (events)
export {
  type LinkedInAnchor,
  type LinkedInAnchorMessageObserved,
  LinkedInAnchorMessageObservedSchema,
  LinkedInAnchorSchema,
  type LinkedInAuthObserved,
  LinkedInAuthObservedSchema,
  type LinkedInConnectionAccepted,
  LinkedInConnectionAcceptedSchema,
  type LinkedInConnectionRejected,
  LinkedInConnectionRejectedSchema,
  type LinkedInConnectionRequestSent,
  LinkedInConnectionRequestSentSchema,
  type LinkedInConnectionStatusUnknown,
  LinkedInConnectionStatusUnknownSchema,
  type LinkedInConversationsSynced,
  LinkedInConversationsSyncedSchema,
  type LinkedInEvent,
  LinkedInEventSchema,
  type LinkedInInvitationWithdrawn,
  LinkedInInvitationWithdrawnSchema,
  type LinkedInMessageMutated,
  LinkedInMessageMutatedSchema,
  type LinkedInMessageObserved,
  LinkedInMessageObservedSchema,
  type LinkedInMessageRequestSent,
  LinkedInMessageRequestSentSchema,
  type LinkedInMessageSent,
  LinkedInMessageSentSchema,
  type LinkedInProfileViewed,
  LinkedInProfileViewedSchema,
  type LinkedInRestrictionCleared,
  LinkedInRestrictionClearedSchema,
  type LinkedInRestrictionObserved,
  LinkedInRestrictionObservedSchema,
  type LinkedInRestrictionType,
  LinkedInRestrictionTypeSchema,
  type LinkedInTwoFactorChallengeObserved,
  LinkedInTwoFactorChallengeObservedSchema,
  type LinkedInTwoFactorResultObserved,
  LinkedInTwoFactorResultObservedSchema,
  type LinkedInUserFollowed,
  LinkedInUserFollowedSchema,
} from "./schemas.ts";

// Views
export type {
  LinkedInInbox,
  LinkedInIndexMeta,
  LinkedInThread,
} from "./views.ts";

// Browser
export type {
  LinkedInAuthStatus,
  LinkedInBrowser,
  LinkedInBrowserBase,
  LinkedInChallengeType,
  LinkedInProfileViewingMode,
} from "./browser.ts";

// Contact
export type { LinkedInContact } from "./contact.ts";

// Account
export {
  createPostgresLinkedInAccountStore,
  type LinkedInAccount,
  LinkedInAccountStore,
  type LinkedInAccountStoreService,
  makeInMemoryLinkedInAccountStoreLayer,
  type PostgresLinkedInAccountStoreOptions,
} from "./account.ts";

// State
export { emptyLinkedInState, type LinkedInPluginState } from "./state.ts";
export type {
  BrowserStatusState,
  ContactState,
  InvitationState,
} from "./state.ts";

// Behavior
export { linkedInBehavior } from "./behavior.ts";

// Service (Platform Tag & Actions)
export {
  type BeginSignInResult,
  ConnectionErrorCode,
  type ConnectionRequestResult,
  FollowErrorCode,
  type FollowUserResult,
  type InvitationWithdrawnResult,
  type LinkedInActions,
  LinkedInPlatform,
  type LinkedInService,
  makeLinkedInActions,
  MessageRequestErrorCode,
  type MessageRequestSentResult,
  type MessageSentResult,
  ProfileErrorCode,
  type ProfileViewedResult,
  RestrictionErrorCode,
  type SendMessageError,
  SendMessageErrorCode,
  type SignInError,
  SignInErrorCode,
  TwoFactorErrorCode,
  type TwoFactorResult,
} from "./service.ts";

// Sync
export { makeLinkedInSync } from "./sync.ts";

// Infra (optional, for multi-account)
export {
  type CacheResourceSettings,
  defaultCacheSettings,
  type EnsureTarget,
  type LinkedInCacheSettings,
  LinkedInInfra,
  type LinkedInInfraService,
  type LinkedInPublicState,
  type WatchTopic,
} from "./infra.ts";
