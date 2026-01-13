// src/store/config-store.ts
// Browser configuration storage

import { Context, Effect, Layer, Option } from "effect";
import postgres from "postgres";
import {
  BrowserConfigId,
  type BrowserConfigId as BrowserConfigIdType,
  ExtensionId,
  type ExtensionId as ExtensionIdType,
} from "$/core/branded.ts";
import { createInMemoryStore } from "$/core/store-factory.ts";
import type { BrowserConfig, ProxyConfig } from "$/backend/types.ts";

// ============================================================================
// Error Types
// ============================================================================

export type ConfigStoreErrorCode =
  | "NotFound"
  | "QueryFailed"
  | "PersistenceError";

export interface ConfigStoreError {
  readonly _tag: "ConfigStoreError";
  readonly code: ConfigStoreErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const configStoreError = (
  code: ConfigStoreErrorCode,
  message: string,
  cause?: unknown,
): ConfigStoreError => ({ _tag: "ConfigStoreError", code, message, cause });

// ============================================================================
// ConfigStore Service
// ============================================================================

export interface ConfigStoreService {
  readonly get: (
    id: BrowserConfigIdType,
  ) => Effect.Effect<Option.Option<BrowserConfig>, ConfigStoreError>;

  readonly list: () => Effect.Effect<
    readonly BrowserConfig[],
    ConfigStoreError
  >;

  readonly upsert: (
    config: BrowserConfig,
  ) => Effect.Effect<void, ConfigStoreError>;

  readonly remove: (
    id: BrowserConfigIdType,
  ) => Effect.Effect<boolean, ConfigStoreError>;

  /**
   * Replace an extension ID with a new one across all configs.
   * Returns the number of configs that were updated.
   */
  readonly replaceExtensionId: (
    oldId: ExtensionIdType,
    newId: ExtensionIdType,
  ) => Effect.Effect<number, ConfigStoreError>;
}

export class ConfigStore extends Context.Tag("ConfigStore")<
  ConfigStore,
  ConfigStoreService
>() {}

// ============================================================================
// In-Memory Implementation
// ============================================================================

/**
 * Create an in-memory config store.
 * Wraps the generic store factory and adds ConfigStore-specific methods.
 */
export const createInMemoryConfigStore = (
  initial: readonly BrowserConfig[] = [],
): ConfigStoreService => {
  const baseStore = createInMemoryStore<BrowserConfig>(initial);

  return {
    ...baseStore,

    replaceExtensionId: (oldId, newId) =>
      Effect.gen(function* () {
        const configs = yield* baseStore.list();
        let count = 0;

        for (const config of configs) {
          if (config.extensionIds.includes(oldId)) {
            yield* baseStore.upsert({
              ...config,
              extensionIds: config.extensionIds.map((id) =>
                id === oldId ? newId : id
              ),
            });
            count++;
          }
        }

        return count;
      }),
  };
};

export const makeInMemoryConfigStoreLayer = (
  initial: readonly BrowserConfig[] = [],
): Layer.Layer<ConfigStore> =>
  Layer.succeed(ConfigStore, createInMemoryConfigStore(initial));

// ============================================================================
// PostgreSQL Implementation
// ============================================================================

/**
 * PostgreSQL-backed config store.
 * Table schema:
 * ```sql
 * CREATE TABLE browser_configs (
 *   id TEXT PRIMARY KEY,
 *   context TEXT NOT NULL,
 *   extension_ids TEXT[] NOT NULL DEFAULT '{}',
 *   proxy_server TEXT,
 *   proxy_username TEXT,
 *   proxy_password TEXT,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 * ```
 */
export interface PostgresConfigStoreOptions {
  readonly connectionString: string;
}

const ensureConfigTable = async (sql: postgres.Sql): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS browser_configs (
      id TEXT PRIMARY KEY,
      context TEXT NOT NULL,
      extension_ids TEXT[] NOT NULL DEFAULT '{}',
      proxy_server TEXT,
      proxy_username TEXT,
      proxy_password TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
};

export const createPostgresConfigStore = async (
  options: PostgresConfigStoreOptions,
): Promise<ConfigStoreService> => {
  const sql = postgres(options.connectionString, {
    onnotice: () => {}, // Suppress NOTICE/WARNING messages
  });

  await ensureConfigTable(sql);

  return {
    get: (id) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, context, extension_ids, proxy_server, proxy_username, proxy_password
            FROM browser_configs
            WHERE id = ${id}
          `;

          if (rows.length === 0) {
            return Option.none<BrowserConfig>();
          }

          const row = rows[0];
          const proxy: ProxyConfig | undefined = row.proxy_server
            ? {
              server: row.proxy_server,
              username: row.proxy_username ?? undefined,
              password: row.proxy_password ?? undefined,
            }
            : undefined;

          return Option.some({
            id: BrowserConfigId(row.id),
            context: row.context,
            extensionIds: (row.extension_ids as string[]).map(ExtensionId),
            proxy,
          });
        },
        catch: (err) =>
          configStoreError(
            "QueryFailed",
            `Failed to get config: ${err}`,
            err,
          ),
      }),

    list: () =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, context, extension_ids, proxy_server, proxy_username, proxy_password
            FROM browser_configs
            ORDER BY id
          `;

          return rows.map((row) => {
            const proxy: ProxyConfig | undefined = row.proxy_server
              ? {
                server: row.proxy_server,
                username: row.proxy_username ?? undefined,
                password: row.proxy_password ?? undefined,
              }
              : undefined;

            return {
              id: BrowserConfigId(row.id),
              context: row.context,
              extensionIds: (row.extension_ids as string[]).map(ExtensionId),
              proxy,
            };
          });
        },
        catch: (err) =>
          configStoreError(
            "QueryFailed",
            `Failed to list configs: ${err}`,
            err,
          ),
      }),

    upsert: (config) =>
      Effect.tryPromise({
        try: async () => {
          await sql`
            INSERT INTO browser_configs (id, context, extension_ids, proxy_server, proxy_username, proxy_password, updated_at)
            VALUES (
              ${config.id},
              ${config.context},
              ${[...config.extensionIds] as string[]},
              ${config.proxy?.server ?? null},
              ${config.proxy?.username ?? null},
              ${config.proxy?.password ?? null},
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              context = EXCLUDED.context,
              extension_ids = EXCLUDED.extension_ids,
              proxy_server = EXCLUDED.proxy_server,
              proxy_username = EXCLUDED.proxy_username,
              proxy_password = EXCLUDED.proxy_password,
              updated_at = NOW()
          `;
        },
        catch: (err) =>
          configStoreError(
            "PersistenceError",
            `Failed to upsert config: ${err}`,
            err,
          ),
      }),

    remove: (id) =>
      Effect.tryPromise({
        try: async () => {
          const result = await sql`
            DELETE FROM browser_configs WHERE id = ${id}
          `;
          return result.count > 0;
        },
        catch: (err) =>
          configStoreError(
            "PersistenceError",
            `Failed to remove config: ${err}`,
            err,
          ),
      }),

    replaceExtensionId: (oldId, newId) =>
      Effect.tryPromise({
        try: async () => {
          const result = await sql`
            UPDATE browser_configs
            SET extension_ids = array_replace(extension_ids, ${oldId}, ${newId}),
                updated_at = NOW()
            WHERE ${oldId} = ANY(extension_ids)
          `;
          return result.count;
        },
        catch: (err) =>
          configStoreError(
            "PersistenceError",
            `Failed to replace extension ID: ${err}`,
            err,
          ),
      }),
  };
};
