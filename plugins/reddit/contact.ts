// plugins/reddit/contact.ts
// Reddit contact view - derived from events

import type { BaseContact } from "@bernays/server/views";

/**
 * Reddit contact info derived from events.
 *
 * Built from:
 * - UserDiscovered events -> username, karma, accountAge
 * - Message anchors -> participant info
 */
export interface RedditContact extends BaseContact<"reddit"> {
  readonly username?: string;
  readonly karma?: number;
  readonly accountAge?: string;
  readonly lastInteraction?: string;
}
