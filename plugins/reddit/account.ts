// plugins/reddit/account.ts
// Reddit account binding - maps a persistent platform ID to browser sessions

import { Context, Layer } from "effect";
import {
  type AccountStoreService,
  createPlatformAccountStore,
} from "@bernays/server/core";
import { type BaseAccount } from "@bernays/server/views";

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
 * state that should be derived from events via RedditContact, not stored here.
 */
export interface RedditAccount extends BaseAccount<"reddit"> {}

// =============================================================================
// Account Store
// =============================================================================

export type RedditAccountStoreService = AccountStoreService<
  "reddit",
  RedditAccount
>;

export class RedditAccountStore extends Context.Tag("RedditAccountStore")<
  RedditAccountStore,
  RedditAccountStoreService
>() {}

// =============================================================================
// Store Factory
// =============================================================================

const redditAccountStore = createPlatformAccountStore<"reddit", RedditAccount>({
  tableName: "reddit_accounts",
  scope: "reddit",
  displayName: "Reddit",
});

// =============================================================================
// In-Memory Implementation
// =============================================================================

export const makeInMemoryRedditAccountStoreLayer = (
  initial: readonly RedditAccount[] = [],
): Layer.Layer<RedditAccountStore> =>
  Layer.succeed(RedditAccountStore, redditAccountStore.createInMemory(initial));

// =============================================================================
// PostgreSQL Implementation
// =============================================================================

export interface PostgresRedditAccountStoreOptions {
  readonly connectionString: string;
}

export const createPostgresRedditAccountStore = async (
  options: PostgresRedditAccountStoreOptions,
): Promise<RedditAccountStoreService> =>
  redditAccountStore.createPostgres(options);
