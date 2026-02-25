// plugins/linkedin/service.ts
// LinkedIn platform service - typed context tag and actions

import { Context, Effect } from "effect";
import { z } from "@zod/zod";
import { BrowserConfigId, type ThreadId } from "@bernays/server/core";
import type { BrowserPoolService, CdpSession } from "@bernays/server/browsers";
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

export const BeginSignInResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("two_factor_required"),
    challengeType: z.string(),
  }),
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
 *
 * Actions connect to the browser via CDP and perform automation directly.
 * The CDP session is obtained from the BrowserPool.
 */
export interface LinkedInActions {
  readonly sendMessage: PlatformMethod<
    [threadId: ThreadId, content: string],
    MessageSentResult,
    SendMessageError
  >;

  readonly syncInbox: PlatformMethod<
    [since?: string],
    SyncResult,
    SyncError
  >;

  readonly sendConnectionRequest: PlatformMethod<
    [targetId: string, note?: string],
    ConnectionRequestResult,
    ConnectionError
  >;

  readonly withdrawInvitation: PlatformMethod<
    [targetId: string],
    InvitationWithdrawnResult,
    ConnectionError
  >;

  readonly viewProfile: PlatformMethod<
    [profileUrl: string],
    ProfileViewedResult,
    ProfileError
  >;

  readonly beginSignIn: PlatformMethod<
    [email: string, password: string],
    BeginSignInResult,
    SignInError
  >;

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
 * Actions obtain a CDP session from the pool and perform automation directly.
 *
 * @param pool - Browser pool for obtaining CDP sessions
 * @param account - The LinkedIn account to act on behalf of
 */
export const makeLinkedInActions = (
  pool: BrowserPoolService,
  account: LinkedInAccount,
): LinkedInActions => {
  const getSession = (
    preferConfigId?: string,
  ): Effect.Effect<CdpSession, ExecuteError> => {
    const configId = preferConfigId
      ? BrowserConfigId(preferConfigId)
      : account.browserBindings[0]?.configId;

    if (!configId) {
      return Effect.fail(
        executeError(SendMessageErrorCode, "No browser bindings available"),
      );
    }

    return pool.getSession(configId).pipe(
      Effect.mapError((err) =>
        executeError(SendMessageErrorCode, `Browser error: ${err.message}`, err)
      ),
    );
  };

  return {
    sendMessage: (options) => (threadId, content) =>
      Effect.gen(function* () {
        yield* getSession(options?.preferConfigId as string | undefined);
        // TODO: Implement CDP-based message sending
        // Connect to session.cdpUrl and automate LinkedIn messaging
        void threadId;
        void content;
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
        yield* getSession(options?.preferConfigId as string | undefined);
        // TODO: Implement CDP-based inbox sync
        void since;
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
        yield* getSession(options?.preferConfigId as string | undefined);
        // TODO: Implement CDP-based connection request
        void targetId;
        void note;
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
        yield* getSession(options?.preferConfigId as string | undefined);
        // TODO: Implement CDP-based invitation withdrawal
        void targetId;
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
        yield* getSession(options?.preferConfigId as string | undefined);
        // TODO: Implement CDP-based profile viewing
        void profileUrl;
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
        yield* getSession(options?.preferConfigId as string | undefined);
        // TODO: Implement CDP-based sign-in
        void email;
        void password;
        return { status: "pending" as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(SignInErrorCode, "Failed to begin sign in", cause),
          )
        ),
      ),

    submitTwoFactorCode: (options) => (code, _rememberDevice = true) =>
      Effect.gen(function* () {
        yield* getSession(options?.preferConfigId as string | undefined);
        // TODO: Implement CDP-based 2FA submission
        void code;
        return { status: "authenticated" as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(
              TwoFactorErrorCode,
              "Failed to submit 2FA code",
              cause,
            ),
          )
        ),
      ),
  };
};
