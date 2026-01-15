// plugins/linkedin/account.ts
// LinkedIn account binding - maps a persistent platform ID to browser sessions

import { Context, Layer } from "effect";
import {
  type AccountStoreService,
  createPlatformAccountStore,
} from "@bernays/server/core";
import { type BaseAccount } from "@bernays/server/views";

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
 * dynamic platform state that should be derived from events, not stored here.
 */
export interface LinkedInAccount extends BaseAccount<"linkedin"> {}

// =============================================================================
// Account Store
// =============================================================================

export type LinkedInAccountStoreService = AccountStoreService<
  "linkedin",
  LinkedInAccount
>;

export class LinkedInAccountStore extends Context.Tag("LinkedInAccountStore")<
  LinkedInAccountStore,
  LinkedInAccountStoreService
>() {}

// =============================================================================
// Store Factory
// =============================================================================

const linkedInAccountStore = createPlatformAccountStore<
  "linkedin",
  LinkedInAccount
>({
  tableName: "linkedin_accounts",
  scope: "linkedin",
  displayName: "LinkedIn",
});

// =============================================================================
// In-Memory Implementation
// =============================================================================

export const makeInMemoryLinkedInAccountStoreLayer = (
  initial: readonly LinkedInAccount[] = [],
): Layer.Layer<LinkedInAccountStore> =>
  Layer.succeed(
    LinkedInAccountStore,
    linkedInAccountStore.createInMemory(initial),
  );

// =============================================================================
// PostgreSQL Implementation
// =============================================================================

export interface PostgresLinkedInAccountStoreOptions {
  readonly connectionString: string;
}

export const createPostgresLinkedInAccountStore = async (
  options: PostgresLinkedInAccountStoreOptions,
): Promise<LinkedInAccountStoreService> =>
  linkedInAccountStore.createPostgres(options);
