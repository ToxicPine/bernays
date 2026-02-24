// core/store-factory.ts
// Generic in-memory store factory for CRUD operations

import { Effect, Option } from "effect";

// Generic Store Interface

/**
 * Entity with an ID field.
 * All storable entities must have a string `id` field.
 */
export interface Identifiable {
  readonly id: string;
}

/**
 * Generic store service interface.
 * Provides basic CRUD operations with Effect-based error handling.
 *
 * @template T - Entity type (must have an `id` field)
 * @template E - Error type (defaults to never for in-memory stores)
 */
export interface StoreService<T extends Identifiable, E = never> {
  readonly get: (id: string) => Effect.Effect<Option.Option<T>, E>;
  readonly list: () => Effect.Effect<readonly T[], E>;
  readonly upsert: (item: T) => Effect.Effect<void, E>;
  readonly remove: (id: string) => Effect.Effect<boolean, E>;
}

// In-Memory Store Factory

/**
 * Create a generic in-memory store.
 *
 * This factory eliminates duplication across AccountStore, ConfigStore, etc.
 * The store is generic and type-safe.
 *
 * @param initial - Optional initial items to populate the store
 * @returns A StoreService implementation backed by a Map
 *
 * @example
 * ```ts
 * interface User extends Identifiable {
 *   readonly id: string;
 *   readonly name: string;
 * }
 *
 * const userStore = createInMemoryStore<User>();
 * ```
 */
export const createInMemoryStore = <T extends Identifiable>(
  initial: readonly T[] = [],
): StoreService<T> => {
  const items = new Map<string, T>(initial.map((item) => [item.id, item]));

  return {
    get: (id) => Effect.sync(() => Option.fromNullable(items.get(id))),

    list: () => Effect.sync(() => [...items.values()]),

    upsert: (item) =>
      Effect.sync(() => {
        items.set(item.id, item);
      }),

    remove: (id) => Effect.sync(() => items.delete(id)),
  };
};
