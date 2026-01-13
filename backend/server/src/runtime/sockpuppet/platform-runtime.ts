// src/runtime/sockpuppet/platform-runtime.ts
// Platform service layer for sockpuppets (new architecture)

import { Effect, Layer, Option } from "effect";
import type { BrowserConfigId, Scope, ThreadId } from "$/core/branded.ts";
import type { EventStore, StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import { BrowserPool, type BrowserPoolService } from "$/backend/mod.ts";
import type { BaseIntent, PlatformDefinition } from "$/platforms/mod.ts";
import { makeProjection } from "$/projections/projection.ts";
import { Platform, type PlatformServiceInterface } from "./services.ts";

// Platform Runtime Configuration

export interface PlatformRuntimeConfig<
  TScope extends Scope,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TIntent extends BaseIntent<TScope>,
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount,
  TBrowser extends BaseBoundBrowser,
> {
  readonly platform: PlatformDefinition<
    TScope,
    TEvent,
    TIntent,
    TAnchor,
    TThread,
    TInbox,
    TAccount,
    TBrowser
  >;
  readonly account: TAccount;
  readonly eventStore: EventStore<StorableEvent>;
  readonly browserPool: BrowserPoolService;
}

// Platform Layer

/**
 * Create a Platform service implementation from config.
 */
export const makePlatformService = <
  TScope extends Scope,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TIntent extends BaseIntent<TScope>,
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount,
  TBrowser extends BaseBoundBrowser,
>(
  config: PlatformRuntimeConfig<
    TScope,
    TEvent,
    TIntent,
    TAnchor,
    TThread,
    TInbox,
    TAccount,
    TBrowser
  >,
): PlatformServiceInterface => {
  const { platform, account, eventStore, browserPool } = config;
  const behavior = platform.behavior;

  const projection = makeProjection(
    platform.scope,
    platform.eventSchema,
    eventStore,
  );

  const getRunningConfigIds = Effect.gen(function* () {
    const results = yield* Effect.forEach(
      account.browserBindings,
      (binding) =>
        Effect.gen(function* () {
          const running = yield* browserPool.isRunning(binding.configId);
          return running ? binding.configId : null;
        }),
    );
    return new Set(
      results.filter((id): id is BrowserConfigId => id !== null),
    );
  });

  return {
    scope: platform.scope,
    accountId: account.id,
    account,

    inbox: Effect.gen(function* () {
      const events = yield* projection.query();
      return behavior.deriveInbox(events, account.id) as BaseInboxView<unknown>;
    }),

    thread: (threadId: ThreadId) =>
      Effect.gen(function* () {
        const events = yield* projection.query();
        const thread = behavior.deriveThread(events, threadId);
        return Option.fromNullable(thread as BaseThreadView<unknown> | null);
      }),

    browsers: Effect.gen(function* () {
      const events = yield* projection.query();
      const runningIds = yield* getRunningConfigIds;
      return behavior.deriveBrowsers(
        events,
        account,
        runningIds,
      ) as readonly BaseBoundBrowser[];
    }),

    execute: (
      intent: BaseIntent,
      options?: { preferConfigId?: BrowserConfigId },
    ) =>
      Effect.gen(function* () {
        const events = yield* projection.query();
        const runningIds = yield* getRunningConfigIds;
        const browsers = behavior.deriveBrowsers(events, account, runningIds);

        // Cast intent to platform-specific type
        const typedIntent = intent as TIntent;

        // Execute via behavior, providing BrowserPool
        const result = yield* behavior
          .execute(typedIntent, browsers, options?.preferConfigId)
          .pipe(
            Effect.provideService(BrowserPool, browserPool),
          );

        return result;
      }),
  };
};

/**
 * Create a Layer that provides the Platform service.
 */
export const makePlatformLayer = <
  TScope extends Scope,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TIntent extends BaseIntent<TScope>,
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount,
  TBrowser extends BaseBoundBrowser,
>(
  config: PlatformRuntimeConfig<
    TScope,
    TEvent,
    TIntent,
    TAnchor,
    TThread,
    TInbox,
    TAccount,
    TBrowser
  >,
): Layer.Layer<Platform> =>
  Layer.succeed(Platform, makePlatformService(config));
