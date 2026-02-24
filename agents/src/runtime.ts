// packages/commandline/src/runtime.ts
// Runtime setup and layer composition

import { Effect, Layer } from "effect";
import {
  BrowserPool,
  BrowserPoolLive,
  type BrowserPoolService,
  makeBrowserbaseBackend,
} from "@bernays/server/browsers";
import {
  Briefing,
  type Journal,
  makeBriefingLayer,
  makeJournalLayer,
  makePlatformLayer,
} from "@bernays/server/runtime";
import {
  type LinkedInAccount,
  LinkedInPlatform,
  linkedInPlatform,
  makeLinkedInActions,
} from "@bernays/plugins/linkedin";
import type {
  ConfigStoreService,
  EventStore,
  StorableEvent,
} from "@bernays/server/store";
import { config } from "./config.ts";

// ============================================================================
// Browser Layer
// ============================================================================

export const createBrowserLayer = (configStore: ConfigStoreService) => {
  const pool = makeBrowserbaseBackend(config.browserbaseApiKey, configStore);
  return BrowserPoolLive(pool);
};

// ============================================================================
// Sockpuppet Layer
// ============================================================================

const createSockpuppetLayer = (
  account: LinkedInAccount,
  eventStore: EventStore<StorableEvent>,
  browserPool: BrowserPoolService,
) => {
  // Create typed actions for this account
  const actions = makeLinkedInActions(browserPool, account);

  // Create platform layer with typed tag
  const platformLayer = makePlatformLayer(LinkedInPlatform, {
    platform: linkedInPlatform,
    account,
    eventStore,
    browserPool,
    actions,
  });

  const journalLayer = makeJournalLayer({
    participantId: account.id,
    eventStore,
  });

  const briefingLayer = makeBriefingLayer({
    agentId: config.agentId ?? "default",
    eventStore,
  });

  return Layer.merge(Layer.merge(platformLayer, journalLayer), briefingLayer);
};

// ============================================================================
// Run Sockpuppet
// ============================================================================

export const runWithSockpuppet = <A, E>(
  sockpuppet: Effect.Effect<A, E, LinkedInPlatform | Journal | Briefing>,
  account: LinkedInAccount,
  eventStore: EventStore<StorableEvent>,
) =>
  Effect.gen(function* () {
    const pool = yield* BrowserPool;
    const layer = createSockpuppetLayer(account, eventStore, pool);
    yield* Effect.provide(sockpuppet, layer);
  });
