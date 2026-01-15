// src/platform/service.ts
// Platform service - what sockpuppets use

import { Effect, Option } from "effect";
import type {
  BrowserConfigId,
  ParticipantId,
  ThreadId,
} from "$/core/branded.ts";
import type { EventStoreError, StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import type { BaseContact } from "$/views/contact.ts";
import { BrowserPool } from "$/backend/mod.ts";
import type { Projection } from "$/projections/projection.ts";
import type { ActionsRecord, PlatformDefinition } from "$/platforms/mod.ts";

// =============================================================================
// Platform Service Interface
// =============================================================================

/**
 * PlatformService is what sockpuppets use to interact with a platform.
 * It combines projection, behavior, and actions into a clean interface.
 *
 * The sockpuppet sees:
 * - inbox: thread summaries
 * - thread(id): full thread view
 * - browsers: available browsers with platform-specific status
 * - contact(id): contact info for a participant
 * - actions: curried methods for platform operations
 */
export interface PlatformService<
  TScope extends string,
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
// Platform Service Factory
// =============================================================================

/**
 * Creates a PlatformService for a specific platform and account.
 * This is a generic factory that creates the derivation-based properties.
 * Each platform extends this with its own actions.
 *
 * @param platform - The platform definition
 * @param account - The account to create the service for
 * @param projection - Type-safe projection for this platform's events
 * @param actions - Platform-specific actions (created by platform's makeXxxActions)
 */
export const makePlatformService = <
  TScope extends string,
  TIdentity extends string,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount<TIdentity>,
  TBrowser extends BaseBoundBrowser,
  TContact extends BaseContact<TIdentity>,
  TActions extends ActionsRecord,
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
    TContact
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
  never,
  BrowserPool
> =>
  Effect.gen(function* () {
    const pool = yield* BrowserPool;
    const behavior = platform.behavior;

    const queryEvents = projection.query();

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

    const getBrowsers = Effect.gen(function* () {
      const events = yield* queryEvents;
      const runningIds = yield* getRunningConfigIds;
      return behavior.deriveBrowsers(events, account, runningIds);
    });

    return {
      scope: platform.scope,
      identity: platform.identity,
      participantId: account.id,

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

      contact: (participantId) =>
        Effect.gen(function* () {
          if (!behavior.deriveContact) {
            return Option.none();
          }
          const events = yield* queryEvents;
          return Option.fromNullable(
            behavior.deriveContact(events, participantId),
          );
        }),

      actions,
    };
  });
