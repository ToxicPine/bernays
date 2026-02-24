// src/browsers/local/mod.ts
// Local Playwright browser pool factory

import type { ConfigStoreService } from "$/store/config-store.ts";
import type { BrowserPoolService } from "../mod.ts";
import {
  createLocalPool,
  createLocalPoolWithTestUtils,
  type LocalPoolOptions,
  type LocalPoolService,
} from "./pool.ts";

// =============================================================================
// Configuration
// =============================================================================

export interface LocalBackendOptions {
  readonly pool?: LocalPoolOptions;
}

// =============================================================================
// Local Backend Factory
// =============================================================================

/**
 * Creates a local Playwright-backed browser pool.
 * Useful for testing without Browserbase.
 *
 * @param configStore - Config store for browser configurations
 * @param options - Local backend options
 */
export const makeLocalBackend = (
  configStore: ConfigStoreService,
  options: LocalBackendOptions = {},
): BrowserPoolService => createLocalPool(configStore, options.pool);

/**
 * Extended local backend with test utilities.
 */
export interface LocalBackendWithTestUtils {
  readonly pool: LocalPoolService;
}

/**
 * Creates a local backend with test utilities exposed.
 */
export const makeLocalBackendWithTestUtils = (
  configStore: ConfigStoreService,
  options: LocalBackendOptions = {},
): LocalBackendWithTestUtils => ({
  pool: createLocalPoolWithTestUtils(configStore, options.pool),
});

export { createLocalPool, createLocalPoolWithTestUtils } from "./pool.ts";
export type { LocalPoolOptions, LocalPoolService } from "./pool.ts";
