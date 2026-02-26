// runtime/sockpuppet/platform-runtime.ts
// Platform service layer for sockpuppets

import { type Context, Effect, Layer } from "effect";
import type { Scope } from "$/core/branded.ts";
import { EventStoreTag, type EventStoreError, type StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import type { BaseContact } from "$/views/contact.ts";
import { BrowserPool } from "$/browsers/mod.ts";
import {
  type Injector,
  makeInjectionLayer,
} from "$/projections/injector.ts";
import {
  type Projection,
  makeProjectionLayer,
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
 * definition's scope and eventSchema. This simplifies layer composition -
 * callers only need to provide EventStoreTag.
 *
 * @param tag - The platform-specific context tag (e.g., LinkedInPlatform)
 * @param injectionTag - The scope-specific Injection context tag
 * @param projectionTag - The scope-specific Projection context tag
 * @param config - Platform configuration (definition, account, actions)
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
  },
): Layer.Layer<
  Context.Tag.Identifier<TTag> | Injector<TEvent> | Projection<TEvent>,
  EventStoreError,
  EventStoreTag | BrowserPool
> {
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
    return yield* makePlatformService(
      platform,
      account,
      projection,
      actions,
    );
  });

  // Use provideMerge to both satisfy internal dependencies AND export the
  // injection/projection tags. This allows action effects (which require
  // the injector) to run in the same context where the platform is provided.
  return Layer.scoped(tag, serviceEffect).pipe(
    Layer.provideMerge(injectionLayer),
    Layer.provideMerge(projectionLayer),
  );
}
