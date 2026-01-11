// src/platforms/x/browser.ts
// X (Twitter) browser view types

import type { BaseBoundBrowser } from "@bernays/server/views";

// ============================================================================
// X Browser Types
// ============================================================================

export type XAuthStatus = "authenticated" | "expired" | "unknown";

export interface XBrowser extends BaseBoundBrowser {
  readonly authStatus: XAuthStatus;
  readonly suspended: boolean;
}
