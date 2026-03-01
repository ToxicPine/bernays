// plugins/linkedin/views.ts
// LinkedIn-specific thread and inbox views per LINKEDIN_TESTING.md

import type { BaseInboxView, BaseThreadView } from "@bernays/server/views";
import type { LinkedInAnchor } from "./schemas.ts";

// =============================================================================
// LinkedIn Thread View
// =============================================================================

export interface LinkedInThread extends BaseThreadView<LinkedInAnchor> {
  readonly isSponsored: boolean;
  readonly unreadCount: number;
  readonly lastActivity: string;
}

// =============================================================================
// LinkedIn Inbox Index Metadata
// =============================================================================

export interface LinkedInIndexMeta {
  readonly lastActivity: string;
  readonly unreadCount: number;
  readonly isSponsored: boolean;
}

// =============================================================================
// LinkedIn Inbox View
// =============================================================================

export interface LinkedInInbox extends BaseInboxView<LinkedInIndexMeta> {
  readonly pendingInvitations: number;
  readonly weeklyInvitesRemaining: number;
  readonly syncedAt: string;
}
