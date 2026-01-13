// plugins/x/account.ts
// X account binding - maps a persistent platform ID to browser sessions

import { Context, Effect, Layer, Option } from "effect";
import type postgres from "postgres";
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
 * rate limits, etc.) is dynamic platform state that should be derived from
 * events, not stored here.
 */
export interface XAccount extends BaseAccount {
  readonly id: AccountIdType;
  readonly browserBindings: readonly BrowserBinding[];
}

// =============================================================================
// Account Store
// =============================================================================

export interface XAccountStoreService {
  readonly get: (id: AccountIdType) => Effect.Effect<Option.Option<XAccount>>;
  readonly list: () => Effect.Effect<readonly XAccount[]>;
  readonly upsert: (account: XAccount) => Effect.Effect<void>;
  readonly remove: (id: AccountIdType) => Effect.Effect<boolean>;
}

export class XAccountStore extends Context.Tag("XAccountStore")<
  XAccountStore,
  XAccountStoreService
>() {}

// =============================================================================
// In-Memory Implementation
// =============================================================================

const createInMemoryXAccountStore = (
  initial: readonly XAccount[] = [],
): XAccountStoreService => createInMemoryStore<XAccount>(initial);

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

const ensureAccountTable = async (sql: postgres.Sql): Promise<void> => {
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
  const postgres = await import("npm:postgres").then((m) => m.default);
  const sql = postgres(options.connectionString, {
    onnotice: () => {},
  });

  await ensureAccountTable(sql);

  return {
    get: (id) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, browser_bindings FROM x_accounts WHERE id = ${id}
          `;
          if (rows.length === 0) return Option.none<XAccount>();
          const row = rows[0];
          return Option.some({
            id: AccountId(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          });
        },
        catch: (err) => {
          throw new Error(`Failed to get X account: ${err}`);
        },
      }),

    list: () =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, browser_bindings FROM x_accounts ORDER BY id
          `;
          return rows.map((row) => ({
            id: AccountId(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          }));
        },
        catch: (err) => {
          throw new Error(`Failed to list X accounts: ${err}`);
        },
      }),

    upsert: (account) =>
      Effect.tryPromise({
        try: async () => {
          await sql`
            INSERT INTO x_accounts (id, browser_bindings, updated_at)
            VALUES (${account.id}, ${JSON.stringify(account.browserBindings)}::jsonb, NOW())
            ON CONFLICT (id) DO UPDATE SET
              browser_bindings = EXCLUDED.browser_bindings,
              updated_at = NOW()
          `;
        },
        catch: (err) => {
          throw new Error(`Failed to upsert X account: ${err}`);
        },
      }),

    remove: (id) =>
      Effect.tryPromise({
        try: async () => {
          const result = await sql`DELETE FROM x_accounts WHERE id = ${id}`;
          return result.count > 0;
        },
        catch: (err) => {
          throw new Error(`Failed to remove X account: ${err}`);
        },
      }),
  };
};
