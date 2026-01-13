// src/platforms/reddit/views.ts
// Reddit-specific thread and inbox views

import type { BaseInboxView } from "@bernays/server/views";
import type { BaseThreadView } from "@bernays/server/views";
import type { RedditAnchor } from "./schemas.ts";

// Reddit Thread View

export interface RedditThread extends BaseThreadView<RedditAnchor> {
  readonly unreadCount: number;
  readonly lastActivity: string;
  readonly isGroupChat: boolean;
}

// Reddit Inbox Index Metadata

export interface RedditIndexMeta {
  readonly lastActivity: string;
  readonly unreadCount: number;
  readonly participantCount: number;
}

// Reddit Inbox View

export interface RedditInbox extends BaseInboxView<RedditIndexMeta> {
  readonly syncedAt: string;
  readonly unreadTotal: number;
}
