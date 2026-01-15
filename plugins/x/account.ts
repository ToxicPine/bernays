// plugins/x/account.ts
// X account binding - maps a persistent platform ID to browser sessions

import { Context, Layer } from "effect";
import {
  type AccountStoreService,
  createPlatformAccountStore,
} from "@bernays/server/core";
import { type BaseAccount } from "@bernays/server/views";

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
export interface XAccount extends BaseAccount<"x"> {}

// =============================================================================
// Account Store
// =============================================================================

export type XAccountStoreService = AccountStoreService<"x", XAccount>;

export class XAccountStore extends Context.Tag("XAccountStore")<
  XAccountStore,
  XAccountStoreService
>() {}

// =============================================================================
// Store Factory
// =============================================================================

const xAccountStore = createPlatformAccountStore<"x", XAccount>({
  tableName: "x_accounts",
  scope: "x",
  displayName: "X",
});

// =============================================================================
// In-Memory Implementation
// =============================================================================

export const makeInMemoryXAccountStoreLayer = (
  initial: readonly XAccount[] = [],
): Layer.Layer<XAccountStore> =>
  Layer.succeed(XAccountStore, xAccountStore.createInMemory(initial));

// =============================================================================
// PostgreSQL Implementation
// =============================================================================

export interface PostgresXAccountStoreOptions {
  readonly connectionString: string;
}

export const createPostgresXAccountStore = async (
  options: PostgresXAccountStoreOptions,
): Promise<XAccountStoreService> => xAccountStore.createPostgres(options);
