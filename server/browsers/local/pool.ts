// src/browsers/local/pool.ts
// Local browser pool - returns real CDP WebSocket URLs
//
// Launches chromium with --remote-debugging-port to expose actual CDP endpoints.
// Uses the headless_shell binary on NixOS (via PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH)
// which provides full CDP support and works reliably in headless mode.

import { Effect } from "effect";
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
  readonly executablePath?: string;
}

// =============================================================================
// Internal Types
// =============================================================================

interface BrowserInstance {
  readonly configId: BrowserConfigIdType;
  readonly process: Deno.ChildProcess;
  readonly cdpUrl: string;
}

// =============================================================================
// Local Pool Implementation
// =============================================================================

// Find an available port for CDP
const findAvailablePort = async (): Promise<number> => {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
};

// Wait for CDP to be ready and return the WebSocket URL
const waitForCdp = async (port: number, timeoutMs = 10000): Promise<string> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const json = await res.json() as { webSocketDebuggerUrl: string };
        return json.webSocketDebuggerUrl;
      }
    } catch {
      // CDP not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `CDP did not become ready on port ${port} within ${timeoutMs}ms`,
  );
};

/**
 * Creates a local browser pool that launches Chromium with real CDP endpoints.
 * Uses --remote-debugging-port to expose actual Chrome DevTools Protocol.
 *
 * @param configStore - Config store for browser configurations
 * @param options - Local pool options
 */
export const createLocalPool = (
  configStore: ConfigStoreService,
  options: LocalPoolOptions = {},
): BrowserPoolService => {
  const { headless = true, userDataDir, executablePath } = options;

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
          // Find an available port for CDP
          const port = await findAvailablePort();

          // Build command args
          const args: string[] = [
            `--remote-debugging-port=${port}`,
            "--no-first-run",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
          ];

          if (headless) {
            args.push("--headless");
          }

          // Configure proxy if specified
          if (config.proxy) {
            args.push(`--proxy-server=${config.proxy.server}`);
          }

          // Use config.context as user data dir for persistent profiles
          const effectiveUserDataDir = config.context || userDataDir;
          if (effectiveUserDataDir) {
            args.push(`--user-data-dir=${effectiveUserDataDir}`);
          }

          args.push("about:blank");

          // Resolve executable path: explicit option > env var
          // PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH is set by the nix devshell
          // (flake-parts/playwright.nix) to point at the nix-managed headless_shell.
          const resolvedExecutablePath = executablePath ??
            Deno.env.get("PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH");

          if (!resolvedExecutablePath) {
            throw new Error(
              "No executable path: set PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH or pass executablePath option",
            );
          }

          // Spawn the browser process
          const command = new Deno.Command(resolvedExecutablePath, {
            args,
            stdout: "null",
            stderr: "null",
          });
          const process = command.spawn();

          // Wait for CDP to be ready
          const cdpUrl = await waitForCdp(port);

          const instance: BrowserInstance = {
            configId,
            process,
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

        try {
          instance.process.kill("SIGTERM");
        } catch {
          // Process may already be dead
        }
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
