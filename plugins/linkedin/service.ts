// plugins/linkedin/service.ts
// LinkedIn platform service — typed context tag, actions interface, and factory
//
// Actions follow the messageboard pattern: yield the Injector from Effect
// context to emit events. The Injector is provided by makePlatformLayer.

import { Context, Effect } from "effect";
import {
  BrowserConfigId,
  CanonicalId,
  type ThreadId,
} from "@bernays/server/core";
import { hash } from "@bernays/server/core";
import type { BrowserPoolService, CdpSession } from "@bernays/server/browsers";
import {
  type ExecuteError,
  executeError,
  ExecuteErrorCode,
  type PlatformService,
} from "@bernays/server/platforms";
import { type Injector, makeInjectorTag } from "@bernays/server/projections";
import { chromium } from "playwright";
import type { LinkedInAccount } from "./account.ts";
import type { LinkedInBrowser } from "./browser.ts";
import type { LinkedInContact } from "./contact.ts";
import {
  type LinkedInEvent,
  LinkedInConnectionRequestSentSchema,
  LinkedInInvitationWithdrawnSchema,
  LinkedInMessageRequestSentSchema,
  LinkedInMessageSentSchema,
  LinkedInProfileViewedSchema,
  type LinkedInScope,
  LinkedInUserFollowedSchema,
} from "./schemas.ts";
import type { LinkedInInbox, LinkedInThread } from "./views.ts";

// =============================================================================
// Helpers
// =============================================================================

/** Extract a message string from an unknown error value. */
const errorMessage = (cause: unknown, fallback: string): string => {
  if (cause !== null && typeof cause === "object" && "message" in cause) {
    return String((cause as Record<string, unknown>).message);
  }
  return fallback;
};

// =============================================================================
// Injection Tag (defined here to avoid circular deps with mod.ts)
// =============================================================================

/**
 * Injector tag for LinkedIn events. Defined here so actions can yield it.
 * Re-exported from mod.ts as LinkedInInjection.
 */
export const LinkedInInjectionTag = makeInjectorTag<LinkedInEvent>(
  "linkedin/Injection",
);

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
export const MessageRequestErrorCode = ExecuteErrorCode(
  "linkedin:message_request",
);
export const SignInErrorCode = ExecuteErrorCode("linkedin:sign_in");
export const TwoFactorErrorCode = ExecuteErrorCode("linkedin:two_factor");
export const RestrictionErrorCode = ExecuteErrorCode("linkedin:restriction");

export type SendMessageError = ExecuteError;
export type ConnectionError = ExecuteError;
export type ProfileError = ExecuteError;
export type SignInError = ExecuteError;
export type TwoFactorError = ExecuteError;

// =============================================================================
// Voyager API Helpers
// =============================================================================

/** Strip surrounding quotes from JSESSIONID value */
const stripQuotes = (value: string): string => value.replace(/^"(.*)"$/, "$1");

/** Make a Voyager API call through the browser's fetch context */
const voyagerFetch = async <T>(
  page: import("playwright").Page,
  endpoint: string,
  csrfToken: string,
  options?: { method?: string; body?: string },
): Promise<
  { ok: boolean; status: number; data: T | null; errorCode?: string }
> => {
  return await page.evaluate(
    async ({ endpoint, csrfToken, method, body }) => {
      const headers: Record<string, string> = {
        "csrf-token": csrfToken,
        "x-restli-protocol-version": "2.0.0",
      };
      if (body) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(endpoint, {
        method: method ?? "GET",
        headers,
        body: body ?? undefined,
        credentials: "include",
      });
      if (!res.ok) {
        let errorCode: string | undefined;
        try {
          const errBody = await res.text();
          // Try to extract error code from response body
          const match = errBody.match(/"code"\s*:\s*"([^"]+)"/);
          if (match) errorCode = match[1];
        } catch { /* ignore */ }
        return { ok: false, status: res.status, data: null, errorCode };
      }
      const data = await res.json();
      return { ok: true, status: res.status, data, errorCode: undefined };
    },
    {
      endpoint: `https://www.linkedin.com${endpoint}`,
      csrfToken,
      method: options?.method ?? "GET",
      body: options?.body ?? null,
    },
  );
};

