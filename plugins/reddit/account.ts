// src/platforms/reddit/account.ts
// Reddit account type and storage

import { Context, Effect, Layer, Option } from "effect";
import {
  AccountId,
  type AccountId as AccountIdType,
} from "@bernays/server/core";
import {
  type BaseAccount,
  type BrowserBinding,
  parseBrowserBindings,
} from "@bernays/server/views";
import { createInMemoryStore } from "@bernays/server/core";

// ============================================================================
// Reddit Account
// ============================================================================

/**
 * Reddit account - extends BaseAccount with Reddit-specific fields.
 */
export interface RedditAccount extends BaseAccount {
  readonly id: AccountIdType;
  readonly browserBindings: readonly BrowserBinding[];

  // Reddit-specific fields
  readonly username: string;
  readonly karma: number;
  readonly accountCreatedAt: string;
}

// ============================================================================
// Reddit Account Store
// ============================================================================

export interface RedditAccountStoreService {
  readonly get: (
    id: AccountIdType,
  ) => Effect.Effect<Option.Option<RedditAccount>>;
  readonly list: () => Effect.Effect<readonly RedditAccount[]>;
  readonly upsert: (account: RedditAccount) => Effect.Effect<void>;
  readonly remove: (id: AccountIdType) => Effect.Effect<boolean>;
}

export class RedditAccountStore extends Context.Tag("RedditAccountStore")<
  RedditAccountStore,
  RedditAccountStoreService
>() {}

// ============================================================================
// In-Memory Implementation
// ============================================================================

/**
 * Create an in-memory Reddit account store.
 * Uses the generic createInMemoryStore factory.
 */
const createInMemoryRedditAccountStore = (
  initial: readonly RedditAccount[] = [],
): RedditAccountStoreService => createInMemoryStore<RedditAccount>(initial);

export const makeInMemoryRedditAccountStoreLayer = (
  initial: readonly RedditAccount[] = [],
): Layer.Layer<RedditAccountStore> =>
  Layer.succeed(
    RedditAccountStore,
    createInMemoryRedditAccountStore(initial),
  );

// ============================================================================
// PostgreSQL Implementation
// ============================================================================

export interface PostgresRedditAccountStoreOptions {
  readonly connectionString: string;
}

/**
 * PostgreSQL-backed Reddit account store.
 *
 * Table schema:
 * ```sql
 * CREATE TABLE reddit_accounts (
 *   id TEXT PRIMARY KEY,
 *   username TEXT NOT NULL,
 *   karma INTEGER NOT NULL DEFAULT 0,
 *   account_created_at TIMESTAMPTZ NOT NULL,
 *   browser_bindings JSONB NOT NULL DEFAULT '[]',
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 * ```
 */
export const createPostgresRedditAccountStore = async (
  options: PostgresRedditAccountStoreOptions,
): Promise<RedditAccountStoreService> => {
  const postgres = await import("npm:postgres").then((m) => m.default);
  const sql = postgres(options.connectionString);

  return {
    get: (id) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, username, karma, account_created_at, browser_bindings
            FROM reddit_accounts
            WHERE id = ${id}
          `;

          if (rows.length === 0) {
            return Option.none<RedditAccount>();
          }

          const row = rows[0];
          return Option.some({
            id: AccountId(row.id),
            username: row.username,
            karma: row.karma,
            accountCreatedAt: row.account_created_at,
            browserBindings: parseBrowserBindings(row.browser_bindings),
          });
        },
        catch: (err) => {
          throw new Error(`Failed to get Reddit account: ${err}`);
        },
      }),

    list: () =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, username, karma, account_created_at, browser_bindings
            FROM reddit_accounts
            ORDER BY username
          `;

          return rows.map((row) => ({
            id: AccountId(row.id),
            username: row.username,
            karma: row.karma,
            accountCreatedAt: row.account_created_at,
            browserBindings: parseBrowserBindings(row.browser_bindings),
          }));
        },
        catch: (err) => {
          throw new Error(`Failed to list Reddit accounts: ${err}`);
        },
      }),

    upsert: (account) =>
      Effect.tryPromise({
        try: async () => {
          await sql`
            INSERT INTO reddit_accounts (id, username, karma, account_created_at, browser_bindings, updated_at)
            VALUES (
              ${account.id},
              ${account.username},
              ${account.karma},
              ${account.accountCreatedAt},
              ${JSON.stringify(account.browserBindings)}::jsonb,
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              username = EXCLUDED.username,
              karma = EXCLUDED.karma,
              account_created_at = EXCLUDED.account_created_at,
              browser_bindings = EXCLUDED.browser_bindings,
              updated_at = NOW()
          `;
        },
        catch: (err) => {
          throw new Error(`Failed to upsert Reddit account: ${err}`);
        },
      }),

    remove: (id) =>
      Effect.tryPromise({
        try: async () => {
          const result = await sql`
            DELETE FROM reddit_accounts WHERE id = ${id}
          `;
          return result.count > 0;
        },
        catch: (err) => {
          throw new Error(`Failed to remove Reddit account: ${err}`);
        },
      }),
  };
};
