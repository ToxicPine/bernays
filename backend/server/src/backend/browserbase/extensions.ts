// src/backend/browserbase/extensions.ts
// Browserbase extension store implementation

import { Effect, Option } from "effect";
import type { ExtensionId as ExtensionIdType } from "$/core/branded.ts";
import type { ExtensionMeta, ExtensionStoreService } from "../mod.ts";

// ============================================================================
// Constants
// ============================================================================

const API_BASE = "https://www.browserbase.com";

// ============================================================================
// Browserbase Extension Store
// ============================================================================

/**
 * Creates an extension store backed by Browserbase.
 * Browserbase manages extension storage and distribution.
 */
export const createBrowserbaseExtensionStore = (
  apiKey: string,
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
    Effect.tryPromise(async () => {
      // Delete from Browserbase API
      const res = await fetch(`${API_BASE}/v1/extensions/${id}`, {
        method: "DELETE",
        headers: { "X-BB-API-Key": apiKey },
      });

      // 404 = already deleted, 200/204 = success
      if (res.status !== 404 && res.status !== 200 && res.status !== 204) {
        throw new Error(
          `Failed to delete extension from Browserbase: ${res.status}`,
        );
      }

      // Clear from local cache
      cache.delete(id);
    }).pipe(Effect.orDie);

  return {
    list,
    get,
    upsert,
    remove,
  };
};
