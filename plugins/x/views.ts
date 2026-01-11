// src/platforms/x/views.ts
// X (Twitter) platform view types

import type { BaseInboxView } from "@bernays/server/views";
import type { BaseThreadView } from "@bernays/server/views";
import type { XAnchor } from "./schemas.ts";

// ============================================================================
// X Thread View
// ============================================================================

export interface XThread extends BaseThreadView<XAnchor> {
  readonly unreadCount: number;
}

// ============================================================================
// X Inbox View
// ============================================================================

export interface XIndexMeta {
  readonly lastActivity: string;
  readonly unreadCount: number;
}

export interface XInbox extends BaseInboxView<XIndexMeta> {
  readonly syncedAt: string;
}
