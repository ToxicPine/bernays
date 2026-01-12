// src/platforms/reddit/browser.ts
// Reddit-specific browser view

import type { BaseBoundBrowser } from "@bernays/server/views";

// ============================================================================
// Auth Status
// ============================================================================

export type RedditAuthStatus = "authenticated" | "expired" | "unknown";

// ============================================================================
// Reddit Browser
// ============================================================================

/**
 * Reddit-specific browser view.
 * Extends BaseBoundBrowser with Reddit-specific status fields.
 *
 * The behavior's `deriveBrowsers` function produces these from events:
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
