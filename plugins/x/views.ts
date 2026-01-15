// src/platforms/x/views.ts
// X (Twitter) platform view types

import type { BaseInboxView } from "@bernays/server/views";
import type { BaseThreadView } from "@bernays/server/views";
import type { XAnchor } from "./schemas.ts";

// X Thread View

export interface XThread extends BaseThreadView<XAnchor> {
  readonly isArchived: boolean;
  readonly unreadCount: number;
  readonly lastActivity: string;
}

// X Inbox Index Metadata

export interface XIndexMeta {
  readonly lastActivity: string;
  readonly unreadCount: number;
  readonly participantCount: number;
}

// X Inbox View

export interface XInbox extends BaseInboxView<XIndexMeta> {
  readonly totalUnread: number;
  readonly syncedAt: string;
}
