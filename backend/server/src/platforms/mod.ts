// src/platforms/mod.ts
// Platform definitions - PlatformBehavior and PlatformDefinition interfaces

import { Effect } from "effect";
import { z } from "@zod/zod";
import type {
  AccountId,
  BrowserConfigId,
  Scope,
  ThreadId,
} from "$/core/branded.ts";
import type { StorableEvent } from "$/store/mod.ts";
import type { BaseInboxView } from "$/views/inbox.ts";
import type { BaseThreadView } from "$/views/thread.ts";
import type { BaseAccount, BaseBoundBrowser } from "$/views/browser.ts";
import type { BrowserPool } from "$/backend/mod.ts";

export {
  makePlatformService,
  Platform,
  type PlatformService,
} from "./service.ts";

// ============================================================================
// Base Intent
// ============================================================================

/**
 * Base intent shape - all platform intents must satisfy this.
 */
export interface BaseIntent<TScope extends Scope = Scope> {
  readonly scope: TScope;
  readonly type: string;
}

// ============================================================================
// Execute Error
// ============================================================================

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

// ============================================================================
// Platform Behavior
// ============================================================================

/**
 * PlatformBehavior encapsulates pure logic for a platform.
 * It operates on types provided by the PlatformDefinition.
 *
 * The behavior owns:
 * - Derivation: building views from events
 * - Browser selection: deciding which browser to use
 * - Execution: sending intents to browsers
 *
 * Different platforms have different semantics for auth, rate limits,
 * threading, etc. The behavior encapsulates this so sockpuppets just
 * see generic views.
 */
export interface PlatformBehavior<
  TScope extends Scope,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TIntent extends BaseIntent<TScope>,
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount,
  TBrowser extends BaseBoundBrowser = BaseBoundBrowser,
> {
  readonly scope: TScope;

  // ─────────────────────────────────────────────────────────────────────────
  // Derivation — fold events into views (pure functions)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Derive inbox view from events for a specific account.
   * Returns thread summaries indexed by thread ID.
   */
  readonly deriveInbox: (
    events: readonly TEvent[],
    accountId: AccountId,
  ) => TInbox;

  /**
   * Derive thread view from events for a specific thread.
   * Returns undefined if thread doesn't exist.
   */
  readonly deriveThread: (
    events: readonly TEvent[],
    threadId: ThreadId,
  ) => TThread | undefined;

  /**
   * Derive browser status from events.
   * Returns platform-specific browser views with auth status, rate limits, etc.
   *
   * @param events - All events for this scope
   * @param account - The account with browser bindings
   * @param runningConfigIds - Set of currently running browser config IDs
   */
  readonly deriveBrowsers: (
    events: readonly TEvent[],
    account: TAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ) => readonly TBrowser[];

  // ─────────────────────────────────────────────────────────────────────────
  // Execution — run intents via browser (behavior owns browser selection)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute an intent using one of the available browsers.
   * The behavior owns browser selection logic (based on auth, rate limits, etc.)
   *
   * @param intent - The intent to execute
   * @param browsers - Available browsers with platform-specific status
   * @param preferConfigId - Optional preferred browser config ID
   * @returns Effect that yields the used browser config ID
   */
  readonly execute: (
    intent: TIntent,
    browsers: readonly TBrowser[],
    preferConfigId?: BrowserConfigId,
  ) => Effect.Effect<
    { readonly usedConfigId: BrowserConfigId },
    ExecuteError,
    BrowserPool
  >;
}

// ============================================================================
// Platform Definition
// ============================================================================

/**
 * PlatformDefinition is the registration unit for a platform.
 * It bundles:
 * - Schemas: the contract (what events/intents look like)
 * - Behavior: how to derive views, select browsers, execute intents
 *
 * Type parameters enforce compile-time safety: you cannot register
 * a schema containing events with the wrong scope literal.
 */
export interface PlatformDefinition<
  TScope extends Scope,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TIntent extends BaseIntent<TScope>,
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount,
  TBrowser extends BaseBoundBrowser = BaseBoundBrowser,
> {
  readonly scope: TScope;

  // Schemas — the contract for this scope
  readonly eventSchema: z.ZodType<TEvent>;
  readonly intentSchema: z.ZodType<TIntent>;
  readonly anchorSchema: z.ZodType<TAnchor>;

  // Behavior — how to derive views, select browsers, and execute intents
  readonly behavior: PlatformBehavior<
    TScope,
    TEvent,
    TIntent,
    TAnchor,
    TThread,
    TInbox,
    TAccount,
    TBrowser
  >;
}

// ============================================================================
// Type-Erased Platform
// ============================================================================

/**
 * Type-erased platform definition for schema collection.
 * Used when you need to work with platforms without knowing their specific types.
 */
export type AnyPlatform = PlatformDefinition<
  Scope,
  StorableEvent & { readonly scope: Scope },
  BaseIntent,
  unknown,
  BaseThreadView<unknown>,
  BaseInboxView<unknown>,
  BaseAccount,
  BaseBoundBrowser
>;

// ============================================================================
// Platform Registry
// ============================================================================

/**
 * Collects platform definitions and provides schema lookup.
 */
export interface PlatformRegistry {
  readonly platforms: readonly AnyPlatform[];
  readonly getEventSchema: (
    scope: Scope,
  ) => z.ZodType<StorableEvent> | undefined;
  readonly getIntentSchema: (scope: Scope) => z.ZodType<BaseIntent> | undefined;
  readonly get: (scope: Scope) => AnyPlatform | undefined;
}

export const createPlatformRegistry = (
  platforms: readonly AnyPlatform[],
): PlatformRegistry => {
  const byScope = new Map(platforms.map((p) => [p.scope, p]));

  return {
    platforms,
    getEventSchema: (scope) => byScope.get(scope)?.eventSchema,
    getIntentSchema: (scope) => byScope.get(scope)?.intentSchema,
    get: (scope) => byScope.get(scope),
  };
};
