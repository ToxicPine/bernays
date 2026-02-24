// src/platforms/linkedin/mod.ts
// LinkedIn platform definition

import type { PlatformDefinition } from "@bernays/server/platforms";

// Schemas
import {
  LINKEDIN_SCOPE,
  type LinkedInAnchor,
  LinkedInAnchorSchema,
  type LinkedInEvent,
  LinkedInEventSchema,
  type LinkedInScope,
} from "./schemas.ts";

// Views
import type { LinkedInInbox, LinkedInThread } from "./views.ts";

// Account & Browser
import type { LinkedInAccount } from "./account.ts";
import type { LinkedInBrowser } from "./browser.ts";
import type { LinkedInContact } from "./contact.ts";

// Behavior
import { linkedInBehavior } from "./behavior.ts";

export const linkedInPlatform: PlatformDefinition<
  LinkedInScope,
  "linkedin",
  LinkedInEvent,
  LinkedInAnchor,
  LinkedInThread,
  LinkedInInbox,
  LinkedInAccount,
  LinkedInBrowser,
  LinkedInContact
> = {
  scope: LINKEDIN_SCOPE,
  identity: "linkedin",
  eventSchema: LinkedInEventSchema,
  anchorSchema: LinkedInAnchorSchema,
  behavior: linkedInBehavior,
};

// Scope
export { LINKEDIN_SCOPE } from "./schemas.ts";

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
  type LinkedInMessageSent,
  LinkedInMessageSentSchema,
  type LinkedInProfileViewed,
  LinkedInProfileViewedSchema,
  type LinkedInRateLimitObserved,
  LinkedInRateLimitObservedSchema,
  type LinkedInSearchResultsRetrieved,
  LinkedInSearchResultsRetrievedSchema,
  type LinkedInTwoFactorChallenge,
  LinkedInTwoFactorChallengeSchema,
  type LinkedInTwoFactorResult,
  LinkedInTwoFactorResultSchema,
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
export type { LinkedInBrowser } from "./browser.ts";

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

// Behavior
export { linkedInBehavior } from "./behavior.ts";

// Service (Platform Tag & Actions)
export {
  // Result schemas and types
  type BeginSignInResult,
  BeginSignInResultSchema,
  ConnectionErrorCode,
  type ConnectionRequestResult,
  type InvitationWithdrawnResult,
  type LinkedInActions,
  LinkedInPlatform,
  type LinkedInService,
  makeLinkedInActions,
  type MessageSentResult,
  ProfileErrorCode,
  type ProfileViewedResult,
  SendMessageErrorCode,
  type SignInError,
  SignInErrorCode,
  SyncErrorCode,
  type SyncResult,
  type TwoFactorError,
  TwoFactorErrorCode,
  type TwoFactorResult,
  TwoFactorResultSchema,
} from "./service.ts";
