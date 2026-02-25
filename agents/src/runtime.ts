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
  BriefingInjectionLive,
  BriefingProjectionLive,
  type Journal,
  JournalInjectionLive,
  JournalProjectionLive,
  makeBriefingLayer,
  makeJournalLayer,
  makePlatformLayer,
} from "@bernays/server/runtime";
import {
  type LinkedInAccount,
  LinkedInInjectionLive,
  LinkedInPlatform,
  LinkedInProjection,
  LinkedInProjectionLive,
  linkedInPlatform,
  makeLinkedInActions,
} from "@bernays/plugins/linkedin";
import { type EventStoreTag } from "@bernays/server/store";
import { config } from "./config.ts";

// ============================================================================
// Browser Layer
// ============================================================================

export const createBrowserLayer = (configStore: import("@bernays/server/store").ConfigStoreService) => {
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

  const platformLayer = makePlatformLayer(LinkedInPlatform, LinkedInProjection, {
    platform: linkedInPlatform,
    account,
    actions,
  });

  const journalLayer = makeJournalLayer(account.id);
  const briefingLayer = makeBriefingLayer(config.agentId);
  const browserPoolLayer = Layer.succeed(BrowserPool, browserPool);

  const injectionProjectionLayers = Layer.mergeAll(
    LinkedInInjectionLive,
    LinkedInProjectionLive,
    JournalInjectionLive,
    JournalProjectionLive,
    BriefingInjectionLive,
    BriefingProjectionLive,
  ).pipe(Layer.provide(eventStoreLayer));

  const serviceLayer = Layer.mergeAll(
    platformLayer,
    journalLayer,
    briefingLayer,
  ).pipe(
    Layer.provide(injectionProjectionLayers),
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
