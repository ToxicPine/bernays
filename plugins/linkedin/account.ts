// src/platforms/linkedin/account.ts
// LinkedIn account type and storage

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

// ============================================================================
// LinkedIn Account
// ============================================================================

/**
 * LinkedIn account - extends BaseAccount with LinkedIn-specific fields.
 */
export interface LinkedInAccount extends BaseAccount {
  readonly id: AccountIdType;
  readonly browserBindings: readonly BrowserBinding[];

  // LinkedIn-specific fields
  readonly displayName: string;
  readonly profileUrl: string;
  readonly weeklyInviteLimit: number;
}

// ============================================================================
// LinkedIn Account Store
// ============================================================================

export interface LinkedInAccountStoreService {
  readonly get: (
    id: AccountIdType,
  ) => Effect.Effect<Option.Option<LinkedInAccount>>;
  readonly list: () => Effect.Effect<readonly LinkedInAccount[]>;
  readonly upsert: (account: LinkedInAccount) => Effect.Effect<void>;
  readonly remove: (id: AccountIdType) => Effect.Effect<boolean>;
}

export class LinkedInAccountStore extends Context.Tag("LinkedInAccountStore")<
  LinkedInAccountStore,
  LinkedInAccountStoreService
>() {}

// ============================================================================
// In-Memory Implementation
// ============================================================================

/**
 * Create an in-memory LinkedIn account store.
 * Uses the generic createInMemoryStore factory.
 */
const createInMemoryLinkedInAccountStore = (
  initial: readonly LinkedInAccount[] = [],
): LinkedInAccountStoreService => createInMemoryStore<LinkedInAccount>(initial);

export const makeInMemoryLinkedInAccountStoreLayer = (
  initial: readonly LinkedInAccount[] = [],
): Layer.Layer<LinkedInAccountStore> =>
  Layer.succeed(
    LinkedInAccountStore,
    createInMemoryLinkedInAccountStore(initial),
  );

// ============================================================================
// PostgreSQL Implementation
// ============================================================================

export interface PostgresLinkedInAccountStoreOptions {
  readonly connectionString: string;
}

const ensureAccountTable = async (sql: postgres.Sql): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS linkedin_accounts (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      profile_url TEXT NOT NULL,
      weekly_invite_limit INTEGER NOT NULL DEFAULT 100,
      browser_bindings JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
};

/**
 * PostgreSQL-backed LinkedIn account store.
 *
 * Table schema:
 * ```sql
 * CREATE TABLE linkedin_accounts (
 *   id TEXT PRIMARY KEY,
 *   display_name TEXT NOT NULL,
 *   profile_url TEXT NOT NULL,
 *   weekly_invite_limit INTEGER NOT NULL DEFAULT 100,
 *   browser_bindings JSONB NOT NULL DEFAULT '[]',
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 * ```
 */
export const createPostgresLinkedInAccountStore = async (
  options: PostgresLinkedInAccountStoreOptions,
): Promise<LinkedInAccountStoreService> => {
  const sql = postgres(options.connectionString);

  await ensureAccountTable(sql);

  return {
    get: (id) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, display_name, profile_url, weekly_invite_limit, browser_bindings
            FROM linkedin_accounts
            WHERE id = ${id}
          `;

          if (rows.length === 0) {
            return Option.none<LinkedInAccount>();
          }

          const row = rows[0];
          return Option.some({
            id: AccountId(row.id),
            displayName: row.display_name,
            profileUrl: row.profile_url,
            weeklyInviteLimit: row.weekly_invite_limit,
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
            SELECT id, display_name, profile_url, weekly_invite_limit, browser_bindings
            FROM linkedin_accounts
            ORDER BY display_name
          `;

          return rows.map((row) => ({
            id: AccountId(row.id),
            displayName: row.display_name,
            profileUrl: row.profile_url,
            weeklyInviteLimit: row.weekly_invite_limit,
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
            INSERT INTO linkedin_accounts (id, display_name, profile_url, weekly_invite_limit, browser_bindings, updated_at)
            VALUES (
              ${account.id},
              ${account.displayName},
              ${account.profileUrl},
              ${account.weeklyInviteLimit},
              ${JSON.stringify(account.browserBindings)}::jsonb,
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              display_name = EXCLUDED.display_name,
              profile_url = EXCLUDED.profile_url,
              weekly_invite_limit = EXCLUDED.weekly_invite_limit,
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
          const result = await sql`
            DELETE FROM linkedin_accounts WHERE id = ${id}
          `;
          return result.count > 0;
        },
        catch: (err) => {
          throw new Error(`Failed to remove LinkedIn account: ${err}`);
        },
      }),
  };
};
