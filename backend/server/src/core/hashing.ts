// packages/master/src/core/hashing.ts
// Deterministic ID generation using collision-resistant hashing.
// Canonical IDs are stable across platforms and restarts.

import { encodeBase64Url } from "@std/encoding/base64url";
import type { Scope } from "./branded.ts";

// Core Hash Function

/**
 * Generate a deterministic, URL-safe hash from parts.
 * Uses SHA-256 truncated to 22 characters (132 bits).
 *
 * Parts are joined with null bytes to prevent collision attacks
 * where "ab" + "c" would equal "a" + "bc".
 */
export const hash = async (...parts: string[]): Promise<string> => {
  const data = new TextEncoder().encode(parts.join("\0"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);

  const base64 = encodeBase64Url(bytes).replace(/=/g, "");

  return base64.slice(0, 22);
};

// Canonical Message ID

export interface MessageIdParams {
  readonly scope: Scope;
  readonly threadAnchor: string;
  readonly senderId: string;
  readonly contentHash: string;
  readonly timestamp: string;
}

/**
 * Generate a canonical message ID.
 * Two messages with identical params will produce the same ID.
 * This enables idempotent event processing - refreshing a page
 * re-observes the same messages but produces duplicate-safe IDs.
 */
export const messageId = (params: MessageIdParams): Promise<string> =>
  hash(
    "msg",
    params.scope,
    params.threadAnchor,
    params.senderId,
    params.contentHash,
    params.timestamp,
  );

// Canonical Thread ID

export interface ThreadIdParams {
  readonly scope: Scope;
  readonly anchor: string; // first message ID or platform conversation ID
}

/**
 * Generate a canonical thread ID.
 */
export const threadId = (params: ThreadIdParams): Promise<string> =>
  hash("thread", params.scope, params.anchor);

// Content Hash

/**
 * Hash message content for deduplication.
 * Normalizes whitespace before hashing.
 */
export const contentHash = async (content: string): Promise<string> => {
  const normalized = content.trim().replace(/\s+/g, " ");
  return hash("content", normalized);
};

// Action ID

/**
 * Generate a unique action ID for tracking action lifecycle.
 * Not deterministic - uses randomUUID for uniqueness.
 */
export const actionId = (): string => crypto.randomUUID();

// Event ID

/**
 * Generate a unique event ID.
 * Uses randomUUID for uniqueness.
 */
export const eventId = (): string => crypto.randomUUID();

// Correlation ID

/**
 * Generate a new correlation ID for tracking related events.
 * Uses randomUUID for uniqueness.
 */
export const correlationId = (): string => crypto.randomUUID();

// Dedupe Key

/**
 * Generate a dedupe key for intent idempotency.
 * Same params = same key = deduplicated.
 */
export const dedupeKey = async (
  scope: Scope,
  actionType: string,
  targetId: string,
): Promise<string> => hash("dedupe", scope, actionType, targetId);
