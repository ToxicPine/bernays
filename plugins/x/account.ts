// src/platforms/x/account.ts
// X (Twitter) account type and storage

import { Context, Effect, Layer, Option } from "effect";
import { type AccountId as AccountIdType } from "@bernays/server/core";
import { createInMemoryStore } from "@bernays/server/core";
import type { BaseAccount, BrowserBinding } from "@bernays/server/views";

// ============================================================================
// X Account
// ============================================================================

export interface XAccount extends BaseAccount {
  readonly id: AccountIdType;
  readonly browserBindings: readonly BrowserBinding[];
  readonly handle: string;
  readonly isVerified: boolean;
}

// ============================================================================
// X Account Store
// ============================================================================

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
