// packages/commandline/src/runtime.ts
// Runtime setup and layer composition

import { Effect, Layer, Stream } from "effect";
import {
  BrowserBackendLive,
  BrowserPool,
  type BrowserPoolService,
  makeBrowserbaseBackend,
} from "@bernays/server/backend";
import {
  type Journal,
  makeJournalLayer,
  makePlatformLayer,
  type Platform,
} from "@bernays/server/runtime";
import {
  type LinkedInAccount,
  linkedInPlatform,
} from "@bernays/plugins/linkedin";
import type {
  ConfigStoreService,
  EventStore,
  StorableEvent,
} from "@bernays/server/store";
import { config } from "./config.ts";
import { tty } from "./logger.ts";

// ============================================================================
// Browser Layer
// ============================================================================

export const createBrowserLayer = (configStore: ConfigStoreService) => {
  const backend = makeBrowserbaseBackend(config.browserbaseApiKey, configStore);
  return BrowserBackendLive(backend);
};

// ============================================================================
// Sockpuppet Layer
// ============================================================================

const createSockpuppetLayer = (
  account: LinkedInAccount,
  eventStore: EventStore<StorableEvent>,
  browserPool: BrowserPoolService,
) => {
  const platformLayer = makePlatformLayer({
    platform: linkedInPlatform,
    account,
    eventStore,
    browserPool,
  });

  const journalLayer = makeJournalLayer({
    accountId: account.id,
    eventStore,
  });

  return Layer.merge(platformLayer, journalLayer);
};

// ============================================================================
// Run Sockpuppet
// ============================================================================

export const runWithSockpuppet = <A, E>(
  sockpuppet: Effect.Effect<A, E, Platform | Journal>,
  account: LinkedInAccount,
  eventStore: EventStore<StorableEvent>,
) =>
  Effect.gen(function* () {
    const browsers = yield* BrowserPool;

    yield* Effect.fork(
      Stream.runForEach(browsers.events, (event) =>
        Effect.sync(() => tty.event(`[${event.configId}] Event`))),
    );

    const layer = createSockpuppetLayer(account, eventStore, browsers);
    yield* Effect.provide(sockpuppet, layer);
  });
