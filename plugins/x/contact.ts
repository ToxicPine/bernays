// plugins/x/contact.ts
// X contact view - derived from events

import type { BaseContact } from "@bernays/server/views";

/**
 * X contact info derived from events.
 *
 * Built from:
 * - TweetObserved events -> authorHandle, metrics
 * - FollowObserved events -> following relationships
 */
export interface XContact extends BaseContact<"x"> {
  readonly handle?: string;
  readonly verified?: boolean;
  readonly followerCount?: number;
  readonly following?: boolean;
  readonly lastInteraction?: string;
}