/** Connect to CDP, get a page with cookies, extract CSRF token */
const acquirePage = async (
  cdpUrl: string,
): Promise<
  {
    browser: import("playwright").Browser;
    page: import("playwright").Page;
    csrfToken: string;
  } | null
> => {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();

  // Navigate to set up cookie context
  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const cookies = await context.cookies("https://www.linkedin.com");
  const jsessionCookie = cookies.find((c) => c.name === "JSESSIONID");
  const liAtCookie = cookies.find((c) => c.name === "li_at");

  if (!jsessionCookie || !liAtCookie) {
    await browser.close();
    return null;
  }

  return {
    browser,
    page,
    csrfToken: stripQuotes(jsessionCookie.value),
  };
};

/** Map connect error response to restriction event or throw */
const mapConnectError = (
  status: number,
  errorCode?: string,
): { restrictionType: string; message: string } | null => {
  if (status === 429) {
    return {
      restrictionType: "desktop_connect_restricted",
      message: "Rate limited (429)",
    };
  }
  if (status === 400) {
    switch (errorCode) {
      case "MAX_INVITATION_SENT":
      case "PRIMARY_HANDLE_NOT_CONFIRMED":
        return {
          restrictionType: "desktop_connect_restricted",
          message: `Connect restricted: ${errorCode}`,
        };
      case "CANT_INVITE_CONNECTION_LIMIT_REACHED":
        return {
          restrictionType: "weekly_invites_exhausted",
          message: "Weekly connection limit reached",
        };
      default:
        return {
          restrictionType: "desktop_connect_restricted",
          message: `Connect error: ${errorCode ?? "unknown"}`,
        };
    }
  }
  return null;
};

// =============================================================================
// LinkedIn Actions Interface
// =============================================================================

/** Injector context requirement for LinkedIn actions */
type InjectorR = Injector<LinkedInEvent>;

/**
 * LinkedIn-specific actions — intentional acts the sockpuppet performs.
 *
 * Actions follow the curried PlatformMethod pattern for browser selection.
 * Each action yields the LinkedInInjection service from Effect context
 * to emit events after performing the act.
 */
export interface LinkedInActions {
  readonly sendMessage: (
    options?: { preferConfigId?: string },
  ) => (
    threadId: ThreadId,
    content: string,
  ) => Effect.Effect<MessageSentResult, SendMessageError, InjectorR>;

  readonly sendMessageRequest: (
    options?: { preferConfigId?: string },
  ) => (
    targetId: string,
    content: string,
    contextUrn?: string,
  ) => Effect.Effect<MessageRequestSentResult, ExecuteError, InjectorR>;

  readonly sendConnectionRequest: (
    options?: { preferConfigId?: string },
  ) => (
    targetId: string,
    note?: string,
  ) => Effect.Effect<ConnectionRequestResult, ConnectionError, InjectorR>;

  readonly withdrawInvitation: (
    options?: { preferConfigId?: string },
  ) => (
    invitationId: string,
  ) => Effect.Effect<InvitationWithdrawnResult, ConnectionError, InjectorR>;

  readonly viewProfile: (
    options?: { preferConfigId?: string },
  ) => (
    targetId: string,
  ) => Effect.Effect<ProfileViewedResult, ProfileError, InjectorR>;

  readonly followUser: (
    options?: { preferConfigId?: string },
  ) => (
    targetId: string,
  ) => Effect.Effect<FollowUserResult, ExecuteError, InjectorR>;

  readonly beginSignIn: (
    options?: { preferConfigId?: string },
  ) => (
    email: string,
    password: string,
  ) => Effect.Effect<BeginSignInResult, SignInError>;

