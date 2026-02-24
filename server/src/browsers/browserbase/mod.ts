// src/browsers/browserbase/mod.ts
// Browserbase browser pool factory

import type { ConfigStoreService } from "$/store/config-store.ts";
import type { BrowserPoolService } from "../mod.ts";
import { createBrowserbasePool } from "./pool.ts";

// Browserbase Backend Factory

/**
 * Creates a Browserbase-backed browser pool.
 *
 * Usage:
 * ```typescript
 * const pool = makeBrowserbaseBackend(apiKey, configStore);
 * const layers = BrowserPoolLive(pool);
 * ```
 *
 * @param apiKey - Browserbase API key
 * @param configStore - Config store for browser configurations
 */
export const makeBrowserbaseBackend = (
  apiKey: string,
  configStore: ConfigStoreService,
): BrowserPoolService => createBrowserbasePool(apiKey, configStore);

export { createBrowserbasePool } from "./pool.ts";
