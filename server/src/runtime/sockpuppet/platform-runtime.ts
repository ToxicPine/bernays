// src/runtime/sockpuppet/platform-runtime.ts
// Platform service layer for sockpuppets

import { type Context, Layer } from "effect";
import type { Scope } from "$/core/branded.ts";
import type { EventStore, StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import type { BaseContact } from "$/views/contact.ts";
import { BrowserPool, type BrowserPoolService } from "$/browsers/mod.ts";
import {
  type ActionsRecord,
  makePlatformService,
  type PlatformDefinition,
  type PlatformService,
} from "$/platforms/mod.ts";
import { makeProjection } from "$/projections/projection.ts";

// =============================================================================
// Platform Layer Factory
// =============================================================================

/**
 * Create a Layer that provides a typed Platform service.
 *
 * Each platform defines its own tag (e.g., LinkedInPlatform) and this
 * factory creates a layer for that specific tag.
 *
 * @param tag - The platform-specific context tag (e.g., LinkedInPlatform)
 * @param config - Platform configuration
 *
 * @example
 * ```typescript
 * const actions = makeLinkedInActions(browserPool, account);
 * const layer = makePlatformLayer(LinkedInPlatform, {
 *   platform: linkedInPlatform,
 *   account,
 *   eventStore,
 *   browserPool,
 *   actions,
 * });
 * ```
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
  TTag extends Context.Tag<
    any,
    PlatformService<TScope, TIdentity, TActions, TInbox, TThread, TBrowser, TContact>
  >,
>(
  tag: TTag,
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
      TContact
    >;
    readonly account: TAccount;
    readonly eventStore: EventStore<StorableEvent>;
    readonly browserPool: BrowserPoolService;
    readonly actions: TActions;
  },
): Layer.Layer<Context.Tag.Identifier<TTag>> {
  const { platform, account, eventStore, browserPool, actions } = config;

  const projection = makeProjection(
    platform.scope,
    platform.eventSchema,
    eventStore,
  );

  // Create BrowserPool layer from the provided service
  const browserPoolLayer = Layer.succeed(BrowserPool, browserPool);

  // Create the platform service effect and provide BrowserPool
  const serviceEffect = makePlatformService(
    platform,
    account,
    projection,
    actions,
  );

  return Layer.effect(tag, serviceEffect).pipe(
    Layer.provide(browserPoolLayer),
  );
}
