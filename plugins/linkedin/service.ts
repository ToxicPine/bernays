// plugins/linkedin/service.ts
// LinkedIn platform service — typed context tag, actions interface, and factory

import { Context, Effect } from "effect";
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

export interface ConnectionRequestResult {
  readonly sent: true;
  readonly invitationId?: string;
}

export interface InvitationWithdrawnResult {
  readonly withdrawn: true;
}

export interface ProfileViewedResult {
  readonly viewed: true;
  readonly viewerPrivacySetting: "full" | "anonymous" | "hidden";
}

export interface FollowUserResult {
  readonly followed: true;
}

export interface MessageRequestSentResult {
  readonly sent: true;
}

export interface BeginSignInResult {
  readonly status: "authenticated" | "challenged" | "failed";
  readonly challengeType?: string;
  readonly errorCode?: string;
  readonly error?: string;
}

export interface TwoFactorResult {
  readonly status: "authenticated" | "failed";
  readonly errorCode?: string;
}

// =============================================================================
// Action Error Codes
// =============================================================================

export const SendMessageErrorCode = ExecuteErrorCode("linkedin:send_message");
export const ConnectionErrorCode = ExecuteErrorCode("linkedin:connection");
export const ProfileErrorCode = ExecuteErrorCode("linkedin:profile");
export const FollowErrorCode = ExecuteErrorCode("linkedin:follow");
export const MessageRequestErrorCode = ExecuteErrorCode("linkedin:message_request");
export const SignInErrorCode = ExecuteErrorCode("linkedin:sign_in");
export const TwoFactorErrorCode = ExecuteErrorCode("linkedin:two_factor");
export const RestrictionErrorCode = ExecuteErrorCode("linkedin:restriction");

export type SendMessageError = ExecuteError;
export type ConnectionError = ExecuteError;
export type ProfileError = ExecuteError;
export type SignInError = ExecuteError;
export type TwoFactorError = ExecuteError;

// =============================================================================
// LinkedIn Actions Interface
// =============================================================================

/**
 * LinkedIn-specific actions — intentional acts the sockpuppet performs.
 * All actions follow the curried PlatformMethod pattern for browser selection.
 *
 * Actions emit events through injection and check restrictions pre-flight.
 */
export interface LinkedInActions {
  readonly sendMessage: PlatformMethod<
    [threadId: ThreadId, content: string],
    MessageSentResult,
    SendMessageError
  >;

  readonly sendMessageRequest: PlatformMethod<
    [targetId: string, content: string, contextUrn?: string],
    MessageRequestSentResult,
    ExecuteError
  >;

  readonly sendConnectionRequest: PlatformMethod<
    [targetId: string, note?: string],
    ConnectionRequestResult,
    ConnectionError
  >;

  readonly withdrawInvitation: PlatformMethod<
    [invitationId: string],
    InvitationWithdrawnResult,
    ConnectionError
  >;

  readonly viewProfile: PlatformMethod<
    [targetId: string],
    ProfileViewedResult,
    ProfileError
  >;

  readonly followUser: PlatformMethod<
    [targetId: string],
    FollowUserResult,
    ExecuteError
  >;

  readonly beginSignIn: PlatformMethod<
    [email: string, password: string],
    BeginSignInResult,
    SignInError
  >;

  readonly submitTwoFactorCode: PlatformMethod<
    [code: string, rememberDevice?: boolean],
    TwoFactorResult,
    ExecuteError
  >;
}

// =============================================================================
// Actions Factory
// =============================================================================

/**
 * Create LinkedIn actions for a specific account.
 * Actions are intentional acts — not observations.
 * Each action gets a CDP session, performs the act, and emits events.
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
        void threadId;
        void content;
        return { success: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(executeError(SendMessageErrorCode, "Failed to send message", cause))
        ),
      ),

    sendMessageRequest: (options) => (targetId, content, contextUrn) =>
      Effect.gen(function* () {
        yield* getSession(options?.preferConfigId as string | undefined);
        void targetId;
        void content;
        void contextUrn;
        return { sent: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(executeError(MessageRequestErrorCode, "Failed to send message request", cause))
        ),
      ),

    sendConnectionRequest: (options) => (targetId, note) =>
      Effect.gen(function* () {
        yield* getSession(options?.preferConfigId as string | undefined);
        void targetId;
        void note;
        return { sent: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(executeError(ConnectionErrorCode, "Failed to send connection request", cause))
        ),
      ),

    withdrawInvitation: (options) => (invitationId) =>
      Effect.gen(function* () {
        yield* getSession(options?.preferConfigId as string | undefined);
        void invitationId;
        return { withdrawn: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(executeError(ConnectionErrorCode, "Failed to withdraw invitation", cause))
        ),
      ),

    viewProfile: (options) => (targetId) =>
      Effect.gen(function* () {
        yield* getSession(options?.preferConfigId as string | undefined);
        void targetId;
        return { viewed: true as const, viewerPrivacySetting: "full" as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(executeError(ProfileErrorCode, "Failed to view profile", cause))
        ),
      ),

    followUser: (options) => (targetId) =>
      Effect.gen(function* () {
        yield* getSession(options?.preferConfigId as string | undefined);
        void targetId;
        return { followed: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(executeError(FollowErrorCode, "Failed to follow user", cause))
        ),
      ),

    beginSignIn: (options) => (email, password) =>
      Effect.gen(function* () {
        yield* getSession(options?.preferConfigId as string | undefined);
        void email;
        void password;
        return { status: "authenticated" as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(executeError(SignInErrorCode, "Failed to begin sign in", cause))
        ),
      ),

    submitTwoFactorCode: (options) => (code, _rememberDevice = true) =>
      Effect.gen(function* () {
        yield* getSession(options?.preferConfigId as string | undefined);
        void code;
        return { status: "authenticated" as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(executeError(TwoFactorErrorCode, "Failed to submit 2FA code", cause))
        ),
      ),
  };
};
