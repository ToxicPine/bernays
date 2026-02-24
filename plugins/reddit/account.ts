// plugins/reddit/account.ts
// Reddit account store — maps persistent platform IDs to browser sessions

import { Context, Effect, Layer, Option } from "effect";
import postgres from "postgres";
import { ParticipantIdFromString } from "@bernays/server/core";
import type { ParticipantId } from "@bernays/server/core";
import { type BaseAccount, parseBrowserBindings } from "@bernays/server/views";

// =============================================================================
// Reddit Account
// =============================================================================

/**
 * Reddit account binding.
 *
 * Contains ONLY:
 * - `id`: The persistent Reddit user ID (prefixed with "reddit:")
 * - `browserBindings`: Which browser sessions are logged into this account
 *
 * Everything else (username, karma, account age, etc.) is dynamic platform
 * state derived from events via RedditContact, not stored here.
 */
export interface RedditAccount extends BaseAccount<"reddit"> {}

// =============================================================================
// Account Store Service
// =============================================================================

export interface RedditAccountStoreService {
  readonly get: (
    id: ParticipantId<"reddit">,
  ) => Effect.Effect<Option.Option<RedditAccount>>;
  readonly list: () => Effect.Effect<readonly RedditAccount[]>;
  readonly upsert: (account: RedditAccount) => Effect.Effect<void>;
  readonly remove: (id: ParticipantId<"reddit">) => Effect.Effect<boolean>;
}

export class RedditAccountStore extends Context.Tag("RedditAccountStore")<
  RedditAccountStore,
  RedditAccountStoreService
>() {}

// =============================================================================
// In-Memory Implementation
// =============================================================================

export const createInMemoryRedditAccountStore = (
  initial: readonly RedditAccount[] = [],
): RedditAccountStoreService => {
  const items = new Map<string, RedditAccount>(initial.map((a) => [a.id, a]));

  return {
    get: (id) => Effect.sync(() => Option.fromNullable(items.get(id))),
    list: () => Effect.sync(() => [...items.values()]),
    upsert: (account) =>
      Effect.sync(() => {
        items.set(account.id, account);
      }),
    remove: (id) => Effect.sync(() => items.delete(id)),
  };
};

export const makeInMemoryRedditAccountStoreLayer = (
  initial: readonly RedditAccount[] = [],
): Layer.Layer<RedditAccountStore> =>
  Layer.succeed(
    RedditAccountStore,
    createInMemoryRedditAccountStore(initial),
  );

// =============================================================================
// PostgreSQL Implementation
// =============================================================================

export interface PostgresRedditAccountStoreOptions {
  readonly connectionString: string;
}

const ensureTable = async (sql: postgres.Sql): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS reddit_accounts (
      id TEXT PRIMARY KEY,
      browser_bindings JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
};

export const createPostgresRedditAccountStore = async (
  options: PostgresRedditAccountStoreOptions,
): Promise<RedditAccountStoreService> => {
  const sql = postgres(options.connectionString, {
    onnotice: () => {},
  });

  await ensureTable(sql);

  return {
    get: (id) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, browser_bindings
            FROM reddit_accounts
            WHERE id = ${id}
          `;
          if (rows.length === 0) return Option.none<RedditAccount>();
          const row = rows[0];
          return Option.some({
            id: ParticipantIdFromString<"reddit">(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          });
        },
        catch: (err) => {
          throw new Error(`Failed To Get Reddit Account: ${err}`);
        },
      }),

    list: () =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, browser_bindings
            FROM reddit_accounts
            ORDER BY id
          `;
          return rows.map((row) => ({
            id: ParticipantIdFromString<"reddit">(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          }));
        },
        catch: (err) => {
          throw new Error(`Failed To List Reddit Accounts: ${err}`);
        },
      }),

    upsert: (account) =>
      Effect.tryPromise({
        try: async () => {
          await sql`
            INSERT INTO reddit_accounts (id, browser_bindings, updated_at)
            VALUES (
              ${account.id},
              ${JSON.stringify(account.browserBindings)}::jsonb,
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              browser_bindings = EXCLUDED.browser_bindings,
              updated_at = NOW()
          `;
        },
        catch: (err) => {
          throw new Error(`Failed To Upsert Reddit Account: ${err}`);
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
          throw new Error(`Failed To Remove Reddit Account: ${err}`);
        },
      }),
  };
};
