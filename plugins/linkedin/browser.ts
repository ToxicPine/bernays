// src/platforms/linkedin/browser.ts
// LinkedIn-specific browser view

import type { BaseBoundBrowser } from "@bernays/server/views";

// LinkedIn Auth Status

/**
 * LinkedIn-specific authentication status.
 * - "authenticated": Valid LinkedIn session
 * - "expired": Session cookie expired or invalidated
 * - "unknown": Initial state before auth check
 */
export type LinkedInAuthStatus = "authenticated" | "expired" | "unknown";

// LinkedIn Browser

/**
 * LinkedIn-specific browser view.
 * Extends BaseBoundBrowser with LinkedIn-specific status fields.
 *
 * The behavior's `deriveBrowsers` function produces these from events:
 * - Auth events determine authStatus
 * - Rate limit events determine rateLimitedUntil
 * - Invite tracking events determine weeklyInvitesRemaining
 */
export interface LinkedInBrowser extends BaseBoundBrowser {
  readonly authStatus: LinkedInAuthStatus;
  readonly rateLimitedUntil: string | undefined;
  readonly weeklyInvitesRemaining: number | undefined;
}