  readonly submitTwoFactorCode: (
    options?: { preferConfigId?: string },
  ) => (
    code: string,
    rememberDevice?: boolean,
  ) => Effect.Effect<TwoFactorResult, ExecuteError>;
}

// =============================================================================
// Actions Factory
// =============================================================================

/**
 * Create LinkedIn actions for a specific account.
 * Actions are intentional acts — not observations.
 * Each action gets a CDP session, connects via Playwright, performs the
 * act via Voyager API, emits events through the injector, and cleans up.
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

  /** Get a Playwright page connected to CDP with cookies */
  const withPage = <A>(
    preferConfigId: string | undefined,
    errorCode: ReturnType<typeof ExecuteErrorCode>,
    fn: (page: import("playwright").Page, csrfToken: string) => Promise<A>,
  ): Effect.Effect<A, ExecuteError> =>
    Effect.gen(function* () {
      const session = yield* getSession(preferConfigId);
      const ctx = yield* Effect.tryPromise({
        try: () => acquirePage(session.cdpUrl),
        catch: (err) => executeError(errorCode, `CDP connect error: ${err}`),
      });
      if (!ctx) {
        return yield* Effect.fail(
          executeError(
            errorCode,
            "Authentication expired — cannot acquire page",
          ),
        );
      }
      return yield* Effect.ensuring(
        Effect.tryPromise({
          try: () => fn(ctx.page, ctx.csrfToken),
          catch: (err) => executeError(errorCode, `Action error: ${err}`),
        }),
        Effect.promise(() => ctx.browser.close().catch(() => {})),
      );
    });

  return {
    // ── sendMessage ──────────────────────────────────────────────
    sendMessage: (options) => (threadId, content) =>
      Effect.gen(function* () {
        const injector = yield* LinkedInInjectionTag;

        yield* withPage(
          options?.preferConfigId,
          SendMessageErrorCode,
          async (page, csrfToken) => {
            const result = await voyagerFetch(
              page,
              "/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",
              csrfToken,
              {
                method: "POST",
                body: JSON.stringify({
                  conversationUrn: `urn:li:fs_conversation:${threadId}`,
                  body: content,
                }),
              },
            );
            if (!result.ok) {
              throw new Error(`Send message failed: HTTP ${result.status}`);
            }
          },
        );

        // Emit MessageSent event
        const canonicalId = yield* Effect.promise(() =>
          hash(
            "linkedin",
            String(threadId),
            content,
            new Date().toISOString(),
          ).then(CanonicalId)
        );

        yield* injector.append(LinkedInMessageSentSchema.parse({
          scope: "linkedin",
          type: "MessageSent",
          threadId,
          canonicalId,
          content,
        })).pipe(
          Effect.catchAll(() => Effect.void),
        );

        return { success: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(
              SendMessageErrorCode,
              errorMessage(cause, "Failed to send message"),
              cause,
            ),
          )
        ),
      ),

    // ── sendMessageRequest ───────────────────────────────────────
    sendMessageRequest: (options) => (targetId, content, contextUrn) =>
      Effect.gen(function* () {
        const injector = yield* LinkedInInjectionTag;

        yield* withPage(
          options?.preferConfigId,
          MessageRequestErrorCode,
          async (page, csrfToken) => {
            const body: Record<string, unknown> = {
              body: content,
              recipients: [`urn:li:fsd_profile:${targetId}`],
            };
            if (contextUrn) {
              body.messageRequestContextByRecipient = {
                [`urn:li:fsd_profile:${targetId}`]: {
                  contextEntityUrn: contextUrn,
                },
              };
            }
            const result = await voyagerFetch(
              page,
              "/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",
              csrfToken,
              { method: "POST", body: JSON.stringify(body) },
            );
            if (!result.ok) {
              throw new Error(`Message request failed: HTTP ${result.status}`);
            }
          },
        );

        yield* injector.append(LinkedInMessageRequestSentSchema.parse({
          scope: "linkedin",
          type: "MessageRequestSent",
          targetUserId: targetId,
          content,
          contextUrn: contextUrn ?? "",
        })).pipe(
          Effect.catchAll(() => Effect.void),
        );

        return { sent: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(
              MessageRequestErrorCode,
              "Failed to send message request",
              cause,
            ),
          )
        ),
      ),

    // ── sendConnectionRequest ────────────────────────────────────
    sendConnectionRequest: (options) => (targetId, note) =>
      Effect.gen(function* () {
        const injector = yield* LinkedInInjectionTag;
        let invitationId: string | undefined;

        yield* withPage(
          options?.preferConfigId,
          ConnectionErrorCode,
          async (page, csrfToken) => {
            const body: Record<string, unknown> = {
              invitee: {
                inviteeUnion: {
                  memberProfile: `urn:li:fsd_profile:${targetId}`,
                },
              },
            };
            if (note) {
              body.customMessage = note;
            }

            const result = await voyagerFetch<{
              value?: {
                invitationId?: string;
                invitation?: { entityUrn?: string };
              };
            }>(
              page,
              "/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2",
              csrfToken,
              { method: "POST", body: JSON.stringify(body) },
            );

            if (!result.ok) {
              // Map error to restriction
              const restriction = mapConnectError(
                result.status,
                result.errorCode,
              );
              if (restriction) {
                // Emit restriction event
                const retryAfter = new Date(Date.now() + 60 * 60 * 1000)
                  .toISOString();
                const configId = options?.preferConfigId ??
                  account.browserBindings[0]?.configId;

                // We need to emit restriction event here
                // but we're in async context — use the injector later
                throw new Error(
                  `RESTRICTION:${restriction.restrictionType}:${retryAfter}:${configId}:${restriction.message}`,
                );
              }
              throw new Error(
                `Connection request failed: HTTP ${result.status}`,
              );
            }

            // Extract invitation ID from response
            if (result.data?.value?.invitation?.entityUrn) {
              const urn = result.data.value.invitation.entityUrn;
              invitationId = urn.split(":").pop();
            }
          },
        );

        // Emit ConnectionRequestSent event
        yield* injector.append(LinkedInConnectionRequestSentSchema.parse({
          scope: "linkedin",
          type: "ConnectionRequestSent",
          targetUserId: targetId,
          note,
          invitationId,
        })).pipe(
          Effect.catchAll(() => Effect.void),
        );

        return { sent: true as const, invitationId };
      }).pipe(
        Effect.catchAll((cause) => {
          const msg = errorMessage(cause, "");
          // Check if this is a restriction error
          if (msg.startsWith("RESTRICTION:")) {
            // Format: RESTRICTION:<type>:<retryAfter>:<configId>:<message>
            // TODO: emit RestrictionObserved event via injector
            const parts = msg.split(":");
            const errorMsg = parts.slice(4).join(":");
            return Effect.fail(
              executeError(
                ConnectionErrorCode,
                errorMsg || "Connection restricted",
                cause,
              ),
            );
          }
          return Effect.fail(
            executeError(
              ConnectionErrorCode,
              "Failed to send connection request",
              cause,
            ),
          );
        }),
      ),

    // ── withdrawInvitation ───────────────────────────────────────
    withdrawInvitation: (options) => (invitationId) =>
      Effect.gen(function* () {
        const injector = yield* LinkedInInjectionTag;
        const targetUserId = invitationId; // fallback

        yield* withPage(
          options?.preferConfigId,
          ConnectionErrorCode,
          async (page, csrfToken) => {
            const encodedUrn = encodeURIComponent(
              `urn:li:fsd_invitation:${invitationId}`,
            );
            const result = await voyagerFetch(
              page,
              `/voyager/api/voyagerRelationshipsDashInvitations/${encodedUrn}?action=withdraw`,
              csrfToken,
              {
                method: "POST",
                body: JSON.stringify({ invitationType: "CONNECTION" }),
              },
            );
            if (!result.ok) {
              throw new Error(
                `Withdraw invitation failed: HTTP ${result.status}`,
              );
            }
          },
        );

        // Emit InvitationWithdrawn event
        yield* injector.append(LinkedInInvitationWithdrawnSchema.parse({
          scope: "linkedin",
          type: "InvitationWithdrawn",
          invitationId,
          targetUserId,
        })).pipe(
          Effect.catchAll(() => Effect.void),
        );

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

    // ── viewProfile ──────────────────────────────────────────────
    viewProfile: (options) => (targetId) =>
      Effect.gen(function* () {
        const injector = yield* LinkedInInjectionTag;
        let viewerPrivacySetting: "full" | "anonymous" | "hidden" = "full";

        yield* withPage(
          options?.preferConfigId,
          ProfileErrorCode,
          async (page, csrfToken) => {
            // 1. Read profile viewing privacy setting
            const settingsResult = await voyagerFetch<{
              settingValue?: string;
            }>(
              page,
              "/mysettings-api/settingsApiSettingCards/profileViewingOptions",
              csrfToken,
            );
            if (settingsResult.ok && settingsResult.data?.settingValue) {
              const val = settingsResult.data.settingValue;
              if (val === "DISCLOSE_FULL") viewerPrivacySetting = "full";
              else if (val === "DISCLOSE_ANONYMOUS") {
                viewerPrivacySetting = "anonymous";
              } else if (val === "HIDE") viewerPrivacySetting = "hidden";
            }

            // 2. Map to API letter code
            const privacyCode = viewerPrivacySetting === "full"
              ? "F"
              : viewerPrivacySetting === "anonymous"
              ? "A"
              : "H";

            // 3. Submit profile view tracking beacon
            const trackResult = await voyagerFetch(
              page,
              "/li/track",
              csrfToken,
              {
                method: "POST",
                body: JSON.stringify({
                  eventBody: {
                    viewerPrivacySetting: privacyCode,
                    vieweeMemberUrn: `urn:li:member:${targetId}`,
                    entityView: { viewType: "profile-view" },
                    header: {
                      pageUrn: "urn:li:page:d_flagship3_profile_view_base",
                    },
                  },
                }),
              },
            );
            if (!trackResult.ok) {
              throw new Error(
                `Profile view tracking failed: HTTP ${trackResult.status}`,
              );
            }
          },
        );

        // Emit ProfileViewed event
        const viewedAt = new Date().toISOString();
        yield* injector.append(LinkedInProfileViewedSchema.parse({
          scope: "linkedin",
          type: "ProfileViewed",
          targetUserId: targetId,
          viewedAt,
          viewerPrivacySetting,
        })).pipe(
          Effect.catchAll(() => Effect.void),
        );

        return { viewed: true as const, viewerPrivacySetting };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(ProfileErrorCode, "Failed to view profile", cause),
          )
        ),
      ),

    // ── followUser ───────────────────────────────────────────────
    followUser: (options) => (targetId) =>
      Effect.gen(function* () {
        const injector = yield* LinkedInInjectionTag;

        yield* withPage(
          options?.preferConfigId,
          FollowErrorCode,
          async (page, csrfToken) => {
            const encodedUrn = encodeURIComponent(
              `urn:li:fsd_followingState:urn:li:fsd_profile:${targetId}`,
            );
            const result = await voyagerFetch(
              page,
              `/voyager/api/feed/dash/followingStates/${encodedUrn}`,
              csrfToken,
              {
                method: "POST",
                body: JSON.stringify({
                  patch: { "$set": { following: true } },
                }),
              },
            );
            if (!result.ok) {
              throw new Error(`Follow user failed: HTTP ${result.status}`);
            }
          },
        );

        // Emit UserFollowed event
        yield* injector.append(LinkedInUserFollowedSchema.parse({
          scope: "linkedin",
          type: "UserFollowed",
          targetUserId: targetId,
        })).pipe(
          Effect.catchAll(() => Effect.void),
        );

        return { followed: true as const };
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(FollowErrorCode, "Failed to follow user", cause),
          )
        ),
      ),

    // ── beginSignIn ──────────────────────────────────────────────
    beginSignIn: (options) => (email, password) =>
      Effect.gen(function* () {
        const session = yield* getSession(options?.preferConfigId);

        return yield* Effect.tryPromise({
          try: async () => {
            const browser = await chromium.connectOverCDP(session.cdpUrl);
            try {
              const context = browser.contexts()[0] ??
                await browser.newContext();
              const page = context.pages()[0] ?? await context.newPage();

              // Navigate to login page
              await page.goto(
                "https://www.linkedin.com/login?fromSignIn=true&trk=guest_homepage-basic_nav-header-signin",
                { waitUntil: "domcontentloaded", timeout: 30_000 },
              );

              // Fill credentials
              await page.fill("#username", email);
              await page.fill("#password", password);
              await page.click('[data-litms-control-urn="login-submit"]');
              await page.waitForNavigation({ timeout: 15_000 }).catch(() => {});

              const url = page.url();

              // Check outcome
              if (url.includes("/feed") || url.includes("/mynetwork")) {
                return { status: "authenticated" as const };
              }

              if (
                url.includes("/checkpoint/challenge") ||
                url.includes("/checkpoint/challengesV2")
              ) {
                const challengeType = await page.evaluate(() => {
                  if (
                    document.getElementById("email-pin-submit-button")
                  ) return "email";
                  if (
                    document.querySelector(
                      "[id*='input__phone_verification_pin']",
                    )
                  ) return "phone";
                  if (
                    document.querySelector(
                      "[id*='d_checkpoint_ch_linkedInAppChallengeActivityDevice']",
                    )
                  ) return "mobile_app";
                  if (
                    document.getElementById("auth-app-div")
                  ) return "authenticator";
                  if (
                    document.querySelector("[id*='captchaV2Challenge']")
                  ) return "captcha";
                  return "unknown";
                });
                return { status: "challenged" as const, challengeType };
              }

              const hasError = await page.evaluate(() => {
                const el = document.getElementById("error-for-password");
                return el ? el.textContent?.trim() ?? "" : "";
              });

              if (hasError) {
                return {
                  status: "failed" as const,
                  errorCode: "wrong_credentials",
                  error: hasError,
                };
              }

              return { status: "failed" as const, errorCode: "unknown" };
            } finally {
              await browser.close().catch(() => {});
            }
          },
          catch: (err) =>
            executeError(SignInErrorCode, `Sign in error: ${err}`),
        });
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.fail(
            executeError(SignInErrorCode, "Failed to begin sign in", cause),
          )
        ),
      ),

    // ── submitTwoFactorCode ──────────────────────────────────────
    submitTwoFactorCode: (options) => (code, _rememberDevice = true) =>
      Effect.gen(function* () {
        const session = yield* getSession(options?.preferConfigId);

        return yield* Effect.tryPromise({
          try: async () => {
            const browser = await chromium.connectOverCDP(session.cdpUrl);
            try {
              const context = browser.contexts()[0] ??
                await browser.newContext();
              const page = context.pages()[0] ?? await context.newPage();

              // Should already be on challenge page — fill the code
              const pinInput = page.locator(
                'input[name="pin"], input[id*="verification_pin"], input[id*="input__email_verification_pin"]',
              );
              await pinInput.fill(code);

              // Submit
              const submitButton = page.locator(
                'button[id*="submit"], button[type="submit"]',
              );
              await submitButton.click();
              await page.waitForNavigation({ timeout: 15_000 }).catch(() => {});

              const url = page.url();
              if (url.includes("/feed") || url.includes("/mynetwork")) {
                return { status: "authenticated" as const };
              }

              return {
                status: "failed" as const,
                errorCode: "challenge_failed",
              };
            } finally {
              await browser.close().catch(() => {});
            }
          },
          catch: (err) => executeError(TwoFactorErrorCode, `2FA error: ${err}`),
        });
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
