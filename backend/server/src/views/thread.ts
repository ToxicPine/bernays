// src/views/thread.ts
// Base thread view types for platform-specific extension

import type { CanonicalId, ThreadId } from "$/core/branded.ts";

// Participant

export interface Participant {
  readonly id: string;
  readonly name?: string;
}

// Message View

export interface MessageView {
  readonly id: CanonicalId;
  readonly senderId: string;
  readonly content?: string;
  readonly timestamp: string;
}

// Base Thread View

/**
 * Base thread view - extensible by platforms.
 * Generic over TAnchor to allow platform-specific anchor shapes.
 *
 * Platforms extend this with platform-specific thread metadata:
 * - LinkedIn: unreadCount, isSponsored
 * - X: isArchived, etc.
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
  ownerId: string,
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
