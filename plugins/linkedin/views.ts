// src/platforms/linkedin/views.ts
// LinkedIn-specific thread and inbox views

import type { BaseInboxView } from "@bernays/server/views";
import type { BaseThreadView } from "@bernays/server/views";
import type { LinkedInAnchor } from "./schemas.ts";

// LinkedIn Thread View

export interface LinkedInThread extends BaseThreadView<LinkedInAnchor> {
  readonly unreadCount: number;
  readonly isSponsored: boolean;
  readonly lastActivity: string;
}

// LinkedIn Inbox Index Metadata

export interface LinkedInIndexMeta {
  readonly lastActivity: string;
  readonly unreadCount: number;
  readonly isSponsored: boolean;
}

// LinkedIn Inbox View

export interface LinkedInInbox extends BaseInboxView<LinkedInIndexMeta> {
  readonly syncedAt: string;
  readonly pendingInvitations: number;
  readonly weeklyInvitesRemaining: number;
}
