// src/backend/local/extensions.ts
// Local filesystem extension store implementation

import { Effect, Option } from "effect";
import type { ExtensionId as ExtensionIdType } from "$/core/branded.ts";
import { ExtensionId } from "$/core/branded.ts";
import type { ExtensionMeta, ExtensionStoreService } from "../mod.ts";

// =============================================================================
// Configuration
// =============================================================================

export interface LocalExtensionStoreOptions {
  readonly extensionsDir?: string;
}

// =============================================================================
// Local Extension Store
// =============================================================================

/**
 * Creates a local filesystem-backed extension store.
 * Extensions are loaded from a local directory.
 *
 * Directory structure:
 * ```
 * extensionsDir/
 *   extension-id-1/
 *     manifest.json
 *     ...
 *   extension-id-2/
 *     manifest.json
 *     ...
 * ```
 *
 * @param options - Extension store options
 */
export const createLocalExtensionStore = (
  options: LocalExtensionStoreOptions = {},
): ExtensionStoreService => {
  const { extensionsDir = "./extensions" } = options;

  const cache = new Map<string, ExtensionMeta>();

  /**
   * Scan extensions directory and load metadata from manifest.json files.
   */
  const scanExtensions = async (): Promise<readonly ExtensionMeta[]> => {
    const extensions: ExtensionMeta[] = [];

    try {
      for await (const entry of Deno.readDir(extensionsDir)) {
        if (!entry.isDirectory) continue;

        const manifestPath = `${extensionsDir}/${entry.name}/manifest.json`;
        try {
          const content = await Deno.readTextFile(manifestPath);
          const manifest = JSON.parse(content) as {
            name?: string;
            version?: string;
          };

          const meta: ExtensionMeta = {
            id: ExtensionId(entry.name),
            name: manifest.name ?? entry.name,
            version: manifest.version ?? "0.0.0",
            uri: `${extensionsDir}/${entry.name}`,
          };

          extensions.push(meta);
          cache.set(meta.id, meta);
        } catch {
          // Skip directories without valid manifest
        }
      }
    } catch {
      // Extensions directory doesn't exist or isn't readable
    }

    return extensions;
  };

  const list = (): Effect.Effect<readonly ExtensionMeta[]> =>
    Effect.tryPromise({
      try: async () => {
        // Return from cache if populated
        if (cache.size > 0) {
          return [...cache.values()];
        }
        // Otherwise scan directory
        return await scanExtensions();
      },
      catch: () => [] as readonly ExtensionMeta[],
    }).pipe(Effect.orElseSucceed(() => [] as readonly ExtensionMeta[]));

  const get = (
    id: ExtensionIdType,
  ): Effect.Effect<Option.Option<ExtensionMeta>> =>
    Effect.tryPromise({
      try: async () => {
        const cached = cache.get(id);
        if (cached) {
          return Option.some(cached);
        }

        const manifestPath = `${extensionsDir}/${id}/manifest.json`;
        try {
          const content = await Deno.readTextFile(manifestPath);
          const manifest = JSON.parse(content) as {
            name?: string;
            version?: string;
          };

          const meta: ExtensionMeta = {
            id,
            name: manifest.name ?? id,
            version: manifest.version ?? "0.0.0",
            uri: `${extensionsDir}/${id}`,
          };

          cache.set(id, meta);
          return Option.some(meta);
        } catch {
          return Option.none();
        }
      },
      catch: () => Option.none(),
    }).pipe(Effect.orElseSucceed(() => Option.none()));

  const upsert = (meta: ExtensionMeta): Effect.Effect<void> =>
    Effect.sync(() => {
      cache.set(meta.id, meta);
    });

  const remove = (id: ExtensionIdType): Effect.Effect<void> =>
    Effect.sync(() => {
      cache.delete(id);
      // Note: We don't delete from filesystem - just from cache
      // Physical deletion would be a separate admin operation
    });

  return {
    list,
    get,
    upsert,
    remove,
  };
};

/**
 * Creates an in-memory extension store.
 * Useful for testing when no filesystem access is needed.
 */
export const createInMemoryExtensionStore = (
  initial: readonly ExtensionMeta[] = [],
): ExtensionStoreService => {
  const cache = new Map<string, ExtensionMeta>(
    initial.map((m) => [m.id, m]),
  );

  const list = (): Effect.Effect<readonly ExtensionMeta[]> =>
    Effect.sync(() => [...cache.values()]);

  const get = (
    id: ExtensionIdType,
  ): Effect.Effect<Option.Option<ExtensionMeta>> =>
    Effect.sync(() => Option.fromNullable(cache.get(id)));

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
