// plugins/linkedin/service.ts
// LinkedIn platform service - typed context tag and actions

import { Context, Effect } from "effect";
import type { ThreadId } from "@bernays/server/core";
import type { BrowserPoolService } from "@bernays/server/backend";
import {
  type ExecuteError,
  executeError,
  ExecuteErrorCode,
  type PlatformMethod,
  type PlatformService,
} from "@bernays/server/platforms";
import type { LinkedInAccount } from "./account.ts";
import type { LinkedInBrowser } from "./browser.ts";
import type { LinkedInContact } from "./contact.ts";
import type { LinkedInInbox, LinkedInThread } from "./views.ts";

// =============================================================================
// LinkedIn Service Type
// =============================================================================

/**
 * Fully-typed LinkedIn platform service.
 * This is what sockpuppets receive when they yield LinkedInPlatform.
 */
export type LinkedInService = PlatformService<
  "linkedin",
  "linkedin",
  LinkedInActions,
  LinkedInInbox,
  LinkedInThread,
  LinkedInBrowser,
  LinkedInContact
>;

// =============================================================================
// LinkedIn Platform Context Tag
// =============================================================================

/**
 * Typed context tag for LinkedIn platform.
 * Sockpuppets yield this for type-safe access to LinkedIn-specific functionality.
 *
 * Usage:
 * ```typescript
 * const linkedInBot = Effect.gen(function* () {
 *   const platform = yield* LinkedInPlatform;
 *   // platform.actions.sendMessage is fully typed
 *   yield* platform.actions.sendMessage()(threadId, "Hello!");
 * });
 * ```
 */
export class LinkedInPlatform extends Context.Tag("linkedin/Platform")<
  LinkedInPlatform,
  LinkedInService
>() {}

// =============================================================================
// Action Result Types
// =============================================================================

export interface MessageSentResult {
  readonly success: true;
}

export interface SyncResult {
  readonly synced: true;
  readonly conversationCount: number;
}

export interface ConnectionRequestResult {
  readonly sent: true;
}

export interface InvitationWithdrawnResult {
  readonly withdrawn: true;
}

export interface ProfileViewedResult {
  readonly viewed: true;
}

// =============================================================================
// Action Error Types
// =============================================================================

export const SendMessageErrorCode = ExecuteErrorCode("linkedin:send_message");
export const SyncErrorCode = ExecuteErrorCode("linkedin:sync");
export const ConnectionErrorCode = ExecuteErrorCode("linkedin:connection");
export const ProfileErrorCode = ExecuteErrorCode("linkedin:profile");

export type SendMessageError = ExecuteError;
export type SyncError = ExecuteError;
export type ConnectionError = ExecuteError;
export type ProfileError = ExecuteError;

// =============================================================================
// LinkedIn Actions Interface
// =============================================================================

/**
 * LinkedIn-specific actions.
 * All actions follow the curried PlatformMethod pattern for browser selection.
 */
export interface LinkedInActions {
  /**
   * Send a message in an existing thread.
   */
  readonly sendMessage: PlatformMethod<
    [threadId: ThreadId, content: string],
    MessageSentResult,
    SendMessageError
  >;

  /**
   * Sync inbox to fetch recent conversations.
   */
  readonly syncInbox: PlatformMethod<
    [since?: string],
    SyncResult,
    SyncError
  >;

  /**
   * Send a connection request to a LinkedIn user.
   */
  readonly sendConnectionRequest: PlatformMethod<
    [targetId: string, note?: string],
    ConnectionRequestResult,
    ConnectionError
  >;

  /**
   * Withdraw a pending connection invitation.
   */
  readonly withdrawInvitation: PlatformMethod<
    [targetId: string],
    InvitationWithdrawnResult,
    ConnectionError
  >;

  /**
   * View a LinkedIn profile.
   */
  readonly viewProfile: PlatformMethod<
    [profileUrl: string],
    ProfileViewedResult,
    ProfileError
  >;
}

// =============================================================================
// Actions Factory
// =============================================================================

/**
 * Create LinkedIn actions for a specific account.
 *
 * @param pool - Browser pool for sending commands
 * @param account - The LinkedIn account to act on behalf of
 */
export const makeLinkedInActions = (
  pool: BrowserPoolService,
  account: LinkedInAccount,
): LinkedInActions => {
  // Select the first available browser binding for now
  // TODO: Implement smarter browser selection based on auth status, rate limits
  const selectBrowser = () => {
    const binding = account.browserBindings[0];
    if (!binding) {
      throw new Error("No browser bindings available");
    }
    return binding.configId;
  };

  return {
    sendMessage: (options) => (threadId, content) =>
      Effect.gen(function* () {
        const configId = options?.preferConfigId ?? selectBrowser();
        yield* pool.send(configId, {
          type: "sendMessage",
          payload: { threadId, content },
        });
        return { success: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(SendMessageErrorCode, "Failed to send message", cause),
          )
        ),
      ),

    syncInbox: (options) => (since) =>
      Effect.gen(function* () {
        const configId = options?.preferConfigId ?? selectBrowser();
        yield* pool.send(configId, {
          type: "syncInbox",
          payload: { since },
        });
        return { synced: true as const, conversationCount: 0 };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(SyncErrorCode, "Failed to sync inbox", cause),
          )
        ),
      ),

    sendConnectionRequest: (options) => (targetId, note) =>
      Effect.gen(function* () {
        const configId = options?.preferConfigId ?? selectBrowser();
        yield* pool.send(configId, {
          type: "sendConnectionRequest",
          payload: { targetId, note },
        });
        return { sent: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(
              ConnectionErrorCode,
              "Failed to send connection request",
              cause,
            ),
          )
        ),
      ),

    withdrawInvitation: (options) => (targetId) =>
      Effect.gen(function* () {
        const configId = options?.preferConfigId ?? selectBrowser();
        yield* pool.send(configId, {
          type: "withdrawInvitation",
          payload: { targetId },
        });
        return { withdrawn: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(
              ConnectionErrorCode,
              "Failed to withdraw invitation",
              cause,
            ),
          )
        ),
      ),

    viewProfile: (options) => (profileUrl) =>
      Effect.gen(function* () {
        const configId = options?.preferConfigId ?? selectBrowser();
        yield* pool.send(configId, {
          type: "viewProfile",
          payload: { profileUrl },
        });
        return { viewed: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(ProfileErrorCode, "Failed to view profile", cause),
          )
        ),
      ),
  };
};
