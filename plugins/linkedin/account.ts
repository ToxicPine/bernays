// plugins/linkedin/account.ts
// LinkedIn account store — maps persistent platform IDs to browser sessions

import { Context, Effect, Layer, Option } from "effect";
import postgres from "postgres";
import {
  BrowserConfigId,
  ParticipantIdFromString,
} from "@bernays/server/core";
import type { ParticipantId } from "@bernays/server/core";
import { type BaseAccount, parseBrowserBindings } from "@bernays/server/views";

// =============================================================================
// LinkedIn Account
// =============================================================================

/**
 * LinkedIn account binding.
 *
 * Contains ONLY:
 * - `id`: The persistent LinkedIn member ID (prefixed with "linkedin:")
 * - `browserBindings`: Which browser sessions are logged into this account
 *
 * Everything else (display name, connection count, rate limits, etc.) is
 * dynamic platform state derived from events, not stored here.
 */
export interface LinkedInAccount extends BaseAccount<"linkedin"> {}

// =============================================================================
// Account Store Service
// =============================================================================

export interface LinkedInAccountStoreService {
  readonly get: (
    id: ParticipantId<"linkedin">,
  ) => Effect.Effect<Option.Option<LinkedInAccount>>;
  readonly list: () => Effect.Effect<readonly LinkedInAccount[]>;
  readonly upsert: (account: LinkedInAccount) => Effect.Effect<void>;
  readonly remove: (
    id: ParticipantId<"linkedin">,
  ) => Effect.Effect<boolean>;
}

export class LinkedInAccountStore extends Context.Tag("LinkedInAccountStore")<
  LinkedInAccountStore,
  LinkedInAccountStoreService
>() {}

// =============================================================================
// In-Memory Implementation
// =============================================================================

export const createInMemoryLinkedInAccountStore = (
  initial: readonly LinkedInAccount[] = [],
): LinkedInAccountStoreService => {
  const items = new Map<string, LinkedInAccount>(
    initial.map((a) => [a.id, a]),
  );

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

export const makeInMemoryLinkedInAccountStoreLayer = (
  initial: readonly LinkedInAccount[] = [],
): Layer.Layer<LinkedInAccountStore> =>
  Layer.succeed(
    LinkedInAccountStore,
    createInMemoryLinkedInAccountStore(initial),
  );

// =============================================================================
// PostgreSQL Implementation
// =============================================================================

export interface PostgresLinkedInAccountStoreOptions {
  readonly connectionString: string;
}

const ensureTable = async (sql: postgres.Sql): Promise<void> => {
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

  await ensureTable(sql);

  return {
    get: (id) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, browser_bindings
            FROM linkedin_accounts
            WHERE id = ${id}
          `;
          if (rows.length === 0) return Option.none<LinkedInAccount>();
          const row = rows[0];
          return Option.some({
            id: ParticipantIdFromString<"linkedin">(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          });
        },
        catch: (err) => {
          throw new Error(`Failed To Get LinkedIn Account: ${err}`);
        },
      }),

    list: () =>
      Effect.tryPromise({
        try: async () => {
          const rows = await sql`
            SELECT id, browser_bindings
            FROM linkedin_accounts
            ORDER BY id
          `;
          return rows.map((row) => ({
            id: ParticipantIdFromString<"linkedin">(row.id),
            browserBindings: parseBrowserBindings(row.browser_bindings),
          }));
        },
        catch: (err) => {
          throw new Error(`Failed To List LinkedIn Accounts: ${err}`);
        },
      }),

    upsert: (account) =>
      Effect.tryPromise({
        try: async () => {
          await sql`
            INSERT INTO linkedin_accounts (id, browser_bindings, updated_at)
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
          throw new Error(`Failed To Upsert LinkedIn Account: ${err}`);
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
          throw new Error(`Failed To Remove LinkedIn Account: ${err}`);
        },
      }),
  };
};
