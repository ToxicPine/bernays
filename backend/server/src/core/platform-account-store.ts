// core/platform-account-store.ts
// Generic platform account store factory - eliminates PostgreSQL duplication across plugins

import { Effect, Option } from "effect";
import {
  type ParticipantId as ParticipantIdType,
  ParticipantIdFromString,
} from "./branded.ts";
import { type BaseAccount, parseBrowserBindings } from "$/views/mod.ts";
import { createInMemoryStore } from "./store-factory.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * Generic account store service interface.
 * Provides CRUD operations for platform accounts with Effect-based error handling.
 *
 * @template TScope - Platform scope (e.g., "linkedin", "x", "reddit")
 * @template TAccount - Account type extending BaseAccount
 */
export interface AccountStoreService<
  TScope extends string,
  TAccount extends BaseAccount<TScope>,
> {
  readonly get: (
    id: ParticipantIdType<TScope>,
  ) => Effect.Effect<Option.Option<TAccount>>;
  readonly list: () => Effect.Effect<readonly TAccount[]>;
  readonly upsert: (account: TAccount) => Effect.Effect<void>;
  readonly remove: (id: ParticipantIdType<TScope>) => Effect.Effect<boolean>;
}

/**
 * Configuration for creating a platform account store.
 *
 * @template TScope - Platform scope literal type
 * @template TAccount - Account type extending BaseAccount
 */
export interface PlatformAccountStoreConfig<
  TScope extends string,
  TAccount extends BaseAccount<TScope>,
> {
  readonly tableName: string;

  readonly scope: TScope;
  readonly displayName: string;

  readonly createTableSql?: string;

  readonly selectColumns?: string;

  readonly rowToAccount?: (
    row: Record<string, unknown>,
    scope: TScope,
  ) => TAccount;

  readonly buildUpsertParams?: (
    account: TAccount,
  ) => {
    columns: string;
    values: readonly unknown[];
    conflictUpdate: string;
  };
}

// =============================================================================
// Default Implementations
// =============================================================================

const defaultCreateTableSql = (tableName: string): string => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    id TEXT PRIMARY KEY,
    browser_bindings JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const defaultRowToAccount = <
  TScope extends string,
  TAccount extends BaseAccount<TScope>,
>(
  row: Record<string, unknown>,
  _scope: TScope,
): TAccount =>
  ({
    id: ParticipantIdFromString<TScope>(row.id as string),
    browserBindings: parseBrowserBindings(row.browser_bindings),
  }) as TAccount;

// =============================================================================
// Factory
// ============================================================================

export interface PostgresAccountStoreOptions {
  readonly connectionString: string;
}

/**
 * Create platform-specific account store implementations.
 *
 * This factory eliminates ~100 lines of duplicated PostgreSQL code per platform.
 * Each platform only needs to configure table name, scope, and any custom fields.
 *
 * @example
 * ```ts
 * // Simple case (LinkedIn, X) - uses defaults
 * const linkedInStore = createPlatformAccountStore({
 *   tableName: "linkedin_accounts",
 *   scope: "linkedin",
 *   displayName: "LinkedIn",
 * });
 *
 * // Extended case (Reddit) - custom fields
 * const redditStore = createPlatformAccountStore({
 *   tableName: "reddit_accounts",
 *   scope: "reddit",
 *   displayName: "Reddit",
 *   selectColumns: "id, username, karma, account_created_at, browser_bindings",
 *   createTableSql: `CREATE TABLE IF NOT EXISTS reddit_accounts (...)`,
 *   rowToAccount: (row, scope) => ({ ... }),
 *   buildUpsertParams: (account) => ({ ... }),
 * });
 * ```
 */
export const createPlatformAccountStore = <
  TScope extends string,
  TAccount extends BaseAccount<TScope>,
>(
  config: PlatformAccountStoreConfig<TScope, TAccount>,
) => {
  const {
    tableName,
    scope,
    displayName,
    createTableSql,
    selectColumns = "id, browser_bindings",
    rowToAccount = defaultRowToAccount,
    buildUpsertParams,
  } = config;

  return {
    /**
     * Create a PostgreSQL-backed account store.
     */
    createPostgres: async (
      options: PostgresAccountStoreOptions,
    ): Promise<AccountStoreService<TScope, TAccount>> => {
      const postgres = await import("npm:postgres").then((m) => m.default);
      const sql = postgres(options.connectionString, {
        onnotice: () => {},
      });

      const createSql = createTableSql ?? defaultCreateTableSql(tableName);
      await sql.unsafe(createSql);

      return {
        get: (id) =>
          Effect.tryPromise({
            try: async () => {
              const rows = await sql.unsafe(
                `SELECT ${selectColumns} FROM ${tableName} WHERE id = $1`,
                [id],
              );
              if (rows.length === 0) return Option.none<TAccount>();
              return Option.some(rowToAccount(rows[0], scope));
            },
            catch: (err) => {
              throw new Error(`Failed to get ${displayName} account: ${err}`);
            },
          }),

        list: () =>
          Effect.tryPromise({
            try: async () => {
              const rows = await sql.unsafe(
                `SELECT ${selectColumns} FROM ${tableName} ORDER BY id`,
              );
              return rows.map((row: Record<string, unknown>) =>
                rowToAccount(row, scope)
              );
            },
            catch: (err) => {
              throw new Error(`Failed to list ${displayName} accounts: ${err}`);
            },
          }),

        upsert: (account) =>
          Effect.tryPromise({
            try: async () => {
              if (buildUpsertParams) {
                const { columns, values, conflictUpdate } = buildUpsertParams(
                  account,
                );
                const placeholders = values
                  .map((_, i) => `$${i + 1}`)
                  .join(", ");
                await sql.unsafe(
                  `INSERT INTO ${tableName} (${columns})
                   VALUES (${placeholders})
                   ON CONFLICT (id) DO UPDATE SET ${conflictUpdate}`,
                  // deno-lint-ignore no-explicit-any
                  values as any[],
                );
              } else {
                await sql.unsafe(
                  `INSERT INTO ${tableName} (id, browser_bindings, updated_at)
                   VALUES ($1, $2::jsonb, NOW())
                   ON CONFLICT (id) DO UPDATE SET
                     browser_bindings = EXCLUDED.browser_bindings,
                     updated_at = NOW()`,
                  [account.id, JSON.stringify(account.browserBindings)],
                );
              }
            },
            catch: (err) => {
              throw new Error(
                `Failed to upsert ${displayName} account: ${err}`,
              );
            },
          }),

        remove: (id) =>
          Effect.tryPromise({
            try: async () => {
              const result = await sql.unsafe(
                `DELETE FROM ${tableName} WHERE id = $1`,
                [id],
              );
              return result.count > 0;
            },
            catch: (err) => {
              throw new Error(
                `Failed to remove ${displayName} account: ${err}`,
              );
            },
          }),
      };
    },

    /**
     * Create an in-memory account store for testing.
     */
    createInMemory: (
      initial: readonly TAccount[] = [],
    ): AccountStoreService<TScope, TAccount> =>
      createInMemoryStore<TAccount>(initial) as AccountStoreService<
        TScope,
        TAccount
      >,
  };
};
