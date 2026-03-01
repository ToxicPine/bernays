// plugins/linkedin/contact.ts
// LinkedIn contact view — full fields per LINKEDIN_TESTING.md

import type { BaseContact } from "@bernays/server/views";

// =============================================================================
// LinkedIn Contact
// =============================================================================

/**
 * LinkedIn contact info derived from events.
 *
 * Fields split into public (same for all accounts) and per-account
 * (depends on relationship between this account and the contact).
 *
 * In single-account mode, all fields populated by per-sockpuppet sync fiber.
 * In multi-account mode, public fields come from shared observer.
 */
export interface LinkedInContact extends BaseContact<"linkedin"> {
  // ── Public fields (shared across accounts) ──────────────────────
  readonly publicIdentifier?: string;
  readonly memberId?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly headline?: string;
  readonly occupation?: string;
  readonly company?: { readonly name: string; readonly logoUrl?: string };
  readonly profilePictureUrl?: string;
  readonly profileUrl?: string;
  readonly isOpenProfile?: boolean;
  readonly isPremium?: boolean;
  readonly isJobSeeker?: boolean;

  // ── Per-account fields (relationship-specific) ──────────────────
  readonly connectionDegree?: "self" | "1st" | "2nd" | "3rd" | "out";
  readonly sharedGroups?: readonly string[];
  readonly sharedEvents?: readonly string[];
  readonly lastInteraction?: string;
  readonly hasReplied?: boolean;
  readonly lastReplyAt?: string;
}
