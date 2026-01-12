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
  type LinkedInIntent,
  LinkedInIntentSchema,
  type LinkedInScope,
} from "./schemas.ts";

// Views
import type { LinkedInInbox, LinkedInThread } from "./views.ts";

// Account & Browser
import type { LinkedInAccount } from "./account.ts";
import type { LinkedInBrowser } from "./browser.ts";

// Behavior
import { linkedInBehavior } from "./behavior.ts";

// ============================================================================
// Platform Definition
// ============================================================================

export const linkedInPlatform: PlatformDefinition<
  LinkedInScope,
  LinkedInEvent,
  LinkedInIntent,
  LinkedInAnchor,
  LinkedInThread,
  LinkedInInbox,
  LinkedInAccount,
  LinkedInBrowser
> = {
  scope: LINKEDIN_SCOPE,
  eventSchema: LinkedInEventSchema,
  intentSchema: LinkedInIntentSchema,
  anchorSchema: LinkedInAnchorSchema,
  behavior: linkedInBehavior,
};

// ============================================================================
// Re-exports
// ============================================================================

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
  type LinkedInUserFollowed,
  LinkedInUserFollowedSchema,
} from "./schemas.ts";

// Schemas (intents)
export {
  type LinkedInAcceptInvitation,
  LinkedInAcceptInvitationSchema,
  type LinkedInConnect,
  LinkedInConnectSchema,
  type LinkedInFollow,
  LinkedInFollowSchema,
  type LinkedInIntent,
  LinkedInIntentSchema,
  type LinkedInPeopleSearch,
  LinkedInPeopleSearchSchema,
  type LinkedInRecallMessage,
  LinkedInRecallMessageSchema,
  type LinkedInRejectInvitation,
  LinkedInRejectInvitationSchema,
  type LinkedInSearchCompanies,
  LinkedInSearchCompaniesSchema,
  type LinkedInSendMessage,
  LinkedInSendMessageSchema,
  type LinkedInSyncConversations,
  LinkedInSyncConversationsSchema,
  type LinkedInViewProfile,
  LinkedInViewProfileSchema,
  type LinkedInWithdrawInvitation,
  LinkedInWithdrawInvitationSchema,
} from "./schemas.ts";

// Views
export type {
  LinkedInInbox,
  LinkedInIndexMeta,
  LinkedInThread,
} from "./views.ts";

// Browser
export type { LinkedInAuthStatus, LinkedInBrowser } from "./browser.ts";

// Account
export {
  createPostgresLinkedInAccountStore,
  type LinkedInAccount,
  LinkedInAccountStore,
  type LinkedInAccountStoreService,
  makeInMemoryLinkedInAccountStoreLayer,
} from "./account.ts";

// Behavior
export { linkedInBehavior } from "./behavior.ts";
