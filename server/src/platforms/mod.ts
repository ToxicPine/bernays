// src/platforms/mod.ts
// Platform definitions - PlatformBehavior and PlatformDefinition interfaces

import { Effect } from "effect";
import { z } from "@zod/zod";
import type {
  BrowserConfigId,
  ParticipantId,
  Scope,
  ThreadId,
} from "$/core/branded.ts";
import type { StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import type { BaseContact } from "$/views/contact.ts";

export { makePlatformService, type PlatformService } from "./service.ts";

// =============================================================================
// Execute Error
// =============================================================================

export type ExecuteErrorCode = string & { readonly _brand: "ExecuteErrorCode" };

/** Branded constructor for ExecuteErrorCode */
export const ExecuteErrorCode = (code: string): ExecuteErrorCode =>
  code as ExecuteErrorCode;

export interface ExecuteError {
  readonly _tag: "ExecuteError";
  readonly code: ExecuteErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const executeError = (
  code: ExecuteErrorCode,
  message: string,
  cause?: unknown,
): ExecuteError => ({ _tag: "ExecuteError", code, message, cause });

// =============================================================================
// Platform Method (Curried Effects)
// =============================================================================

/**
 * Options for executing a platform action.
 * Allows specifying which browser to prefer.
 */
export interface ExecuteOptions {
  readonly preferConfigId?: BrowserConfigId;
}

/**
 * All platform effects follow a curried pattern for consistent browser selection.
 *
 * Usage:
 * ```typescript
 * // Default browser selection
 * yield* platform.actions.sendMessage()(threadId, content);
 *
 * // Explicit browser preference
 * yield* platform.actions.sendMessage({ preferConfigId: mobileId })(threadId, content);
 * ```
 */
export type PlatformMethod<
  TArgs extends readonly unknown[],
  TResult,
  TError,
> = (
  options?: ExecuteOptions,
) => (...args: TArgs) => Effect.Effect<TResult, TError>;

/**
 * Constraint for platform action records.
 * Actions are objects where each property is a PlatformMethod.
 *
 * Note: We use `object` instead of `Record<string, PlatformMethod<...>>` because
 * the index signature in Record causes type conflicts with specific action interfaces.
 * The constraint is enforced structurally when actions are used.
 */
// deno-lint-ignore ban-types
export type ActionsRecord = object;

// =============================================================================
// Platform Behavior (Incremental State + Pure Materialization)
// =============================================================================

/**
 * PlatformBehavior encapsulates incremental state management and pure view
 * materialization for a platform.
 *
 * Two scope parameters enable the "dojo" pattern:
 * - TScope: The `scope` field on events (e.g., "linkedin" or "linkedindojo")
 * - TIdentity: The identity namespace for ParticipantIds (e.g., "linkedin")
 *
 * For production platforms, these are the same.
 * For dojo, they differ (events scoped to dojo, but identity shared with production).
 *
 * TPluginState is fully opaque to the framework. Each plugin defines its own
 * state type, reducer logic, and materialization strategy. The framework wires
 * emptyState, applyEvent, and materialize* through the Projection/Ref machinery
 * but never inspects or constrains what TPluginState contains.
 *
 * The behavior only does pure derivation/materialization. Actions live in the
 * service layer.
 */
export interface PlatformBehavior<
  TScope extends Scope,
  TIdentity extends string,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount<TIdentity>,
  TBrowser extends BaseBoundBrowser = BaseBoundBrowser,
  TContact extends BaseContact<TIdentity> = BaseContact<TIdentity>,
  TPluginState = unknown,
> {
  readonly scope: TScope;
  readonly identity: TIdentity;

  // ─────────────────────────────────────────────────────────────────────────
  // Incremental state management
  // ─────────────────────────────────────────────────────────────────────────

  /** Create an empty plugin-wide state. */
  readonly emptyState: () => TPluginState;

  /** Apply a single event to the plugin state. Mutates in place. */
  readonly applyEvent: (state: TPluginState, event: TEvent) => void;

  // ─────────────────────────────────────────────────────────────────────────
  // View materialization — pure projections from accumulated state
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Materialize inbox view from plugin state for a specific account.
   * Returns thread summaries indexed by thread ID.
   */
  readonly materializeInbox: (
    state: TPluginState,
    participantId: ParticipantId<TIdentity>,
  ) => TInbox;

  /**
   * Materialize thread view from plugin state for a specific thread.
   * Returns undefined if thread doesn't exist.
   */
  readonly materializeThread: (
    state: TPluginState,
    threadId: ThreadId,
  ) => TThread | undefined;

  /**
   * Materialize browser status from plugin state.
   * Returns platform-specific browser views with auth status, rate limits, etc.
   */
  readonly materializeBrowsers: (
    state: TPluginState,
    account: TAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ) => readonly TBrowser[];

  /**
   * Materialize contact info from plugin state for a specific participant.
   * Optional — not all platforms have rich contact info.
   */
  readonly materializeContact?: (
    state: TPluginState,
    participantId: ParticipantId<TIdentity>,
  ) => TContact | undefined;
}

// =============================================================================
// Platform Definition (Schema + Behavior)
// =============================================================================

/**
 * PlatformDefinition is the registration unit for a platform.
 * It bundles schemas and behavior only - no actions.
 *
 * Actions are created in the service layer (makeXxxService factories).
 *
 * Type parameters:
 * - TScope: Event scope (e.g., "linkedin", "linkedindojo")
 * - TIdentity: Participant identity namespace (e.g., "linkedin")
 */
export interface PlatformDefinition<
  TScope extends Scope,
  TIdentity extends string,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount<TIdentity>,
  TBrowser extends BaseBoundBrowser = BaseBoundBrowser,
  TContact extends BaseContact<TIdentity> = BaseContact<TIdentity>,
  TPluginState = unknown,
> {
  readonly scope: TScope;
  readonly identity: TIdentity;

  readonly eventSchema: z.ZodType<TEvent>;
  readonly anchorSchema: z.ZodType<TAnchor>;

  readonly behavior: PlatformBehavior<
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
}

// =============================================================================
// Type-Erased Platform
// =============================================================================

/**
 * Type-erased platform definition for schema collection.
 * Used when you need to work with platforms without knowing their specific types.
 */
export type AnyPlatform = PlatformDefinition<
  Scope,
  string,
  StorableEvent & { readonly scope: Scope },
  unknown,
  BaseThreadView<unknown>,
  BaseInboxView<unknown>,
  BaseAccount<string>,
  BaseBoundBrowser,
  BaseContact<string>,
  unknown
>;

// =============================================================================
// Platform Registry
// =============================================================================

/**
 * Collects platform definitions and provides schema lookup.
 */
export interface PlatformRegistry {
  readonly platforms: readonly AnyPlatform[];
  readonly getEventSchema: (
    scope: Scope,
  ) => z.ZodType<StorableEvent> | undefined;
  readonly get: (scope: Scope) => AnyPlatform | undefined;
}

export const createPlatformRegistry = (
  platforms: readonly AnyPlatform[],
): PlatformRegistry => {
  const byScope = new Map(platforms.map((p) => [p.scope, p]));

  return {
    platforms,
    getEventSchema: (scope) => byScope.get(scope)?.eventSchema,
    get: (scope) => byScope.get(scope),
  };
};
