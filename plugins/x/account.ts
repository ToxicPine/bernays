// src/platforms/x/account.ts
// X (Twitter) account type and storage

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
// API Tier
// ============================================================================

export type XApiTier = "free" | "basic" | "pro" | "enterprise";

// ============================================================================
// X Account
// ============================================================================

/**
 * X account - extends BaseAccount with X-specific fields.
 */
export interface XAccount extends BaseAccount {
  readonly id: AccountIdType;
  readonly browserBindings: readonly BrowserBinding[];

  // X-specific fields
  readonly handle: string;
  readonly displayName: string;
  readonly isVerified: boolean;
  readonly followerCount: number;
  readonly followingCount: number;
  readonly apiTier: XApiTier;
}

// ============================================================================
// X Account Store
// ============================================================================

export interface XAccountStoreService {
  readonly get: (
    id: AccountIdType,
  ) => Effect.Effect<Option.Option<XAccount>>;
  readonly list: () => Effect.Effect<readonly XAccount[]>;
  readonly upsert: (account: XAccount) => Effect.Effect<void>;
  readonly remove: (id: AccountIdType) => Effect.Effect<boolean>;
}

export class XAccountStore extends Context.Tag("XAccountStore")<
  XAccountStore,
  XAccountStoreService
>() {}

// ============================================================================
// In-Memory Implementation
// ============================================================================

/**
 * Create an in-memory X account store.
 * Uses the generic createInMemoryStore factory.
 */
const createInMemoryXAccountStore = (
  initial: readonly XAccount[] = [],
): XAccountStoreService => createInMemoryStore<XAccount>(initial);

export const makeInMemoryXAccountStoreLayer = (
  initial: readonly XAccount[] = [],
): Layer.Layer<XAccountStore> =>
  Layer.succeed(XAccountStore, createInMemoryXAccountStore(initial));

// ============================================================================
// PostgreSQL Implementation
// ============================================================================

export interface PostgresXAccountStoreOptions {
  readonly connectionString: string;
}

/**
 * PostgreSQL-backed X account store.
 *
 * Table schema:
 * ```sql
 * CREATE TABLE x_accounts (
 *   id TEXT PRIMARY KEY,
 *   handle TEXT NOT NULL,
 *   display_name TEXT NOT NULL,
 *   is_verified BOOLEAN NOT NULL DEFAULT FALSE,
 *   follower_count INTEGER NOT NULL DEFAULT 0,
 *   following_count INTEGER NOT NULL DEFAULT 0,
 *   api_tier TEXT NOT NULL DEFAULT 'free',
 *   browser_bindings JSONB NOT NULL DEFAULT '[]',
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 * ```
 */
export const createPostgresXAccountStore = async (
  options: PostgresXAccountStoreOptions,
): Promise<XAccountStoreService> => {
  const postgres = await import("npm:postgres").then((m) => m.default);
  const sql = postgres(options.connectionString);

  return {
    get: (id) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, handle, display_name, is_verified, follower_count, following_count, api_tier, browser_bindings
            FROM x_accounts
            WHERE id = ${id}
          `;

          if (rows.length === 0) {
            return Option.none<XAccount>();
          }

          const row = rows[0];
          return Option.some({
            id: AccountId(row.id),
            handle: row.handle,
            displayName: row.display_name,
            isVerified: row.is_verified,
            followerCount: row.follower_count,
            followingCount: row.following_count,
            apiTier: row.api_tier as XApiTier,
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
            SELECT id, handle, display_name, is_verified, follower_count, following_count, api_tier, browser_bindings
            FROM x_accounts
            ORDER BY handle
          `;

          return rows.map((row) => ({
            id: AccountId(row.id),
            handle: row.handle,
            displayName: row.display_name,
            isVerified: row.is_verified,
            followerCount: row.follower_count,
            followingCount: row.following_count,
            apiTier: row.api_tier as XApiTier,
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
            INSERT INTO x_accounts (id, handle, display_name, is_verified, follower_count, following_count, api_tier, browser_bindings, updated_at)
            VALUES (
              ${account.id},
              ${account.handle},
              ${account.displayName},
              ${account.isVerified},
              ${account.followerCount},
              ${account.followingCount},
              ${account.apiTier},
              ${JSON.stringify(account.browserBindings)}::jsonb,
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              handle = EXCLUDED.handle,
              display_name = EXCLUDED.display_name,
              is_verified = EXCLUDED.is_verified,
              follower_count = EXCLUDED.follower_count,
              following_count = EXCLUDED.following_count,
              api_tier = EXCLUDED.api_tier,
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
          const result = await sql`
            DELETE FROM x_accounts WHERE id = ${id}
          `;
          return result.count > 0;
        },
        catch: (err) => {
          throw new Error(`Failed to remove X account: ${err}`);
        },
      }),
  };
};
