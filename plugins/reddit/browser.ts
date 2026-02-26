// src/platforms/reddit/browser.ts
// Reddit-specific browser view

import type { BaseBoundBrowser } from "@bernays/server/views";

// Reddit Auth Status

/**
 * Reddit-specific authentication status.
 * - "authenticated": Valid Reddit session
 * - "shadowbanned": Account exists but content hidden
 * - "expired": Session expired or logged out
 * - "unknown": Initial state before auth check
 */
export type RedditAuthStatus =
  | "authenticated"
  | "shadowbanned"
  | "expired"
  | "unknown";

// Reddit Browser

/**
 * Reddit-specific browser view.
 * Extends BaseBoundBrowser with Reddit-specific status fields.
 *
 * The behavior's `materializeBrowsers` function produces these from state:
 * - Auth events determine authStatus
 * - Ban events determine isBanned
 * - Rate limit events determine rateLimitedUntil
 */
export interface RedditBrowser extends BaseBoundBrowser {
  readonly authStatus: RedditAuthStatus;
  readonly isBanned: boolean;
  readonly bannedReason: string | undefined;
  readonly rateLimitedUntil: string | undefined;
}
