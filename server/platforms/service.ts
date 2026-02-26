// src/platforms/service.ts
// Platform service — what sockpuppets use

import { Effect, Option, Ref, type Scope as EffectScope, Stream } from "effect";
import type {
  BrowserConfigId,
  ParticipantId,
  Scope,
  ThreadId,
} from "$/core/branded.ts";
import type { EventStoreError, StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import type { BaseContact } from "$/views/contact.ts";
import { BrowserPool } from "$/browsers/mod.ts";
import type { Projection } from "$/projections/projection.ts";
import type { ActionsRecord, PlatformDefinition } from "$/platforms/mod.ts";

// =============================================================================
// Platform Service Interface
// =============================================================================

/**
 * PlatformService is what sockpuppets use to interact with a platform.
 * Views are materialized from a Ref holding plugin-wide state. A background
 * fiber keeps the state current by subscribing to the Projection stream.
 */
export interface PlatformService<
  TScope extends Scope,
  TIdentity extends string,
  TActions extends ActionsRecord,
  TInbox extends BaseInboxView<unknown>,
  TThread extends BaseThreadView<unknown>,
  TBrowser extends BaseBoundBrowser,
  TContact extends BaseContact<TIdentity>,
> {
  readonly scope: TScope;
  readonly identity: TIdentity;
  readonly participantId: ParticipantId<TIdentity>;

  readonly inbox: Effect.Effect<TInbox, EventStoreError>;

  readonly thread: (
    id: ThreadId,
  ) => Effect.Effect<Option.Option<TThread>, EventStoreError>;

  readonly browsers: Effect.Effect<readonly TBrowser[], EventStoreError>;

  readonly contact: (
    id: ParticipantId<TIdentity>,
  ) => Effect.Effect<Option.Option<TContact>, EventStoreError>;

  readonly actions: TActions;
}

// =============================================================================
// Platform Service Factory (Ref-based, reactive)
// =============================================================================

/**
 * Creates a PlatformService backed by a Ref that is kept current by a
 * background fiber subscribing to the Projection stream.
 *
 * 1. Hydrate: query all existing events, fold into state, create Ref
 * 2. Subscribe: fork a background fiber that folds new events into the Ref
 * 3. Materialize: each service method reads from Ref + pure materialization
 *
 * Must be run within a Scope (Layer.scoped) so the background fiber is
 * interrupted when the layer is released.
 */
export const makePlatformService = <
  TScope extends Scope,
  TIdentity extends string,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount<TIdentity>,
  TBrowser extends BaseBoundBrowser,
  TContact extends BaseContact<TIdentity>,
  TActions extends ActionsRecord,
  TPluginState,
>(
  platform: PlatformDefinition<
    TScope,
    TIdentity,
    TEvent,
    TAnchor,
    TThread,
    TInbox,
    TAccount,
    TBrowser,
    TContact,
    TPluginState
  >,
  account: TAccount,
  projection: Projection<TEvent>,
  actions: TActions,
): Effect.Effect<
  PlatformService<
    TScope,
    TIdentity,
    TActions,
    TInbox,
    TThread,
    TBrowser,
    TContact
  >,
  EventStoreError,
  BrowserPool | EffectScope.Scope
> =>
  Effect.gen(function* () {
    const pool = yield* BrowserPool;
    const behavior = platform.behavior;

    // 1. Hydrate: full fold from existing events
    const events = yield* projection.query();
    const state = behavior.emptyState();
    for (const event of events) behavior.applyEvent(state, event);
    const stateRef = yield* Ref.make(state);

    // 2. Subscribe: background fiber folds new events into state
    const lastTimestamp = events.length > 0
      ? events[events.length - 1].timestamp
      : undefined;

    yield* projection.subscribe(lastTimestamp).pipe(
      Stream.runForEach((chunk) =>
        Ref.update(stateRef, (s) => {
          for (const event of chunk) behavior.applyEvent(s, event);
          return s;
        })
      ),
      Effect.forkScoped,
    );

    // 3. Helper: get running browser config IDs
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

    // 4. Service: reads from ref + materializes
    return {
      scope: platform.scope,
      identity: platform.identity,
      participantId: account.id,

      inbox: Effect.map(Ref.get(stateRef), (s) =>
        behavior.materializeInbox(s, account.id)),

      thread: (threadId) =>
        Effect.map(Ref.get(stateRef), (s) =>
          Option.fromNullable(behavior.materializeThread(s, threadId))),

      browsers: Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        const runningIds = yield* getRunningConfigIds;
        return behavior.materializeBrowsers(s, account, runningIds);
      }),

      contact: (participantId) =>
        Effect.map(Ref.get(stateRef), (s) =>
          Option.fromNullable(
            behavior.materializeContact?.(s, participantId),
          )),

      actions,
    };
  });
