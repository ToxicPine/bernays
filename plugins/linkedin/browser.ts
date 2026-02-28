// plugins/linkedin/browser.ts
// LinkedIn browser view — discriminated union on authStatus per LINKEDIN_TESTING.md

import type { BaseBoundBrowser } from "@bernays/server/views";

// =============================================================================
// LinkedIn Browser — Discriminated Union
// =============================================================================

/**
 * Base fields shared across all auth states.
 * Restrictions are independent axes, not a single "rate limited" flag.
 */
export interface LinkedInBrowserBase extends BaseBoundBrowser {
  /** Active restrictions: restrictionType → retryAfter ISO timestamp */
  readonly restrictions: Readonly<Record<string, string>>;
  /** Weekly invites remaining (rolling 7-day window) */
  readonly weeklyInvitesRemaining: number | undefined;
}

/**
 * Discriminated union on `authStatus`.
 *
 * - `authenticated`: Valid session. `profileViewingMode` available.
 * - `challenged`: LinkedIn showing checkpoint page. `challengeType` available.
 * - `expired`: Session cookie absent.
 * - `unknown`: Initial state before auth check.
 */
export type LinkedInBrowser =
  | LinkedInBrowserBase & {
    readonly authStatus: "authenticated";
    readonly profileViewingMode: "full" | "anonymous" | "hidden";
  }
  | LinkedInBrowserBase & {
    readonly authStatus: "challenged";
    readonly challengeType:
      | "email"
      | "phone"
      | "mobile_app"
      | "authenticator"
      | "captcha"
      | "unknown";
  }
  | LinkedInBrowserBase & { readonly authStatus: "expired" }
  | LinkedInBrowserBase & { readonly authStatus: "unknown" };

/** Auth status string literal union */
export type LinkedInAuthStatus =
  | "authenticated"
  | "expired"
  | "challenged"
  | "unknown";

/** Challenge type string literal union */
export type LinkedInChallengeType =
  | "email"
  | "phone"
  | "mobile_app"
  | "authenticator"
  | "captcha"
  | "unknown";

/** Profile viewing mode string literal union */
export type LinkedInProfileViewingMode = "full" | "anonymous" | "hidden";
