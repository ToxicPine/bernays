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
import {
  type ConfigStoreService,
  EventStoreLive,
  type EventStore,
  type StorableEvent,
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

  // EventStore Effect layer from the plain instance
  const eventStoreLayer = EventStoreLive(eventStore);

  // Platform layer — depends on LinkedInProjection + BrowserPool
  const platformLayer = makePlatformLayer(LinkedInPlatform, LinkedInProjection, {
    platform: linkedInPlatform,
    account,
    actions,
  });

  // Journal layer — depends on JournalInjection + JournalProjection
  const journalLayer = makeJournalLayer(account.id);

  // Briefing layer — depends on BriefingInjection + BriefingProjection
  const briefingLayer = makeBriefingLayer(config.agentId);

  // BrowserPool layer
  const browserPoolLayer = Layer.succeed(BrowserPool, browserPool);

  // Compose: all Injection/Projection layers depend on EventStoreTag
  const injectionProjectionLayers = Layer.mergeAll(
    LinkedInInjectionLive,
    LinkedInProjectionLive,
    JournalInjectionLive,
    JournalProjectionLive,
    BriefingInjectionLive,
    BriefingProjectionLive,
  ).pipe(Layer.provide(eventStoreLayer));

  // Services depend on their Injection/Projection + BrowserPool
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
  eventStore: EventStore<StorableEvent>,
) =>
  Effect.gen(function* () {
    const pool = yield* BrowserPool;
    const layer = createSockpuppetLayer(account, eventStore, pool);
    yield* Effect.provide(sockpuppet, layer);
  });
