// src/views/thread.ts
// Base thread view types for platform-specific extension

import type { CanonicalId, ParticipantId, ThreadId } from "$/core/mod.ts";

// Participant

/**
 * A participant in a thread.
 * @template TScope - The identity scope (e.g., "linkedin")
 */
export interface Participant<TScope extends string = string> {
  readonly id: ParticipantId<TScope>;
  readonly name?: string;
}

// Message View

/**
 * A message in a thread.
 * @template TScope - The identity scope (e.g., "linkedin")
 */
export interface MessageView<TScope extends string = string> {
  readonly id: CanonicalId;
  readonly senderId: ParticipantId<TScope>;
  readonly content?: string;
  readonly timestamp: string;
}

// Base Thread View

/**
 * Base thread view - extensible by platforms.
 * Generic over TAnchor to allow platform-specific anchor shapes.
 *
 * Platforms extend this with platform-specific thread metadata:
 * - LinkedIn: isSponsored
 * - X: isArchived
 * - Reddit: isGroupChat
 */
export interface BaseThreadView<TAnchor> {
  readonly threadId: ThreadId;
  readonly messages: readonly MessageView[];
  readonly participants: readonly Participant[];
  readonly anchor: TAnchor;
}

// Helper Functions

/**
 * Calculate unread count from messages.
 * Unread = messages after last own message that aren't own.
 */
export const calculateUnreadCount = (
  messages: readonly MessageView[],
  ownerId: ParticipantId,
): number => {
  let lastOwnIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].senderId === ownerId) {
      lastOwnIndex = i;
      break;
    }
  }

  if (lastOwnIndex >= 0) {
    let count = 0;
    for (let i = lastOwnIndex + 1; i < messages.length; i++) {
      if (messages[i].senderId !== ownerId) count++;
    }
    return count;
  }

  return messages.filter((m) => m.senderId !== ownerId).length;
};
