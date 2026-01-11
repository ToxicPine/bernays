// packages/master/src/runtime/runtime.ts
// Main runtime coordinator (new architecture)

import { Context, Effect, Layer } from "effect";
import type { AccountId, Scope as ScopeType } from "$/core/branded.ts";
import type { EventStore, StorableEvent } from "$/store/mod.ts";
import type { BrowserPoolService } from "$/backend/mod.ts";
import type { BaseAccount } from "$/views/browser.ts";
import type { PlatformDefinition } from "$/platforms/mod.ts";
import type { Journal, Platform } from "./sockpuppet/services.ts";
import { makePlatformLayer } from "./sockpuppet/platform-runtime.ts";
import { makeJournalLayer } from "./sockpuppet/journal-runtime.ts";
import { runSockpuppet as runSockpuppetEffect } from "./sockpuppet/compose.ts";

// ============================================================================
// Runtime Configuration
// ============================================================================

export interface RuntimeConfig {
  readonly eventStore: EventStore<StorableEvent>;
  readonly browserPool: BrowserPoolService;
  readonly platforms: ReadonlyMap<
    ScopeType,
    PlatformDefinition<any, any, any, any, any, any, any, any>
  >;
  readonly accountLoader: (scope: ScopeType) => Promise<readonly BaseAccount[]>;
}

// ============================================================================
// Runtime Service Interface
// ============================================================================

/**
 * Runtime service interface.
 * Simplified coordinator that composes Platform and Journal layers.
 */
export interface RuntimeService {
  /** Start the runtime (no-op in new architecture, layers self-initialize) */
  readonly start: Effect.Effect<void>;

  /** Stop the runtime */
  readonly stop: Effect.Effect<void>;

  /** Get accounts for a scope */
  readonly getAccounts: (
    scope: ScopeType,
  ) => Effect.Effect<readonly BaseAccount[]>;

  /** Run a sockpuppet for a specific account */
  readonly runSockpuppet: <A, E>(
    scope: ScopeType,
    accountId: AccountId,
    sockpuppet: Effect.Effect<A, E, Platform | Journal>,
  ) => Effect.Effect<A>;
}

/** Tag for the Runtime service */
export class Runtime extends Context.Tag("automation/Runtime")<
  Runtime,
  RuntimeService
>() {}

// ============================================================================
// Runtime Implementation
// ============================================================================

/**
 * Create a Runtime service implementation from config.
 */
const makeRuntimeService = (config: RuntimeConfig): RuntimeService => {
  const { eventStore, browserPool, platforms, accountLoader } = config;

  return {
    start: Effect.void,

    stop: Effect.void,

    getAccounts: (scope) => Effect.promise(() => accountLoader(scope)),

    runSockpuppet: <A, E>(
      scope: ScopeType,
      accountId: AccountId,
      sockpuppet: Effect.Effect<A, E, Platform | Journal>,
    ) =>
      Effect.gen(function* () {
        // Find platform definition
        const platform = platforms.get(scope);
        if (!platform) {
          throw new Error(`Unknown scope: ${scope}`);
        }

        // Load accounts and find the target
        const accounts = yield* Effect.promise(() => accountLoader(scope));
        const account = accounts.find((a) => a.id === accountId);
        if (!account) {
          throw new Error(`Unknown account: ${accountId}`);
        }

        // Create Platform layer
        const platformLayer = makePlatformLayer({
          platform,
          account,
          eventStore,
          browserPool,
        });

        // Create Journal layer
        const journalLayer = makeJournalLayer({
          accountId,
          eventStore,
        });

        // Merge layers and run sockpuppet
        const layer = Layer.merge(platformLayer, journalLayer);
        return yield* Effect.promise(() =>
          runSockpuppetEffect(sockpuppet, layer)
        );
      }),
  };
};

/**
 * Create a Layer that provides the Runtime service.
 */
export const makeRuntimeLayer = (
  config: RuntimeConfig,
): Layer.Layer<Runtime> => Layer.succeed(Runtime, makeRuntimeService(config));
