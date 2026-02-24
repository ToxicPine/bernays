// src/browsers/local/pool.ts
// Local Playwright pool implementation - returns CDP URLs

import { Effect } from "effect";
import {
  type BrowserServer,
  chromium,
} from "playwright";
import type { BrowserConfigId as BrowserConfigIdType } from "$/core/branded.ts";
import type { ConfigStoreService } from "$/store/config-store.ts";
import {
  type BrowserError,
  browserError,
  type BrowserPoolService,
  type CdpSession,
} from "../mod.ts";

// =============================================================================
// Configuration
// =============================================================================

export interface LocalPoolOptions {
  readonly headless?: boolean;
  readonly userDataDir?: string;
}

// =============================================================================
// Internal Types
// =============================================================================

interface BrowserInstance {
  readonly configId: BrowserConfigIdType;
  readonly server: BrowserServer;
  readonly cdpUrl: string;
}

// =============================================================================
// Local Pool Implementation
// =============================================================================

/**
 * Creates a local Playwright-backed browser pool.
 * Launches Chromium and exposes the CDP WebSocket URL.
 *
 * @param configStore - Config store for browser configurations
 * @param options - Local pool options
 */
export const createLocalPool = (
  configStore: ConfigStoreService,
  options: LocalPoolOptions = {},
): BrowserPoolService => {
  const { headless = true, userDataDir } = options;

  const instances = new Map<string, BrowserInstance>();

  const launch = (
    configId: BrowserConfigIdType,
  ): Effect.Effect<CdpSession, BrowserError> =>
    Effect.gen(function* () {
      // Return existing session if already running
      const existing = instances.get(configId);
      if (existing) {
        return { configId, cdpUrl: existing.cdpUrl };
      }

      const configOpt = yield* configStore.get(configId).pipe(
        Effect.mapError((err) =>
          browserError("NotFound", `Config store error: ${err.message}`, err)
        ),
      );
      if (configOpt._tag === "None") {
        return yield* Effect.fail(
          browserError("NotFound", `Config not found: ${configId}`),
        );
      }
      const config = configOpt.value;

      return yield* Effect.tryPromise({
        try: async () => {
          const args: string[] = [];

          // Configure proxy if specified
          if (config.proxy) {
            args.push(`--proxy-server=${config.proxy.server}`);
          }

          // Use config.context as user data dir for persistent profiles
          const effectiveUserDataDir = config.context || userDataDir;
          if (effectiveUserDataDir) {
            args.push(`--user-data-dir=${effectiveUserDataDir}`);
          }

          const server = await chromium.launchServer({
            headless,
            args,
          });

          // Extract the CDP WebSocket endpoint
          const cdpUrl = server.wsEndpoint();

          const instance: BrowserInstance = {
            configId,
            server,
            cdpUrl,
          };

          instances.set(configId, instance);

          return { configId, cdpUrl } satisfies CdpSession;
        },
        catch: (err) =>
          browserError(
            "LaunchFailed",
            err instanceof Error ? err.message : String(err),
            err,
          ),
      });
    });

  const stop = (
    configId: BrowserConfigIdType,
  ): Effect.Effect<void, BrowserError> =>
    Effect.tryPromise({
      try: async () => {
        const instance = instances.get(configId);
        if (!instance) return;

        await instance.server.close().catch(() => {});
        instances.delete(configId);
      },
      catch: (err) =>
        browserError(
          "StopFailed",
          err instanceof Error ? err.message : String(err),
          err,
        ),
    });

  const isRunning = (
    configId: BrowserConfigIdType,
  ): Effect.Effect<boolean> => Effect.sync(() => instances.has(configId));

  const getSession = (
    configId: BrowserConfigIdType,
  ): Effect.Effect<CdpSession, BrowserError> =>
    Effect.sync(() => instances.get(configId)).pipe(
      Effect.flatMap((instance) =>
        instance
          ? Effect.succeed({ configId, cdpUrl: instance.cdpUrl })
          : Effect.fail(
            browserError("NotRunning", `Browser not running: ${configId}`),
          )
      ),
    );

  return { launch, stop, isRunning, getSession };
};

/**
 * Extended pool service with test utilities.
 */
export interface LocalPoolService extends BrowserPoolService {}

/**
 * Creates a local pool with test utilities exposed.
 */
export const createLocalPoolWithTestUtils = (
  configStore: ConfigStoreService,
  options: LocalPoolOptions = {},
): LocalPoolService => createLocalPool(configStore, options);
