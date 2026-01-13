// src/platform/service.ts
// Platform service - what sockpuppets use

import { Context, Effect, Option } from "effect";
import type {
  AccountId,
  BrowserConfigId,
  Scope,
  ThreadId,
} from "$/core/branded.ts";
import type { EventStoreError, StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import { BrowserPool } from "$/backend/mod.ts";
import type { Projection } from "$/projections/projection.ts";
import type {
  BaseIntent,
  ExecuteError,
  PlatformDefinition,
} from "$/platforms/mod.ts";

// Platform Service Interface

/**
 * PlatformService is what sockpuppets use to interact with a platform.
 * It combines projection, behavior, and browser pool into a clean interface.
 *
 * The sockpuppet sees:
 * - inbox: thread summaries
 * - thread(id): full thread view
 * - browsers: available browsers with platform-specific status
 * - execute(intent): run an intent via a browser
 */
export interface PlatformService<
  _TEvent extends StorableEvent,
  TIntent extends BaseIntent,
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount,
  TBrowser extends BaseBoundBrowser,
> {
  readonly scope: Scope;
  readonly accountId: AccountId;
  readonly account: TAccount;

  /** Get the inbox view (thread summaries) */
  readonly inbox: Effect.Effect<TInbox, EventStoreError>;

  /** Get a specific thread view */
  readonly thread: (
    id: ThreadId,
  ) => Effect.Effect<Option.Option<TThread>, EventStoreError>;

  /** Get available browsers with platform-specific status */
  readonly browsers: Effect.Effect<readonly TBrowser[], EventStoreError>;

  /** Execute an intent via a browser */
  readonly execute: (
    intent: TIntent,
    options?: { preferConfigId?: BrowserConfigId },
  ) => Effect.Effect<
    { usedConfigId: BrowserConfigId },
    ExecuteError | EventStoreError
  >;
}

// Platform Service Factory

/**
 * Creates a PlatformService for a specific platform and account.
 *
 * @param platform - The platform definition
 * @param account - The account to create the service for
 * @param projection - Type-safe projection for this platform's events
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
  platform: PlatformDefinition<
    TScope,
    TEvent,
    TIntent,
    TAnchor,
    TThread,
    TInbox,
    TAccount,
    TBrowser
  >,
  account: TAccount,
  projection: Projection<TEvent>,
): Effect.Effect<
  PlatformService<
    TEvent,
    TIntent,
    TAnchor,
    TThread,
    TInbox,
    TAccount,
    TBrowser
  >,
  never,
  BrowserPool
> =>
  Effect.gen(function* () {
    const pool = yield* BrowserPool;
    const behavior = platform.behavior;

    // Helper to query events
    const queryEvents = projection.query();

    // Helper to get running browser config IDs
    const getRunningConfigIds = Effect.gen(function* () {
      const results = yield* Effect.forEach(
        account.browserBindings,
        (binding) =>
          Effect.gen(function* () {
            const running = yield* pool.isRunning(binding.configId);
            return running ? binding.configId : null;
          }),
      );
      return new Set(
        results.filter(
          (id): id is BrowserConfigId => id !== null,
        ),
      );
    });

    // Derive browsers from events
    const getBrowsers = Effect.gen(function* () {
      const events = yield* queryEvents;
      const runningIds = yield* getRunningConfigIds;
      return behavior.deriveBrowsers(events, account, runningIds);
    });

    return {
      scope: platform.scope,
      accountId: account.id,
      account,

      inbox: Effect.gen(function* () {
        const events = yield* queryEvents;
        return behavior.deriveInbox(events, account.id);
      }),

      thread: (threadId) =>
        Effect.gen(function* () {
          const events = yield* queryEvents;
          return Option.fromNullable(behavior.deriveThread(events, threadId));
        }),

      browsers: getBrowsers,

      execute: (intent, options) =>
        Effect.gen(function* () {
          const browsers = yield* getBrowsers;
          return yield* behavior
            .execute(intent, browsers, options?.preferConfigId)
            .pipe(Effect.provideService(BrowserPool, pool));
        }),
    };
  });

// Platform Context Tag

/**
 * Platform service context tag.
 * Sockpuppets yield this to access the platform.
 */
export class Platform extends Context.Tag("Platform")<
  Platform,
  PlatformService<
    StorableEvent,
    BaseIntent,
    unknown,
    BaseThreadView<unknown>,
    BaseInboxView<unknown>,
    BaseAccount,
    BaseBoundBrowser
  >
>() {}
