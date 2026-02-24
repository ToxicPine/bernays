// src/browsers/types.ts
// Browser pool types

import type { BrowserConfigId } from "$/core/branded.ts";

// Browser Error

export type BrowserErrorCode =
  | "NotFound"
  | "LaunchFailed"
  | "NotRunning"
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

// Browser Config

/**
 * Browser configuration - how to connect to a persistent browser session.
 * Stored in ConfigStore and used by BrowserPool to launch browsers.
 */
export interface BrowserConfig {
  readonly id: BrowserConfigId;
  readonly context: string; // Browserbase context ID or local profile
  readonly proxy?: ProxyConfig;
}

export interface ProxyConfig {
  readonly server: string;
  readonly username?: string;
  readonly password?: string;
}

// CDP Session

/**
 * A live CDP session returned by BrowserPool.launch().
 * Platforms use the cdpUrl to connect with whatever CDP client they prefer.
 */
export interface CdpSession {
  readonly configId: BrowserConfigId;
  readonly cdpUrl: string;
}
