// scripts/lib/account-schemas.ts
// Zod schemas and store factory registry for TOML-based account loading

import { z } from "@zod/zod";
import {
  BrowserConfigId,
  type BrowserConfigId as BrowserConfigIdType,
  type ParticipantId as ParticipantIdType,
  ParticipantIdFromString,
} from "@bernays/server/core";
import type { BaseAccount } from "@bernays/server/views";

import { createPostgresLinkedInAccountStore } from "@bernays/plugins/linkedin";
import { createPostgresXAccountStore } from "@bernays/plugins/x";

// =============================================================================
// Browser Binding Schema
// =============================================================================

export const BrowserBindingTomlSchema = z.object({
  configId: z.string().transform((val): BrowserConfigIdType =>
    BrowserConfigId(val)
  ),
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
  id: z.string().transform((val): ParticipantIdType =>
    ParticipantIdFromString(val)
  ),
  browserBindings: z.array(BrowserBindingTomlSchema).default([]),
});

export type AccountToml = z.infer<typeof AccountTomlSchema>;

export const AccountsTomlFileSchema = z.object({
  accounts: z.array(AccountTomlSchema),
});

export type AccountsTomlFile = z.infer<typeof AccountsTomlFileSchema>;

// =============================================================================
// Generic Converters
// =============================================================================

/**
 * Convert parsed TOML account to BaseAccount.
 * Works for any platform since BaseAccount structure is identical.
 */
export const toAccount = (toml: AccountToml): BaseAccount => ({
  id: toml.id,
  browserBindings: toml.browserBindings.map((b) => ({
    configId: b.configId,
    metadata: b.metadata,
  })),
});

/**
 * Convert BaseAccount to TOML-serializable format.
 * Works for any platform since BaseAccount structure is identical.
 */
export const fromAccount = (account: BaseAccount): Record<string, unknown> => ({
  id: account.id as string,
  browserBindings: account.browserBindings.map((b) => ({
    configId: b.configId as string,
    metadata: b.metadata,
  })),
});

// =============================================================================
// Store Interface (matches what postgres stores return)
// =============================================================================

// =============================================================================
// Platform Store Factories
// =============================================================================
//
// Each platform has its own store factory with proper typing.
// Use getStoreFactory(platform) to get the factory for runtime dispatch.

import type {
  LinkedInAccountStoreService,
  PostgresLinkedInAccountStoreOptions,
} from "@bernays/plugins/linkedin";
import type {
  PostgresXAccountStoreOptions,
  XAccountStoreService,
} from "@bernays/plugins/x";

/**
 * Platform store map with proper types for each platform.
 * Use platformStores[platform] and check the platform at runtime.
 */
export const platformStores = {
  linkedin: {
    create: createPostgresLinkedInAccountStore,
  } satisfies {
    create: (
      opts: PostgresLinkedInAccountStoreOptions,
    ) => Promise<LinkedInAccountStoreService>;
  },
  x: {
    create: createPostgresXAccountStore,
  } satisfies {
    create: (
      opts: PostgresXAccountStoreOptions,
    ) => Promise<XAccountStoreService>;
  },
};

export type SupportedPlatform = keyof typeof platformStores;

/**
 * Get list of supported platform names.
 */
export const supportedPlatforms = (): SupportedPlatform[] =>
  Object.keys(platformStores) as SupportedPlatform[];

/**
 * Check if a platform is supported.
 */
export const isSupportedPlatform = (
  platform: string,
): platform is SupportedPlatform => platform in platformStores;

/**
 * Get store for a platform. Returns undefined if not supported.
 * Use isSupportedPlatform() first to narrow the type.
 */
export const getStore = <P extends SupportedPlatform>(platform: P) =>
  platformStores[platform];

// =============================================================================
// Legacy Exports (for backwards compatibility)
// =============================================================================

export const LinkedInTomlFileSchema = AccountsTomlFileSchema;
export const XTomlFileSchema = AccountsTomlFileSchema;
export const toLinkedInAccount = toAccount;
export const toXAccount = toAccount;
export const fromLinkedInAccount = fromAccount;
export const fromXAccount = fromAccount;
