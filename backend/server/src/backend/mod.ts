// src/backend/mod.ts
// Browser backend - bundles BrowserPool + ExtensionStore

import { Context, Effect, Layer, Stream } from "effect";
import { Option } from "effect";
import type { BrowserConfigId, ExtensionId } from "$/core/branded.ts";
import type {
  BridgeError,
  BrowserError,
  ExtensionMeta,
  TaggedBridgeEvent,
} from "./types.ts";

// ============================================================================
// Re-exports
// ============================================================================

export * from "./types.ts";

// ============================================================================
// Browser Pool Service
// ============================================================================

/**
 * Manages browser lifecycle and communication.
 * Each browser is identified by its BrowserConfigId.
 */
export interface BrowserPoolService {
  /** Launch a browser for the given config */
  readonly launch: (
    configId: BrowserConfigId,
  ) => Effect.Effect<void, BrowserError>;

  /** Stop a running browser */
  readonly stop: (
    configId: BrowserConfigId,
  ) => Effect.Effect<void, BrowserError>;

  /** Check if a browser is running */
  readonly isRunning: (
    configId: BrowserConfigId,
  ) => Effect.Effect<boolean>;

  /** Send a command to a browser */
  readonly send: (
    configId: BrowserConfigId,
    command: { readonly type: string; readonly payload: unknown },
  ) => Effect.Effect<unknown, BrowserError | BridgeError>;

  /** Stream of all events from all running browsers */
  readonly events: Stream.Stream<TaggedBridgeEvent, BrowserError>;
}

export class BrowserPool extends Context.Tag("BrowserPool")<
  BrowserPool,
  BrowserPoolService
>() {}

// ============================================================================
// Extension Store Service
// ============================================================================

/**
 * Manages extension metadata.
 * Used for admin workflows (querying/uploading extensions).
 * Runtime uses BrowserConfig.extensionIds which is set during browser setup.
 */
export interface ExtensionStoreService {
  readonly list: () => Effect.Effect<readonly ExtensionMeta[]>;
  readonly get: (
    id: ExtensionId,
  ) => Effect.Effect<Option.Option<ExtensionMeta>>;
  readonly upsert: (meta: ExtensionMeta) => Effect.Effect<void>;
  readonly remove: (id: ExtensionId) => Effect.Effect<void>;
}

export class ExtensionStore extends Context.Tag("ExtensionStore")<
  ExtensionStore,
  ExtensionStoreService
>() {}

// ============================================================================
// Browser Backend
// ============================================================================

/**
 * Browser backend bundles pool and extension store together.
 * This ensures compatibility between implementations
 * (e.g., Browserbase stores extensions for you, local Playwright loads from filesystem).
 */
export interface BrowserBackend {
  readonly pool: BrowserPoolService;
  readonly extensions: ExtensionStoreService;
}

/**
 * Creates a Layer that provides both BrowserPool and ExtensionStore
 * from a BrowserBackend.
 */
export const BrowserBackendLive = (
  backend: BrowserBackend,
): Layer.Layer<BrowserPool | ExtensionStore> =>
  Layer.mergeAll(
    Layer.succeed(BrowserPool, backend.pool),
    Layer.succeed(ExtensionStore, backend.extensions),
  );

// ============================================================================
// Backend Implementations
// ============================================================================

export { makeBrowserbaseBackend } from "./browserbase/mod.ts";
// Local backend is a placeholder for now
// export { makeLocalBackend } from "./local/mod.ts";
