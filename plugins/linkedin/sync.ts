// plugins/linkedin/sync.ts
// LinkedIn per-account sync fiber — background observation logic
//
// Periodically observes private LinkedIn state via CDP and emits events
// through injection. The sockpuppet never calls or sees this — it just
// reads the views that the fiber keeps current.
//
// CDP approach: connect via Playwright's connectOverCDP, inject cookies,
// then use page.evaluate(fetch(...)) to call Voyager API endpoints.
// The browser context carries li_at and JSESSIONID automatically.

import { Effect, Schedule } from "effect";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";
import {
  ParticipantId,
  type ParticipantId as ParticipantIdType,
} from "@bernays/server/core";
import { hash } from "@bernays/server/core";
import { BrowserPool } from "@bernays/server/browsers";
import type { Injector } from "@bernays/server/projections";
import type { LinkedInAccount } from "./account.ts";
import {
  LinkedInAnchorMessageObservedSchema,
  LinkedInAuthObservedSchema,
  LinkedInConversationsSyncedSchema,
  type LinkedInEvent,
  LinkedInMessageObservedSchema,
} from "./schemas.ts";
import type { LinkedInProfileViewingMode } from "./browser.ts";
import { LinkedInInjectionTag } from "./service.ts";

// =============================================================================
// Voyager API Types
// =============================================================================

/** Shape of a participant in a Voyager conversation response */
interface VoyagerParticipant {
  readonly participantType?: {
    readonly member?: { readonly distance?: string };
  };
  readonly "com.linkedin.voyager.messaging.MessagingMember"?: {
    readonly miniProfile?: VoyagerMiniProfile;
  };
  readonly hostIdentityUrn?: string;
}

/** Mini profile from Voyager */
interface VoyagerMiniProfile {
  readonly entityUrn?: string;
  readonly publicIdentifier?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly headline?: string;
  readonly occupation?: string;
}

/** Shape of a message event in a Voyager conversation */
interface VoyagerMessageEvent {
  readonly eventContent?: {
    readonly "com.linkedin.voyager.messaging.event.MessageEvent"?: {
      readonly body?: string;
      readonly attributedBody?: { readonly text?: string };
    };
  };
  readonly from?: {
    readonly "com.linkedin.voyager.messaging.MessagingMember"?: {
      readonly miniProfile?: VoyagerMiniProfile;
    };
  };
  readonly entityUrn?: string;
  readonly createdAt?: number;
  readonly subtype?: string;
}

/** Shape of a Voyager conversation */
interface VoyagerConversation {
  readonly entityUrn?: string;
  readonly participants?: readonly VoyagerParticipant[];
  readonly events?: readonly VoyagerMessageEvent[];
  readonly lastActivityAt?: number;
  readonly "com.linkedin.voyager.messaging.Conversation"?: {
    readonly entityUrn?: string;
  };
}

/** Voyager conversations response */
interface VoyagerConversationsResponse {
  readonly elements?: readonly VoyagerConversation[];
  readonly included?: readonly Record<string, unknown>[];
  readonly paging?: {
    readonly count: number;
    readonly start: number;
    readonly total: number;
  };
}

