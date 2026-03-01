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
  LinkedInInjection,
  LinkedInPlatform,
  linkedInPlatform,
  LinkedInProjection,
  makeLinkedInActions,
  makeLinkedInSync,
} from "@bernays/plugins/linkedin";
import { type EventStoreTag } from "@bernays/server/store";
import { config } from "./config.ts";

// ============================================================================
// Browser Layer
// ============================================================================

export const createBrowserLayer = (
  configStore: import("@bernays/server/store").ConfigStoreService,
) => {
  const pool = makeBrowserbaseBackend(config.browserbaseApiKey, configStore);
  return BrowserPoolLive(pool);
};

// ============================================================================
// Sockpuppet Layer
// ============================================================================

const createSockpuppetLayer = (
  account: LinkedInAccount,
  eventStoreLayer: Layer.Layer<EventStoreTag>,
  browserPool: BrowserPoolService,
) => {
  const actions = makeLinkedInActions(browserPool, account);

  // platformLayer creates LinkedIn injection/projection internally and exports them.
  // Sync fiber is forked internally by makePlatformLayer — it yields BrowserPool
  // and Injector from context.
  const platformLayer = makePlatformLayer(
    LinkedInPlatform,
    LinkedInInjection,
    LinkedInProjection,
    {
      platform: linkedInPlatform,
      account,
      actions,
      sync: makeLinkedInSync,
    },
  );

  // All layers create their own injection/projection internally - only need EventStoreTag
  const journalLayer = makeJournalLayer(account.id);
  const briefingLayer = makeBriefingLayer(config.agentId);
  const browserPoolLayer = Layer.succeed(BrowserPool, browserPool);

  const serviceLayer = Layer.mergeAll(
    platformLayer,
    journalLayer,
    briefingLayer,
  ).pipe(
    Layer.provide(eventStoreLayer),
    Layer.provide(browserPoolLayer),
  );

  return serviceLayer;
};

// ============================================================================
// Run Sockpuppet
// ============================================================================

export const runWithSockpuppet = <A, E>(
  sockpuppet: Effect.Effect<A, E, LinkedInPlatform | Journal | Briefing>,
  account: LinkedInAccount,
  eventStoreLayer: Layer.Layer<EventStoreTag>,
) =>
  Effect.gen(function* () {
    const pool = yield* BrowserPool;
    const layer = createSockpuppetLayer(account, eventStoreLayer, pool);
    yield* Effect.provide(sockpuppet, layer);
  });
