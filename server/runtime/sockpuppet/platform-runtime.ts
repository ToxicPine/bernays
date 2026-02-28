// runtime/sockpuppet/platform-runtime.ts
// Platform service layer for sockpuppets

import { type Context, Effect, Layer } from "effect";
import type { Scope } from "$/core/branded.ts";
import type { StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import type { BaseContact } from "$/views/contact.ts";
import { BrowserPool } from "$/browsers/mod.ts";
import { type Injector, makeInjectionLayer } from "$/projections/injector.ts";
import {
  makeProjectionLayer,
  type Projection,
} from "$/projections/projection.ts";
import {
  type ActionsRecord,
  makePlatformService,
  type PlatformDefinition,
  type PlatformService,
} from "$/platforms/mod.ts";

// =============================================================================
// Platform Layer Factory
// =============================================================================

/**
 * Create a Layer that provides a typed Platform service with reactive state.
 *
 * Creates Injection and Projection layers internally using the platform
 * definition's scope and eventSchema. This simplifies layer composition —
 * callers only need to provide EventStoreTag and BrowserPool.
 *
 * Optionally accepts a `sync` factory — a function from account to an Effect
 * that periodically observes the platform via CDP and emits events through
 * injection. When provided, `makePlatformLayer` calls it with the account and
 * forks the result scoped to the layer's lifetime. Test plugins (e.g.,
 * messageboard) may omit it.
 *
 * `RExtra` (defaults to `never`) is the escape hatch for observation
 * deduplication: when public state should be observed once and shared across
 * all participants. The sync fiber declares `RExtra` in its requirements,
 * and `makePlatformLayer` propagates it to the layer's `R` type so the
 * caller provides it.
 *
 * @param tag - The platform-specific context tag (e.g., LinkedInPlatform)
 * @param injectionTag - The scope-specific Injection context tag
 * @param projectionTag - The scope-specific Projection context tag
 * @param config - Platform configuration (definition, account, actions, sync)
 */
export function makePlatformLayer<
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
  TTag extends Context.Tag<
    any,
    PlatformService<
      TScope,
      TIdentity,
      TActions,
      TInbox,
      TThread,
      TBrowser,
      TContact
    >
  >,
  RExtra = never,
>(
  tag: TTag,
  injectionTag: Context.Tag<any, Injector<TEvent>>,
  projectionTag: Context.Tag<any, Projection<TEvent>>,
  config: {
    readonly platform: PlatformDefinition<
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
    >;
    readonly account: TAccount;
    readonly actions: TActions;
    /** Plugin-defined background sync factory. Called with account, returns
     *  an Effect that observes the platform and emits events via injection.
     *  Optional — test plugins may omit. */
    readonly sync?: (
      account: TAccount,
    ) => Effect.Effect<never, never, Injector<TEvent> | BrowserPool | RExtra>;
  },
) {
  const { platform, account, actions } = config;

  // Create injection/projection layers internally with platform's scope and schema
  const injectionLayer = makeInjectionLayer(
    injectionTag,
    platform.scope,
    platform.eventSchema,
  );
  const projectionLayer = makeProjectionLayer(
    projectionTag,
    platform.scope,
    platform.eventSchema,
  );

  const serviceEffect = Effect.gen(function* () {
    const projection = yield* projectionTag;
    const service = yield* makePlatformService(
      platform,
      account,
      projection,
      actions,
    );

    // Fork sync fiber if provided — scoped to the layer's lifetime
    if (config.sync) {
      yield* Effect.forkScoped(config.sync(account));
    }

    return service;
  });

  // Use provideMerge to both satisfy internal dependencies AND export the
  // injection/projection tags. This allows action effects (which require
  // the injector) to run in the same context where the platform is provided.
  return Layer.scoped(tag, serviceEffect).pipe(
    Layer.provideMerge(injectionLayer),
    Layer.provideMerge(projectionLayer),
  );
}