/** Profile viewing options response */
interface ProfileViewingOptionsResponse {
  readonly settingValue?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/** Extract member ID from an entityUrn like "urn:li:fs_miniProfile:ABC123" */
const extractMemberId = (urn?: string): string | undefined => {
  if (!urn) return undefined;
  const parts = urn.split(":");
  return parts[parts.length - 1];
};

/** Extract conversation ID from entityUrn like "urn:li:fs_conversation:1234" */
const extractConversationId = (urn?: string): string | undefined => {
  if (!urn) return undefined;
  const parts = urn.split(":");
  return parts[parts.length - 1];
};

/** Map LinkedIn privacy setting to our enum */
const mapPrivacySetting = (value?: string): LinkedInProfileViewingMode => {
  switch (value) {
    case "DISCLOSE_FULL":
    case "F":
      return "full";
    case "DISCLOSE_ANONYMOUS":
    case "A":
      return "anonymous";
    case "HIDE":
    case "H":
      return "hidden";
    default:
      return "full";
  }
};

/** Generate deterministic canonical ID for a LinkedIn message */
const messageCanonicalId = async (
  conversationId: string,
  messageUrn: string,
): Promise<string> => {
  return await hash("linkedin", conversationId, messageUrn);
};

/** Strip quotes from JSESSIONID cookie value to get CSRF token */
const stripQuotes = (value: string): string => value.replace(/^"(.*)"$/, "$1");

// =============================================================================
// CDP Session Management
// =============================================================================

interface LinkedInCdpContext {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  csrfToken: string;
  selfMemberId: string;
}

/** Connect to CDP, set up context with cookies, verify auth */
const acquireCdpContext = async (
  cdpUrl: string,
): Promise<LinkedInCdpContext | null> => {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();

  // Navigate to LinkedIn to establish cookie context
  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const url = page.url();

  // Check if we got redirected to login/challenge
  if (url.includes("/login") || url.includes("/uas/login")) {
    await browser.close();
    return null;
  }

  // Read cookies
  const cookies = await context.cookies("https://www.linkedin.com");
  const liAtCookie = cookies.find((c) => c.name === "li_at");
  const jsessionCookie = cookies.find((c) => c.name === "JSESSIONID");

  if (!liAtCookie || !jsessionCookie) {
    await browser.close();
    return null;
  }

  const csrfToken = stripQuotes(jsessionCookie.value);

  // Extract self member ID from page
  const selfMemberId = await page.evaluate(() => {
    // LinkedIn embeds the member URN in various places
    const metaTag = document.querySelector('meta[name="user"]');
    if (metaTag) {
      const content = metaTag.getAttribute("content");
      if (content) return content;
    }
    // Try extracting from the feed page code modules
    const scripts = Array.from(document.querySelectorAll("code"));
    for (const script of scripts) {
      const text = script.textContent ?? "";
      const match = text.match(
        /"miniProfile".*?"entityUrn":"urn:li:fs_miniProfile:([^"]+)"/,
      );
      if (match) return match[1];
    }
    // Try the global namespace
    // deno-lint-ignore no-explicit-any
    const w = window as any;
    if (w.__li_deco_ajax) {
      const match = JSON.stringify(w.__li_deco_ajax).match(
        /urn:li:fs_miniProfile:([^"]+)/,
      );
      if (match) return match[1];
    }
    return null;
  }) ?? "";

  return { browser, context, page, csrfToken, selfMemberId };
};

/** Make a Voyager API call through the browser's fetch */
const voyagerFetch = async <T>(
  page: Page,
  endpoint: string,
  csrfToken: string,
  options?: { method?: string; body?: string },
): Promise<T | null> => {
  try {
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
        if (!res.ok) return null;
        return await res.json();
      },
      {
        endpoint: `https://www.linkedin.com${endpoint}`,
        csrfToken,
        method: options?.method ?? "GET",
        body: options?.body ?? null,
      },
    ) as T | null;
  } catch {
    return null;
  }
};

// =============================================================================
// Observation Functions
// =============================================================================

/** Check auth status and emit AuthObserved */
const observeAuth = async (
  ctx: LinkedInCdpContext,
  account: LinkedInAccount,
  configId: string,
  injection: Injector<LinkedInEvent>,
): Promise<"authenticated" | "expired" | "challenged"> => {
  const url = ctx.page.url();

  // Check for challenge/checkpoint
  if (
    url.includes("/checkpoint/challenge") ||
    url.includes("/checkpoint/challengesV2")
  ) {
    // Detect challenge type from DOM
    const challengeType = await ctx.page.evaluate(() => {
      if (
        document.getElementById("email-pin-submit-button") ||
        document.getElementById("email-pin-challenge")
      ) {
        return "email";
      }
      if (document.querySelector("[id*='input__phone_verification_pin']")) {
        return "phone";
      }
      if (
        document.querySelector(
          "[id*='d_checkpoint_ch_linkedInAppChallengeActivityDevice']",
        )
      ) {
        return "mobile_app";
      }
      if (document.getElementById("auth-app-div")) {
        return "authenticator";
      }
      if (document.querySelector("[id*='captchaV2Challenge']")) {
        return "captcha";
      }
      return "unknown";
    });

    await Effect.runPromise(
      injection.append(LinkedInAuthObservedSchema.parse({
        scope: "linkedin",
        type: "AuthObserved",
        configId,
        participantId: account.id,
        status: "challenged",
        challengeType,
      })).pipe(
        Effect.catchAll(() => Effect.void),
      ),
    );

    return "challenged";
  }

  // Check cookies
  const cookies = await ctx.context.cookies("https://www.linkedin.com");
  const liAt = cookies.find((c) => c.name === "li_at");

  const status = liAt ? "authenticated" : "expired";

  await Effect.runPromise(
    injection.append(LinkedInAuthObservedSchema.parse({
      scope: "linkedin",
      type: "AuthObserved",
      configId,
      participantId: account.id,
      status,
    })).pipe(
      Effect.catchAll(() => Effect.void),
    ),
  );

  return status;
};

