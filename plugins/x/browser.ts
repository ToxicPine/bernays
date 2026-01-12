// src/platforms/x/browser.ts
// X (Twitter) browser view types

import type { BaseBoundBrowser } from "@bernays/server/views";

// ============================================================================
// Auth Status
// ============================================================================

export type XAuthStatus = "authenticated" | "expired" | "unknown";

// ============================================================================
// X Browser
// ============================================================================

/**
 * X-specific browser view.
 * Extends BaseBoundBrowser with X-specific status fields.
 *
 * The behavior's `deriveBrowsers` function produces these from events:
 * - Auth events determine authStatus
 * - Auth events with issue field determine suspended status
 * - Rate limit events determine rateLimitedUntil
 * - Auth events determine canRead/canWrite permissions
 */
export interface XBrowser extends BaseBoundBrowser {
  readonly authStatus: XAuthStatus;
  readonly suspended: boolean;
  readonly rateLimitedUntil: string | undefined;
  readonly canRead: boolean;
  readonly canWrite: boolean;
}
