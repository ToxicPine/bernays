// packages/commandline/src/stores.ts
// Store initialization and seeding

import { Effect, Option } from "effect";
import {
  type ConfigStoreService,
  configurePostgresEventStore,
  createPostgresConfigStore,
} from "@bernays/server/store";
import {
  createPostgresLinkedInAccountStore,
  type LinkedInAccount,
  type LinkedInAccountStoreService,
} from "@bernays/plugins/linkedin";
import type { BrowserConfig } from "@bernays/server/backend";
import {
  BrowserConfigId,
  type BrowserConfigId as BrowserConfigIdType,
  ParticipantId,
  type ParticipantId as ParticipantIdType,
} from "@bernays/server/core";
import { config } from "./config.ts";
import { tty } from "./logger.ts";

// ============================================================================
// Ensure Records Exist
// ============================================================================

export const ensureBrowserConfig = async (
  store: ConfigStoreService,
  id: BrowserConfigIdType,
): Promise<BrowserConfig> => {
  const existing = await Effect.runPromise(store.get(id));
  if (Option.isSome(existing)) return existing.value;

  tty.info("Creating Default Browser Config...");
  const record: BrowserConfig = {
    id,
    context: config.browserbaseContextId,
    extensionIds: [],
  };
  await Effect.runPromise(store.upsert(record));
  tty.info("Browser Config Created.");
  return record;
};

export const ensureLinkedInAccount = async (
  store: LinkedInAccountStoreService,
  participantId: ParticipantIdType<"linkedin">,
  configId: BrowserConfigIdType,
): Promise<LinkedInAccount> => {
  const existing = await Effect.runPromise(store.get(participantId));
  if (Option.isSome(existing)) {
    tty.info(`Using Account '${existing.value.id}'.`);
    return existing.value;
  }

  tty.info("Creating Default LinkedIn Account...");
  const record: LinkedInAccount = {
    id: participantId,
    browserBindings: [{ configId, metadata: { deviceType: "desktop" } }],
  };
  await Effect.runPromise(store.upsert(record));
  tty.info(`Account '${participantId}' created.`);
  return record;
};

// ============================================================================
// Initialize All Stores
// ============================================================================

export const initializeStores = async () => {
  const databaseUrl = config.databaseUrl;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const configStore = await createPostgresConfigStore({
    connectionString: databaseUrl,
  });
  const accountStore = await createPostgresLinkedInAccountStore({
    connectionString: databaseUrl,
  });
  const eventStore = await Effect.runPromise(
    configurePostgresEventStore({ databaseUrl }),
  );

  const configId = BrowserConfigId("main");
  const participantId = ParticipantId("linkedin", config.accountId);

  await ensureBrowserConfig(configStore, configId);
  const account = await ensureLinkedInAccount(
    accountStore,
    participantId,
    configId,
  );

  return { configStore, accountStore, eventStore, account };
};
