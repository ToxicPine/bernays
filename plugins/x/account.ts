// plugins/x/account.ts
// X account store — maps persistent platform IDs to browser sessions

import { Context, Effect, Layer, Option } from "effect";
import postgres from "postgres";
import { ParticipantIdFromString } from "@bernays/server/core";
import type { ParticipantId } from "@bernays/server/core";
import { type BaseAccount, parseBrowserBindings } from "@bernays/server/views";

// =============================================================================
// X Account
// =============================================================================

/**
 * X account binding.
 *
 * Contains ONLY:
 * - `id`: The persistent X user ID (doesn't change, even if handle changes)
 * - `browserBindings`: Which browser sessions are logged into this account
 *
 * Everything else (handle, display name, verification status, follower counts,
 * rate limits, etc.) is dynamic platform state derived from events, not stored here.
 */
export interface XAccount extends BaseAccount<"x"> {}

// =============================================================================
// Account Store Service
// =============================================================================

export interface XAccountStoreService {
  readonly get: (
    id: ParticipantId<"x">,
  ) => Effect.Effect<Option.Option<XAccount>>;
  readonly list: () => Effect.Effect<readonly XAccount[]>;
  readonly upsert: (account: XAccount) => Effect.Effect<void>;
  readonly remove: (id: ParticipantId<"x">) => Effect.Effect<boolean>;
}

export class XAccountStore extends Context.Tag("XAccountStore")<
  XAccountStore,
  XAccountStoreService
>() {}

// =============================================================================
// In-Memory Implementation
// =============================================================================

export const createInMemoryXAccountStore = (
  initial: readonly XAccount[] = [],
): XAccountStoreService => {
  const items = new Map<string, XAccount>(initial.map((a) => [a.id, a]));

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

export const makeInMemoryXAccountStoreLayer = (
  initial: readonly XAccount[] = [],
): Layer.Layer<XAccountStore> =>
  Layer.succeed(XAccountStore, createInMemoryXAccountStore(initial));

// =============================================================================
// PostgreSQL Implementation
// =============================================================================

export interface PostgresXAccountStoreOptions {
  readonly connectionString: string;
}

const ensureTable = async (sql: postgres.Sql): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS x_accounts (
      id TEXT PRIMARY KEY,
      browser_bindings JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
};

export const createPostgresXAccountStore = async (
  options: PostgresXAccountStoreOptions,
): Promise<XAccountStoreService> => {
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
            FROM x_accounts
            WHERE id = ${id}
          `;
          if (rows.length === 0) return Option.none<XAccount>();
          const row = rows[0];
          return Option.some({
            id: ParticipantIdFromString<"x">(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          });
        },
        catch: (err) => {
          throw new Error(`Failed To Get X Account: ${err}`);
        },
      }),

    list: () =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, browser_bindings
            FROM x_accounts
            ORDER BY id
          `;
          return rows.map((row) => ({
            id: ParticipantIdFromString<"x">(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          }));
        },
        catch: (err) => {
          throw new Error(`Failed To List X Accounts: ${err}`);
        },
      }),

    upsert: (account) =>
      Effect.tryPromise({
        try: async () => {
          await sql`
            INSERT INTO x_accounts (id, browser_bindings, updated_at)
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
          throw new Error(`Failed To Upsert X Account: ${err}`);
        },
      }),

    remove: (id) =>
      Effect.tryPromise({
        try: async () => {
          const result = await sql`
            DELETE FROM x_accounts WHERE id = ${id}
          `;
          return result.count > 0;
        },
        catch: (err) => {
          throw new Error(`Failed To Remove X Account: ${err}`);
        },
      }),
  };
};
