// packages/master/src/runtime/runtime.ts
// Main runtime coordinator

import { Context, Effect, Layer } from "effect";
import type { Scope as ScopeType } from "$/core/branded.ts";
import type { BrowserPoolService } from "$/browsers/mod.ts";
import type { BaseAccount } from "$/views/browser.ts";
import type { PlatformDefinition } from "$/platforms/mod.ts";

// =============================================================================
// Runtime Configuration
// =============================================================================

export interface RuntimeConfig {
  readonly browserPool: BrowserPoolService;
  readonly platforms: ReadonlyMap<
    ScopeType,
    PlatformDefinition<any, any, any, any, any, any, any, any, any>
  >;
  readonly accountLoader: (
    scope: ScopeType,
  ) => Promise<readonly BaseAccount<string>[]>;
}

// =============================================================================
// Runtime Service Interface
// =============================================================================

/**
 * Runtime service interface.
 * Provides access to platform definitions and account loading.
 *
 * Note: Sockpuppet execution is now handled per-platform using typed
 * context tags (e.g., LinkedInPlatform) and platform-specific actions.
 * See makePlatformLayer for the type-safe approach.
 */
export interface RuntimeService {
  /** Start the runtime (no-op, layers self-initialize) */
  readonly start: Effect.Effect<void>;

  /** Stop the runtime */
  readonly stop: Effect.Effect<void>;

  /** Get platform definition by scope */
  readonly getPlatform: (
    scope: ScopeType,
  ) =>
    | PlatformDefinition<any, any, any, any, any, any, any, any, any>
    | undefined;

  /** Get accounts for a scope */
  readonly getAccounts: (
    scope: ScopeType,
  ) => Effect.Effect<readonly BaseAccount<string>[]>;

  /** Get the browser pool */
  readonly browserPool: BrowserPoolService;
}

/** Tag for the Runtime service */
export class Runtime extends Context.Tag("automation/Runtime")<
  Runtime,
  RuntimeService
>() {}

// =============================================================================
// Runtime Implementation
// =============================================================================

/**
 * Create a Runtime service implementation from config.
 */
const makeRuntimeService = (config: RuntimeConfig): RuntimeService => {
  const { browserPool, platforms, accountLoader } = config;

  return {
    start: Effect.void,

    stop: Effect.void,

    getPlatform: (scope) => platforms.get(scope),

    getAccounts: (scope) => Effect.promise(() => accountLoader(scope)),

    browserPool,
  };
};

/**
 * Create a Layer that provides the Runtime service.
 */
export const makeRuntimeLayer = (
  config: RuntimeConfig,
): Layer.Layer<Runtime> => Layer.succeed(Runtime, makeRuntimeService(config));
