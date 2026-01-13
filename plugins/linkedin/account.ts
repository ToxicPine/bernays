// plugins/linkedin/account.ts
// LinkedIn account binding - maps a persistent platform ID to browser sessions

import { Context, Effect, Layer, Option } from "effect";
import postgres from "postgres";
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
// LinkedIn Account
// =============================================================================

/**
 * LinkedIn account binding.
 *
 * Contains ONLY:
 * - `id`: The persistent LinkedIn member ID (doesn't change)
 * - `browserBindings`: Which browser sessions are logged into this account
 *
 * Everything else (display name, connection count, rate limits, etc.) is
 * dynamic platform state that should be derived from events, not stored here.
 */
export interface LinkedInAccount extends BaseAccount {
  readonly id: AccountIdType;
  readonly browserBindings: readonly BrowserBinding[];
}

// =============================================================================
// Account Store
// =============================================================================

export interface LinkedInAccountStoreService {
  readonly get: (id: AccountIdType) => Effect.Effect<Option.Option<LinkedInAccount>>;
  readonly list: () => Effect.Effect<readonly LinkedInAccount[]>;
  readonly upsert: (account: LinkedInAccount) => Effect.Effect<void>;
  readonly remove: (id: AccountIdType) => Effect.Effect<boolean>;
}

export class LinkedInAccountStore extends Context.Tag("LinkedInAccountStore")<
  LinkedInAccountStore,
  LinkedInAccountStoreService
>() {}

// =============================================================================
// In-Memory Implementation
// =============================================================================

const createInMemoryLinkedInAccountStore = (
  initial: readonly LinkedInAccount[] = [],
): LinkedInAccountStoreService => createInMemoryStore<LinkedInAccount>(initial);

export const makeInMemoryLinkedInAccountStoreLayer = (
  initial: readonly LinkedInAccount[] = [],
): Layer.Layer<LinkedInAccountStore> =>
  Layer.succeed(LinkedInAccountStore, createInMemoryLinkedInAccountStore(initial));

// =============================================================================
// PostgreSQL Implementation
// =============================================================================

export interface PostgresLinkedInAccountStoreOptions {
  readonly connectionString: string;
}

const ensureAccountTable = async (sql: postgres.Sql): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS linkedin_accounts (
      id TEXT PRIMARY KEY,
      browser_bindings JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
};

export const createPostgresLinkedInAccountStore = async (
  options: PostgresLinkedInAccountStoreOptions,
): Promise<LinkedInAccountStoreService> => {
  const sql = postgres(options.connectionString, {
    onnotice: () => {},
  });

  await ensureAccountTable(sql);

  return {
    get: (id) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, browser_bindings FROM linkedin_accounts WHERE id = ${id}
          `;
          if (rows.length === 0) return Option.none<LinkedInAccount>();
          const row = rows[0];
          return Option.some({
            id: AccountId(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          });
        },
        catch: (err) => {
          throw new Error(`Failed to get LinkedIn account: ${err}`);
        },
      }),

    list: () =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, browser_bindings FROM linkedin_accounts ORDER BY id
          `;
          return rows.map((row) => ({
            id: AccountId(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          }));
        },
        catch: (err) => {
          throw new Error(`Failed to list LinkedIn accounts: ${err}`);
        },
      }),

    upsert: (account) =>
      Effect.tryPromise({
        try: async () => {
          await sql`
            INSERT INTO linkedin_accounts (id, browser_bindings, updated_at)
            VALUES (${account.id}, ${JSON.stringify(account.browserBindings)}::jsonb, NOW())
            ON CONFLICT (id) DO UPDATE SET
              browser_bindings = EXCLUDED.browser_bindings,
              updated_at = NOW()
          `;
        },
        catch: (err) => {
          throw new Error(`Failed to upsert LinkedIn account: ${err}`);
        },
      }),

    remove: (id) =>
      Effect.tryPromise({
        try: async () => {
          const result = await sql`DELETE FROM linkedin_accounts WHERE id = ${id}`;
          return result.count > 0;
        },
        catch: (err) => {
          throw new Error(`Failed to remove LinkedIn account: ${err}`);
        },
      }),
  };
};
