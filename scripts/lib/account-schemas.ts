// scripts/lib/account-schemas.ts
// Zod schemas for TOML-based account validation

import { z } from "@zod/zod";
import {
  AccountId,
  BrowserConfigId,
  type AccountId as AccountIdType,
  type BrowserConfigId as BrowserConfigIdType,
} from "@bernays/server/core";

import type { LinkedInAccount } from "@bernays/plugins/linkedin";
import type { XAccount } from "@bernays/plugins/x";

// =============================================================================
// Browser Binding Schema
// =============================================================================

export const BrowserBindingTomlSchema = z.object({
  configId: z.string().transform((val): BrowserConfigIdType => BrowserConfigId(val)),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// =============================================================================
// Account Schema (shared by all platforms)
// =============================================================================

/**
 * Account schema - minimal binding of platform ID to browser sessions.
 *
 * Accounts contain ONLY:
 * - `id`: Persistent platform identifier (doesn't change)
 * - `browserBindings`: Which browsers are logged into this account
 *
 * Everything else (display names, follower counts, rate limits, handles, etc.)
 * is dynamic platform state derived from events.
 */
export const AccountTomlSchema = z.object({
  id: z.string().transform((val): AccountIdType => AccountId(val)),
  browserBindings: z.array(BrowserBindingTomlSchema).default([]),
});

export type AccountToml = z.infer<typeof AccountTomlSchema>;

export const AccountsTomlFileSchema = z.object({
  accounts: z.array(AccountTomlSchema),
});

export type AccountsTomlFile = z.infer<typeof AccountsTomlFileSchema>;

export const LinkedInTomlFileSchema = AccountsTomlFileSchema;
export const XTomlFileSchema = AccountsTomlFileSchema;

// =============================================================================
// Converters
// =============================================================================

export const toLinkedInAccount = (toml: AccountToml): LinkedInAccount => ({
  id: toml.id,
  browserBindings: toml.browserBindings.map((b) => ({
    configId: b.configId,
    metadata: b.metadata,
  })),
});

export const toXAccount = (toml: AccountToml): XAccount => ({
  id: toml.id,
  browserBindings: toml.browserBindings.map((b) => ({
    configId: b.configId,
    metadata: b.metadata,
  })),
});

export const fromLinkedInAccount = (account: LinkedInAccount): Record<string, unknown> => ({
  id: account.id as string,
  browserBindings: account.browserBindings.map((b) => ({
    configId: b.configId as string,
    metadata: b.metadata,
  })),
});

export const fromXAccount = (account: XAccount): Record<string, unknown> => ({
  id: account.id as string,
  browserBindings: account.browserBindings.map((b) => ({
    configId: b.configId as string,
    metadata: b.metadata,
  })),
});
