import { parse as parseToml } from "@std/toml";
import { z } from "@zod/zod";
import { Effect } from "effect";
import { BrowserConfigId, ParticipantIdFromString } from "@bernays/server/core";
import type { LinkedInAccount, LinkedInAccountStoreService } from "./account.ts";

// =============================================================================
// Schemas
// =============================================================================

const stripQuotes = (s: string) =>
  s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;

const TomlBrowserBindingSchema = z.object({
  configId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const LinkedInCredentialsSchema = z.object({
  li_at: z.string().min(1, "li_at must be a non-empty string"),
  JSESSIONID: z.string().min(1, "JSESSIONID must be a non-empty string")
    .transform(stripQuotes),
});

export type LinkedInCredentials = z.infer<typeof LinkedInCredentialsSchema>;

const TomlAccountSchema = z.object({
  /** LinkedIn member ID (without "linkedin:" prefix) */
  id: z.string().min(1, "Account id is required"),
  /** Session token — required for account to be usable */
  li_at: z.string().min(1).optional(),
  /** CSRF token — required for API calls */
  JSESSIONID: z.string().min(1).transform(stripQuotes).optional(),
  /** When credentials were extracted */
  extractedAt: z.string().optional(),
  /** Browser bindings */
  browserBindings: z.array(TomlBrowserBindingSchema).optional().default([]),
});

type TomlAccount = z.infer<typeof TomlAccountSchema>;

const TomlConfigSchema = z.object({
  accounts: z.array(TomlAccountSchema),
});

// =============================================================================
// Result Types
// =============================================================================

/** Credentials keyed by account ID (with "linkedin:" prefix). */
export type CredentialsMap = ReadonlyMap<string, LinkedInCredentials>;

export interface LoadResult {
  readonly accounts: readonly LinkedInAccount[];
  readonly credentials: CredentialsMap;
}

// =============================================================================
// Loader
// =============================================================================

/**
 * Load LinkedIn accounts from a TOML file and upsert to the account store.
 *
 * Returns both the upserted accounts and a map of credentials for accounts
 * that had li_at/JSESSIONID defined. Credentials are NOT stored in the
 * account store — they're returned for injection into browser contexts.
 *
 * @param path - Path to the TOML file
 * @param store - Account store service (optional — if not provided, accounts are parsed but not upserted)
 */
export const loadLinkedInAccountsFromToml = async (
  path: string,
  store?: LinkedInAccountStoreService,
): Promise<LoadResult> => {
  const text = await Deno.readTextFile(path);
  const parsed = parseToml(text);
  const config = TomlConfigSchema.parse(parsed);

  const accounts: LinkedInAccount[] = [];
  const credentials = new Map<string, LinkedInCredentials>();

  for (const entry of config.accounts) {
    const account = tomlEntryToAccount(entry);
    accounts.push(account);

    if (entry.li_at && entry.JSESSIONID) {
      credentials.set(account.id, {
        li_at: entry.li_at,
        JSESSIONID: stripQuotes(entry.JSESSIONID),
      });
    }

    if (store) {
      await Effect.runPromise(store.upsert(account));
    }
  }

  return { accounts, credentials };
};

export const parseLinkedInAccountsToml = (
  tomlText: string,
): { accounts: readonly TomlAccount[] } => {
  const parsed = parseToml(tomlText);
  return TomlConfigSchema.parse(parsed);
};

// =============================================================================
// Helpers
// =============================================================================

const tomlEntryToAccount = (entry: TomlAccount): LinkedInAccount => ({
  id: ParticipantIdFromString<"linkedin">(`linkedin:${entry.id}`),
  browserBindings: entry.browserBindings.map((b) => ({
    configId: BrowserConfigId(b.configId),
    metadata: b.metadata,
  })),
});

export const getCredentials = (
  credentials: CredentialsMap,
  accountId: string,
): LinkedInCredentials | undefined => {
  const prefixedId = accountId.startsWith("linkedin:")
    ? accountId
    : `linkedin:${accountId}`;
  return credentials.get(prefixedId);
};
