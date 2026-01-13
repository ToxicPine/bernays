// src/backend/browserbase/mod.ts
// Browserbase backend factory

import type { ConfigStoreService } from "$/store/config-store.ts";
import type { BrowserBackend } from "../mod.ts";
import { createBrowserbasePool } from "./pool.ts";
import { createBrowserbaseExtensionStore } from "./extensions.ts";

// Browserbase Backend Factory

/**
 * Creates a Browserbase-backed browser backend.
 *
 * Usage:
 * ```typescript
 * const backend = makeBrowserbaseBackend(apiKey, configStore);
 * const layers = BrowserBackendLive(backend);
 * ```
 *
 * @param apiKey - Browserbase API key
 * @param configStore - Config store for browser configurations
 */
export const makeBrowserbaseBackend = (
  apiKey: string,
  configStore: ConfigStoreService,
): BrowserBackend => ({
  pool: createBrowserbasePool(apiKey, configStore),
  extensions: createBrowserbaseExtensionStore(apiKey),
});

export { createBrowserbasePool } from "./pool.ts";
export { createBrowserbaseExtensionStore } from "./extensions.ts";
