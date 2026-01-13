// src/backend/types.ts
// Backend types for browser pool and extension store

import { z } from "@zod/zod";
import type { BrowserConfigId, ExtensionId } from "$/core/branded.ts";

// Bridge Error

export const BridgeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type BridgeError = z.infer<typeof BridgeErrorSchema>;

// Bridge Message (for parsing incoming messages from extensions)

export const BridgeMessageSchema = z.object({
  v: z.literal(1),
  type: z.enum(["request", "response", "event"]),
  requestId: z.string().optional(),
  correlationId: z.string().optional(),
  payload: z.unknown().optional(),
  error: BridgeErrorSchema.optional(),
});

export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;

// Bridge Event

/**
 * Event emitted by browser extensions.
 * Uses scope + type for unified event routing (same as stored events).
 */
export interface BridgeEvent {
  readonly scope: string;
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * Bridge event tagged with the originating browser config.
 * This is what EventIngestion consumes from the pool's event stream.
 */
export interface TaggedBridgeEvent {
  readonly configId: BrowserConfigId;
  readonly event: BridgeEvent;
}

// Browser Error

export type BrowserErrorCode =
  | "NotFound"
  | "LaunchFailed"
  | "NotRunning"
  | "SendFailed"
  | "StopFailed"
  | "ConnectionLost";

export interface BrowserError {
  readonly _tag: "BrowserError";
  readonly code: BrowserErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const browserError = (
  code: BrowserErrorCode,
  message: string,
  cause?: unknown,
): BrowserError => ({ _tag: "BrowserError", code, message, cause });

// Extension Metadata

/**
 * Metadata about a registered extension.
 * Used for admin workflows (querying/uploading extensions).
 */
export interface ExtensionMeta {
  readonly id: ExtensionId;
  readonly name: string;
  readonly version: string;
  readonly uri: string; // Where to load from (local path, URL, etc.)
}

// Browser Config

/**
 * Browser configuration - how to connect to a persistent browser session.
 * Stored in ConfigStore and used by BrowserPool to launch browsers.
 */
export interface BrowserConfig {
  readonly id: BrowserConfigId;
  readonly context: string; // Browserbase context ID or local profile
  readonly extensionIds: readonly ExtensionId[];
  readonly proxy?: ProxyConfig;
}

export interface ProxyConfig {
  readonly server: string;
  readonly username?: string;
  readonly password?: string;
}
