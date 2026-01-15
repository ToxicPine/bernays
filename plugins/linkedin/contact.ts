// plugins/linkedin/contact.ts
// LinkedIn contact view - derived from events

import type { BaseContact } from "@bernays/server/views";

/**
 * LinkedIn contact info derived from events.
 *
 * Built from:
 * - ProfileViewed events -> profileUrl
 * - SearchResultsRetrieved events -> name, headline
 * - Message anchors -> participant names
 * - ConnectionRequestSent/Accepted -> connection tracking
 */
export interface LinkedInContact extends BaseContact<"linkedin"> {
  readonly headline?: string;
  readonly profileUrl?: string;
  readonly connectionDegree?: "1st" | "2nd" | "3rd" | "out";
  readonly lastInteraction?: string;
}
