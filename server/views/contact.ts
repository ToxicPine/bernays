// src/views/contact.ts
// Base contact view types for platform-specific extension

import type { ParticipantId } from "$/core/mod.ts";

/**
 * Base contact interface - extensible by platforms.
 * Represents the minimal information about a participant.
 *
 * Platforms extend this with platform-specific fields:
 * - LinkedIn: headline, profileUrl, connectionDegree, lastInteraction
 * - X: handle, followerCount, verified, following, lastInteraction
 * - Reddit: username, karma, accountAge, lastInteraction
 *
 * @template TScope - The identity scope (e.g., "linkedin")
 */
export interface BaseContact<TScope extends string = string> {
  readonly id: ParticipantId<TScope>;
  readonly name?: string;
}