/** Read profile viewing privacy mode */
const observeProfileViewingMode = async (
  ctx: LinkedInCdpContext,
): Promise<LinkedInProfileViewingMode> => {
  const response = await voyagerFetch<ProfileViewingOptionsResponse>(
    ctx.page,
    "/mysettings-api/settingsApiSettingCards/profileViewingOptions",
    ctx.csrfToken,
  );

  return mapPrivacySetting(response?.settingValue);
};

/** Sync inbox conversations and emit events */
const observeInbox = async (
  ctx: LinkedInCdpContext,
  account: LinkedInAccount,
  _configId: string,
  injection: Injector<LinkedInEvent>,
  seenMessages: Set<string>,
): Promise<{ threadCount: number }> => {
  const response = await voyagerFetch<VoyagerConversationsResponse>(
    ctx.page,
    "/voyager/api/voyagerMessagingDashMessengerConversations?decorationId=com.linkedin.voyager.dash.deco.messaging.FullConversation-17&count=40",
    ctx.csrfToken,
  );

  if (!response?.elements) {
    return { threadCount: 0 };
  }

  const selfId = account.id;
  let threadCount = 0;

  for (const conversation of response.elements) {
    const conversationId = extractConversationId(conversation.entityUrn);
    if (!conversationId) continue;

    threadCount++;

    // Extract participants
    const participants: ParticipantIdType<"linkedin">[] = [];
    if (conversation.participants) {
      for (const p of conversation.participants) {
        const miniProfile = p["com.linkedin.voyager.messaging.MessagingMember"]
          ?.miniProfile;
        const memberId = extractMemberId(miniProfile?.entityUrn) ??
          extractMemberId(p.hostIdentityUrn);
        if (memberId) {
          participants.push(ParticipantId("linkedin", memberId));
        }
      }
    }

    // Ensure self is in participants
    if (!participants.some((p) => p === selfId)) {
      participants.push(selfId);
    }

    // Process messages (events)
    const events = conversation.events ?? [];
    let isFirstInThread = true;

    // Track predecessorId for message chaining
    let lastCanonicalId: string | null = null;

    // Sort by createdAt ascending
    const sortedEvents = [...events].sort(
      (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
    );

    for (const msgEvent of sortedEvents) {
      const messageUrn = msgEvent.entityUrn ?? "";
      if (!messageUrn) continue;

      // Skip already-seen messages
      if (seenMessages.has(messageUrn)) {
        // Still need to track the canonical ID for predecessor chaining
        const cid = await messageCanonicalId(conversationId, messageUrn);
        lastCanonicalId = cid;
        isFirstInThread = false;
        continue;
      }
      seenMessages.add(messageUrn);

      const canonicalId = await messageCanonicalId(conversationId, messageUrn);

      // Extract sender
      const fromProfile = msgEvent.from
        ?.["com.linkedin.voyager.messaging.MessagingMember"]?.miniProfile;
      const senderMemberId = extractMemberId(fromProfile?.entityUrn);
      const senderId = senderMemberId
        ? `linkedin:${senderMemberId}`
        : String(selfId);

      // Extract content
      const msgContent = msgEvent.eventContent
        ?.["com.linkedin.voyager.messaging.event.MessageEvent"];
      const content = msgContent?.attributedBody?.text ?? msgContent?.body ??
        "";

      const timestamp = msgEvent.createdAt
        ? new Date(msgEvent.createdAt).toISOString()
        : new Date().toISOString();

      if (isFirstInThread) {
        // Emit AnchorMessageObserved
        await Effect.runPromise(
          injection.append(LinkedInAnchorMessageObservedSchema.parse({
            scope: "linkedin",
            type: "AnchorMessageObserved",
            timestamp,
            canonicalId,
            senderId,
            content,
            threadId: conversationId,
            anchor: {
              conversationId,
              participants: participants.map(String),
            },
          })).pipe(
            Effect.catchAll(() => Effect.void),
          ),
        );
      } else {
        // Emit MessageObserved
        const predecessorId = lastCanonicalId ?? canonicalId;
        await Effect.runPromise(
          injection.append(LinkedInMessageObservedSchema.parse({
            scope: "linkedin",
            type: "MessageObserved",
            timestamp,
            canonicalId,
            senderId,
            content,
            threadId: conversationId,
            predecessorId,
          })).pipe(
            Effect.catchAll(() => Effect.void),
          ),
        );
      }

      lastCanonicalId = canonicalId;
      isFirstInThread = false;
    }

    // Update contact info from conversation participants
    if (conversation.participants) {
      for (const p of conversation.participants) {
        const miniProfile = p["com.linkedin.voyager.messaging.MessagingMember"]
          ?.miniProfile;
        if (!miniProfile) continue;
        const memberId = extractMemberId(miniProfile.entityUrn);
        if (!memberId) continue;
        // Contact info is tracked implicitly via AnchorMessageObserved
        // and MessageObserved events in the behavior layer
      }
    }
  }

  // Emit ConversationsSynced
  const syncedAt = new Date().toISOString();
  await Effect.runPromise(
    injection.append(LinkedInConversationsSyncedSchema.parse({
      scope: "linkedin",
      type: "ConversationsSynced",
      participantId: account.id,
      threadCount,
      syncedAt,
    })).pipe(
      Effect.catchAll(() => Effect.void),
    ),
  );

  return { threadCount };
};

// =============================================================================
// Sync Fiber Factory
// =============================================================================

/**
 * Create a per-account sync fiber that observes LinkedIn state.
 *
 * Yields BrowserPool and Injector from Effect context — both are provided
 * by makePlatformLayer, so this fiber must be forked in that context.
 *
 * Observation tasks and frequencies (from Waalaxy internals):
 * - Auth check: every cycle (2 min)
 * - Inbox sync: every cycle (2 min)
 * - Profile viewing mode: once on startup, then every 30th cycle
 * - Connection status: every 30th cycle (~60 min)
 *
 * The sync fiber emits events through injection. The projection fiber
 * (in makePlatformLayer) folds them into the Ref<PluginState>.
 */
export const makeLinkedInSync = (
  account: LinkedInAccount,
): Effect.Effect<never, never, Injector<LinkedInEvent> | BrowserPool> =>
  Effect.gen(function* () {
    const pool = yield* BrowserPool;
    const injection = yield* LinkedInInjectionTag;

    const configId = account.browserBindings[0]?.configId;
    if (!configId) {
      yield* Effect.logWarning("LinkedIn Sync: No Browser Bindings Available");
      return yield* Effect.never;
    }

    let cycle = 0;
    let profileViewingMode: LinkedInProfileViewingMode = "full";
    const seenMessages = new Set<string>();

    yield* Effect.repeat(
      Effect.gen(function* () {
        cycle++;
        yield* Effect.logDebug(`LinkedIn Sync Cycle ${cycle}`);

        // Acquire CDP session
        const session = yield* pool.getSession(configId).pipe(
          Effect.catchAll((err) => {
            return Effect.fail(`Browser Session Error: ${err.message}`);
          }),
        );

        // Connect via CDP and set up context
        const ctx = yield* Effect.tryPromise({
          try: () => acquireCdpContext(session.cdpUrl),
          catch: (err) => `CDP Connect Error: ${err}`,
        });

        if (!ctx) {
          // Auth expired — emit expired status
          yield* injection.append(LinkedInAuthObservedSchema.parse({
            scope: "linkedin",
            type: "AuthObserved",
            configId: String(configId),
            participantId: account.id,
            status: "expired",
          })).pipe(
            Effect.catchAll(() => Effect.void),
          );
          return;
        }

        // Run observation, always close browser afterward
        yield* Effect.ensuring(
          Effect.gen(function* () {
            // 1. Auth check
            const authStatus = yield* Effect.tryPromise({
              try: () =>
                observeAuth(ctx, account, String(configId), injection),
              catch: (err) => `Auth Check Error: ${err}`,
            });

            if (authStatus !== "authenticated") {
              return;
            }

            // 2. Profile viewing mode (first cycle or every 30th)
            if (cycle === 1 || cycle % 30 === 0) {
              profileViewingMode = yield* Effect.tryPromise({
                try: () => observeProfileViewingMode(ctx),
                catch: () => "full" as LinkedInProfileViewingMode,
              });

              // Re-emit auth with profile viewing mode
              yield* injection.append(LinkedInAuthObservedSchema.parse({
                scope: "linkedin",
                type: "AuthObserved",
                configId: String(configId),
                participantId: account.id,
                status: "authenticated",
                profileViewingMode,
              })).pipe(
                Effect.catchAll(() => Effect.void),
              );
            }

            // 3. Inbox sync
            yield* Effect.tryPromise({
              try: () =>
                observeInbox(
                  ctx,
                  account,
                  String(configId),
                  injection,
                  seenMessages,
                ),
              catch: (err) => `Inbox Sync Error: ${err}`,
            });
          }),
          Effect.promise(() => ctx.browser.close().catch(() => {})),
        );
      }).pipe(
        Effect.catchAll((err) =>
          Effect.logWarning(`LinkedIn Sync Error: ${err}`)
        ),
      ),
      Schedule.spaced("2 minutes").pipe(Schedule.jittered),
    );

    // Never returns — runs until scope is closed
    return yield* Effect.never;
  });
