// src/backend/local/mod.ts
// Local Playwright backend factory

import type { ConfigStoreService } from "$/store/config-store.ts";
import type { BrowserBackend } from "../mod.ts";
import type { ExtensionMeta } from "../types.ts";
import {
  createLocalPool,
  createLocalPoolWithTestUtils,
  type LocalPoolOptions,
  type LocalPoolService,
} from "./pool.ts";
import {
  createInMemoryExtensionStore,
  createLocalExtensionStore,
  type LocalExtensionStoreOptions,
} from "./extensions.ts";

// =============================================================================
// Configuration
// =============================================================================

export interface LocalBackendOptions {
  readonly pool?: LocalPoolOptions;
  readonly extensions?: LocalExtensionStoreOptions;
}

// =============================================================================
// Local Backend Factory
// =============================================================================

/**
 * Creates a local Playwright-backed browser backend.
 * Useful for testing without Browserbase.
 *
 * Usage:
 * ```typescript
 * const backend = makeLocalBackend(configStore, {
 *   pool: {
 *     extensionPath: "./dist/extension",
 *     headless: false,
 *   },
 * });
 * const layers = BrowserBackendLive(backend);
 * ```
 *
 * @param configStore - Config store for browser configurations
 * @param options - Local backend options
 */
export const makeLocalBackend = (
  configStore: ConfigStoreService,
  options: LocalBackendOptions = {},
): BrowserBackend => ({
  pool: createLocalPool(configStore, options.pool),
  extensions: createLocalExtensionStore(options.extensions),
});

/**
 * Extended local backend with test utilities.
 */
export interface LocalBackendWithTestUtils extends BrowserBackend {
  readonly pool: LocalPoolService;
}

/**
 * Creates a local backend with test utilities exposed.
 * The pool has an additional `getPage()` method for direct Playwright access.
 *
 * Usage:
 * ```typescript
 * const backend = makeLocalBackendWithTestUtils(configStore, options);
 *
 * // Launch browser
 * await Effect.runPromise(backend.pool.launch(configId));
 *
 * // Get Playwright page for direct manipulation
 * const page = backend.pool.getPage(configId);
 * await page?.goto("https://example.com");
 * await page?.fill("#username", "test@example.com");
 * ```
 *
 * @param configStore - Config store for browser configurations
 * @param options - Local backend options
 */
export const makeLocalBackendWithTestUtils = (
  configStore: ConfigStoreService,
  options: LocalBackendOptions = {},
): LocalBackendWithTestUtils => ({
  pool: createLocalPoolWithTestUtils(configStore, options.pool),
  extensions: createLocalExtensionStore(options.extensions),
});

/**
 * Creates a minimal local backend with in-memory extension store.
 * Useful for unit tests that don't need filesystem access.
 *
 * @param configStore - Config store for browser configurations
 * @param options - Pool options
 * @param extensions - Initial extension metadata (optional)
 */
export const makeMinimalLocalBackend = (
  configStore: ConfigStoreService,
  options: LocalPoolOptions = {},
  extensions: readonly ExtensionMeta[] = [],
): BrowserBackend => ({
  pool: createLocalPool(configStore, options),
  extensions: createInMemoryExtensionStore(extensions),
});

export { createLocalPool, createLocalPoolWithTestUtils } from "./pool.ts";
export type { LocalPoolOptions, LocalPoolService } from "./pool.ts";
export {
  createInMemoryExtensionStore,
  createLocalExtensionStore,
} from "./extensions.ts";
export type { LocalExtensionStoreOptions } from "./extensions.ts";
