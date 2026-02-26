// src/browsers/mod.ts
// Browser pool - CDP session management

import { Context, Effect, Layer } from "effect";
import type { BrowserConfigId } from "$/core/branded.ts";
import type { BrowserError, CdpSession } from "./types.ts";

// Re-exports

export * from "./types.ts";

// Browser Pool Service

/**
 * Manages browser lifecycle. Launches browsers and returns CDP URLs.
 * Platforms connect to the CDP endpoint themselves using whatever
 * framework they prefer (Playwright, Puppeteer, raw CDP, etc.).
 */
export interface BrowserPoolService {
  /** Launch a browser and return a CDP session with the WebSocket URL */
  readonly launch: (
    configId: BrowserConfigId,
  ) => Effect.Effect<CdpSession, BrowserError>;

  /** Stop a running browser */
  readonly stop: (
    configId: BrowserConfigId,
  ) => Effect.Effect<void, BrowserError>;

  /** Check if a browser is running */
  readonly isRunning: (
    configId: BrowserConfigId,
  ) => Effect.Effect<boolean>;

  /** Get the CDP session for a running browser */
  readonly getSession: (
    configId: BrowserConfigId,
  ) => Effect.Effect<CdpSession, BrowserError>;
}

export class BrowserPool extends Context.Tag("BrowserPool")<
  BrowserPool,
  BrowserPoolService
>() {}

/**
 * Creates a Layer that provides BrowserPool from a BrowserPoolService.
 */
export const BrowserPoolLive = (
  pool: BrowserPoolService,
): Layer.Layer<BrowserPool> => Layer.succeed(BrowserPool, pool);

// Backend Implementations

export { makeBrowserbaseBackend } from "./browserbase/mod.ts";
export {
  makeLocalBackend,
  makeLocalBackendWithTestUtils,
} from "./local/mod.ts";
export type {
  LocalBackendOptions,
  LocalBackendWithTestUtils,
} from "./local/mod.ts";
