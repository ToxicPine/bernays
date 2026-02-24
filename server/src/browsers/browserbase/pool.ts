// src/browsers/browserbase/pool.ts
// Browserbase pool implementation - returns CDP URLs

import { Effect } from "effect";
import Browserbase from "@browserbasehq/sdk";
import type { BrowserConfigId as BrowserConfigIdType } from "$/core/branded.ts";
import type { ConfigStoreService } from "$/store/config-store.ts";
import {
  type BrowserError,
  browserError,
  type BrowserPoolService,
  type CdpSession,
} from "../mod.ts";
import { retry, type RetryOptions } from "@std/async";

// Internal Types

interface BrowserInstance {
  readonly configId: BrowserConfigIdType;
  readonly sessionId: string;
  readonly contextId: string;
  readonly projectId: string;
  readonly cdpUrl: string;
}

// Browserbase Pool Implementation

export const createBrowserbasePool = (
  apiKey: string,
  configStore: ConfigStoreService,
): BrowserPoolService => {
  const instances = new Map<string, BrowserInstance>();

  const getClient = (): Browserbase => new Browserbase({ apiKey });

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
          const client = getClient();
          const contextId = config.context;

          const ctx = await client.contexts.retrieve(contextId);
          const created = await client.sessions.create({
            projectId: ctx.projectId,
            browserSettings: {
              context: { id: contextId, persist: true },
            },
            keepAlive: true,
          });

          const live = await client.sessions.debug(created.id);

          const instance: BrowserInstance = {
            configId,
            sessionId: created.id,
            contextId,
            projectId: created.projectId,
            cdpUrl: live.wsUrl,
          };

          instances.set(configId, instance);

          return { configId, cdpUrl: live.wsUrl } satisfies CdpSession;
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

        const retryOptions: RetryOptions = {
          maxAttempts: 3,
          minTimeout: 1000,
          multiplier: 5,
        };

        const client = getClient();
        await retry(async () => {
          await client.sessions.update(instance.sessionId, {
            projectId: instance.projectId,
            status: "REQUEST_RELEASE",
          });
        }, retryOptions);

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
