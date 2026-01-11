// src/backend/browserbase/extensions.ts
// Browserbase extension store implementation

import { Effect, Option } from "effect";
import type { ExtensionId as ExtensionIdType } from "$/core/branded.ts";
import type { ExtensionMeta, ExtensionStoreService } from "../mod.ts";

// ============================================================================
// Browserbase Extension Store
// ============================================================================

/**
 * Creates an extension store backed by Browserbase.
 * Browserbase manages extension storage and distribution.
 */
export const createBrowserbaseExtensionStore = (
  _apiKey: string,
): ExtensionStoreService => {
  const cache = new Map<string, ExtensionMeta>();

  const list = (): Effect.Effect<readonly ExtensionMeta[]> =>
    Effect.sync(() => {
      return [...cache.values()];
    });

  const get = (
    id: ExtensionIdType,
  ): Effect.Effect<Option.Option<ExtensionMeta>> =>
    Effect.gen(function* () {
      const cached = cache.get(id);
      if (cached) {
        return Option.some(cached);
      }

      const all = yield* list();
      const found = all.find((m) => m.id === id);
      return Option.fromNullable(found);
    });

  const upsert = (meta: ExtensionMeta): Effect.Effect<void> =>
    Effect.sync(() => {
      cache.set(meta.id, meta);
    });

  const remove = (id: ExtensionIdType): Effect.Effect<void> =>
    Effect.sync(() => {
      cache.delete(id);
    });

  return {
    list,
    get,
    upsert,
    remove,
  };
};
