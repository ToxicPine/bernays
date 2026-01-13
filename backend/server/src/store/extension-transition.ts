// src/store/extension-transition.ts
// Extension ID transition utility

import { Effect } from "effect";
import type { ExtensionId } from "$/core/branded.ts";
import { ConfigStore, type ConfigStoreError } from "./config-store.ts";
import { ExtensionStore } from "$/backend/mod.ts";

// ============================================================================
// Types
// ============================================================================

export interface TransitionResult {
  readonly configsUpdated: number;
  readonly extensionDeleted: boolean;
}

// ============================================================================
// Transition Utility
// ============================================================================

/**
 * Transition from one extension ID to another.
 *
 * 1. Updates all browser configs, replacing oldId with newId in extensionIds
 * 2. Deletes the old extension from the extension store
 *
 * This is implementation-agnostic—works with any ConfigStore + ExtensionStore
 * combination (Postgres+Browserbase, in-memory+local, etc.).
 *
 * @param fromId - The old extension ID to replace
 * @param toId - The new extension ID to use
 * @returns The number of configs updated and whether the extension was deleted
 */
export const transitionExtension = (
  fromId: ExtensionId,
  toId: ExtensionId,
): Effect.Effect<TransitionResult, ConfigStoreError, ConfigStore | ExtensionStore> =>
  Effect.gen(function* () {
    const configStore = yield* ConfigStore;
    const extensionStore = yield* ExtensionStore;

    // 1. Update all configs, replacing old extension ID with new
    const configsUpdated = yield* configStore.replaceExtensionId(fromId, toId);

    // 2. Delete old extension from extension store
    yield* extensionStore.remove(fromId);

    return {
      configsUpdated,
      extensionDeleted: true,
    };
  });
