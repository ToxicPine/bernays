// src/runtime/sockpuppet/platform-runtime.ts
// Platform service layer for sockpuppets

import { type Context, Effect, Layer } from "effect";
import type { Scope } from "$/core/branded.ts";
import type { StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import type { BaseContact } from "$/views/contact.ts";
import type { Projection } from "$/projections/projection.ts";
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
 * Resolves a Projection from the provided tag, hydrates plugin state via
 * full-fold, subscribes for reactive updates via a background fiber, and
 * wires materialization from the Ref.
 *
 * @param tag - The platform-specific context tag (e.g., LinkedInPlatform)
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
) {
  const { platform, account, actions } = config;

  const serviceEffect = Effect.gen(function* () {
    const projection = yield* projectionTag;
    return yield* makePlatformService(
      platform,
      account,
      projection,
      actions,
    );
  });

  return Layer.scoped(tag, serviceEffect);
}
