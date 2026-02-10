// plugins/linkedin/service.ts
// LinkedIn platform service - typed context tag and actions

import { Context, Effect } from "effect";
import { z } from "@zod/zod";
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
import type { LinkedInScope } from "./schemas.ts";
import type { LinkedInInbox, LinkedInThread } from "./views.ts";

// =============================================================================
// LinkedIn Service Type
// =============================================================================

/**
 * Fully-typed LinkedIn platform service.
 * This is what sockpuppets receive when they yield LinkedInPlatform.
 */
export type LinkedInService = PlatformService<
  LinkedInScope,
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

// Sign-in is a multi-step process. beginSignIn starts it, then either:
// - AuthObserved event fires with authenticated=true (success)
// - TwoFactorChallengeObserved event fires (need 2FA)
// After 2FA, submitTwoFactorCode continues the process.
// The action results are acknowledgments; actual auth state is derived from events.

export const BeginSignInResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("two_factor_required"), challengeType: z.string() }),
  z.object({ status: z.literal("authenticated") }),
  z.object({ status: z.literal("failed"), error: z.string() }),
]);

export type BeginSignInResult = z.infer<typeof BeginSignInResultSchema>;

export const TwoFactorResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authenticated") }),
  z.object({ status: z.literal("failed"), error: z.string() }),
]);

export type TwoFactorResult = z.infer<typeof TwoFactorResultSchema>;

// =============================================================================
// Action Error Types
// =============================================================================

export const SendMessageErrorCode = ExecuteErrorCode("linkedin:send_message");
export const SyncErrorCode = ExecuteErrorCode("linkedin:sync");
export const ConnectionErrorCode = ExecuteErrorCode("linkedin:connection");
export const ProfileErrorCode = ExecuteErrorCode("linkedin:profile");
export const SignInErrorCode = ExecuteErrorCode("linkedin:sign_in");
export const TwoFactorErrorCode = ExecuteErrorCode("linkedin:two_factor");

export type SendMessageError = ExecuteError;
export type SyncError = ExecuteError;
export type ConnectionError = ExecuteError;
export type ProfileError = ExecuteError;
export type SignInError = ExecuteError;
export type TwoFactorError = ExecuteError;

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

  /**
   * Begin sign-in to LinkedIn with credentials.
   * Non-atomic: may require 2FA. Check result status and events.
   */
  readonly beginSignIn: PlatformMethod<
    [email: string, password: string],
    BeginSignInResult,
    SignInError
  >;

  /**
   * Submit 2FA verification code.
   * Call after signIn returns status: "two_factor_required".
   */
  readonly submitTwoFactorCode: PlatformMethod<
    [code: string, rememberDevice?: boolean],
    TwoFactorResult,
    TwoFactorError
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

    beginSignIn: (options) => (email, password) =>
      Effect.gen(function* () {
        const configId = options?.preferConfigId ?? selectBrowser();
        const response = yield* pool.send(configId, {
          type: "beginSignIn",
          payload: { email, password },
        });
        const parsed = BeginSignInResultSchema.safeParse(response);
        if (!parsed.success) {
          return yield* Effect.fail(
            executeError(
              SignInErrorCode,
              `Invalid sign-in response: ${parsed.error.message}`,
            ),
          );
        }
        return parsed.data;
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(SignInErrorCode, "Failed to begin sign in", cause),
          )
        ),
      ),

    submitTwoFactorCode: (options) => (code, rememberDevice = true) =>
      Effect.gen(function* () {
        const configId = options?.preferConfigId ?? selectBrowser();
        const response = yield* pool.send(configId, {
          type: "submitTwoFactorCode",
          payload: { code, rememberDevice },
        });
        const parsed = TwoFactorResultSchema.safeParse(response);
        if (!parsed.success) {
          return yield* Effect.fail(
            executeError(
              TwoFactorErrorCode,
              `Invalid 2FA response: ${parsed.error.message}`,
            ),
          );
        }
        return parsed.data;
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(TwoFactorErrorCode, "Failed to submit 2FA code", cause),
          )
        ),
      ),
  };
};
