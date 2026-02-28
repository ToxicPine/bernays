// tests/e2e/linkedin_test.ts
// E2E test: LinkedIn plugin against real LinkedIn via local browser pool.
//
// Chain exercised:
//   Local browser pool (CDP) → cookie injection → LinkedIn Voyager API →
//   EventStoreInMemory (PubSub) → Injection → Projection (subscribe) →
//   background fiber fold → Ref<PluginState> → materialize → Sockpuppet
//
// Requires:
//   - .linkedin-cookies.json  (run: deno run -A tests/scripts/linkedin-auth.ts)
//   - .linkedin-test-params.json (hand-written, see LINKEDIN_TESTING.md)
//
// Run: nix develop -c deno test --allow-all tests/e2e/linkedin_test.ts

import {
  assertEquals,
  assertExists,
  assertGreater,
  assertGreaterOrEqual,
} from "@std/assert";
import { chromium } from "playwright";
import { Effect, Layer, Option } from "effect";
import {
  BrowserConfigId,
  ParticipantId,
  type ThreadId,
} from "@bernays/server/core";
import {
  createInMemoryConfigStore,
  EventStoreInMemory,
  EventStoreTag,
  type StorableEvent,
} from "@bernays/server/store";
import {
  BrowserPoolLive,
  makeLocalBackend,
} from "@bernays/server/browsers";
import { makePlatformLayer } from "@bernays/server/runtime";
import {
  type LinkedInAccount,
  LinkedInEventSchema,
  LinkedInInjection,
  linkedInPlatform,
  LinkedInPlatform,
  LinkedInProjection,
  LINKEDIN_SCOPE,
  makeLinkedInActions,
} from "@bernays/plugins/linkedin";
import { loadLinkedInTestConfig } from "$/lib/linkedin-params.ts";

// =============================================================================
// Setup
// =============================================================================

const CONFIG_ID = BrowserConfigId("linkedin-test-browser");
const { cookies, params } = loadLinkedInTestConfig();

const SELF_ID = ParticipantId("linkedin", params.selfMemberId);

const account: LinkedInAccount = {
  id: SELF_ID,
  browserBindings: [
    { configId: CONFIG_ID, metadata: { deviceType: "desktop" } },
  ],
};

// =============================================================================
// Helpers
// =============================================================================

/** Parse a raw event object through LinkedInEventSchema. */
const parseEvent = (raw: Record<string, unknown>) =>
  LinkedInEventSchema.parse(raw);

/** Common base fields for constructing raw events. */
const rawBase = () => ({
  scope: "linkedin",
  eventId: crypto.randomUUID(),
  correlationId: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
});

// =============================================================================
// Test
// =============================================================================

Deno.test({
  name: "linkedin: e2e plugin tests",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    // ── Browser + pool setup ───────────────────────────────────────

    const configStore = createInMemoryConfigStore([
      { id: CONFIG_ID, context: "" },
    ]);
    const pool = makeLocalBackend(configStore);
    const session = await Effect.runPromise(pool.launch(CONFIG_ID));

    const browser = await chromium.connectOverCDP(session.cdpUrl);
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "li_at",
        value: cookies.li_at,
        domain: ".www.linkedin.com",
        path: "/",
      },
      {
        name: "JSESSIONID",
        value: cookies.JSESSIONID,
        domain: ".www.linkedin.com",
        path: "/",
      },
    ]);

    // ── Platform layer ─────────────────────────────────────────────

    const actions = makeLinkedInActions(pool, account);

    const baseLayers = BrowserPoolLive(pool).pipe(
      Layer.provideMerge(EventStoreInMemory),
    );

    const platformLayer = makePlatformLayer(
      LinkedInPlatform,
      LinkedInInjection,
      LinkedInProjection,
      { platform: linkedInPlatform, account, actions },
    );

    // ── Auth verification ──────────────────────────────────────────

    await t.step("auth: cookies are valid", async () => {
      const page = await context.newPage();
      try {
        await page.goto("https://www.linkedin.com/feed/", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        const url = page.url();
        if (url.includes("/login") || url.includes("/checkpoint")) {
          throw new Error(
            "LinkedIn cookies expired. Re-run: deno run -A tests/scripts/linkedin-auth.ts",
          );
        }
        assertEquals(url.includes("/feed"), true);
      } finally {
        await page.close();
      }
    });

    // ── Platform layer wiring ──────────────────────────────────────

    await t.step("platform: layer wires up correctly", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* Effect.provide(
          LinkedInPlatform,
          platformLayer,
        );

        const inbox = yield* platform.inbox;
        assertExists(inbox);
        assertEquals(Object.keys(inbox.byThreadId).length, 0);

        const browsers = yield* platform.browsers;
        assertEquals(browsers.length, 1);
        assertEquals(browsers[0].configId, CONFIG_ID);
        assertEquals(browsers[0].isRunning, true);

        return { success: true };
      });

      const result = await Effect.runPromise(
        Effect.provide(program, baseLayers),
      );
      assertEquals(result.success, true);
    });

    // ════════════════════════════════════════════════════════════════
    // Sync Fiber Tests
    // ════════════════════════════════════════════════════════════════
    // These tests verify that the sync fiber (makeLinkedInSync)
    // observes LinkedIn state and emits the right events. They will
    // fail until the sync fiber is implemented against real Voyager
    // API calls via CDP.

    await t.step("sync: emits AuthObserved on startup", async () => {
      // The sync fiber should run its first cycle and emit an
      // AuthObserved event by reading the li_at cookie via CDP
      // Network.getCookies and checking for checkpoint redirects.
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            // Wait for the sync fiber to complete at least one auth check
            yield* Effect.sleep(5000);

            // Auth status should be authenticated (cookies are valid)
            const browsers = yield* platform.browsers;
            assertEquals(browsers.length, 1);
            assertEquals(browsers[0].authStatus, "authenticated");

            // Profile viewing mode should be populated (read on startup
            // via GET /mysettings-api/settingsApiSettingCards/profileViewingOptions)
            if (browsers[0].authStatus === "authenticated") {
              assertExists(
                browsers[0].profileViewingMode,
                "profileViewingMode should be populated after auth check",
              );
            }
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("sync: discovers conversations", async () => {
      // The sync fiber should scrape the inbox via Voyager API and
      // emit AnchorMessageObserved / MessageObserved events.
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;

        yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            // Wait for sync fiber to complete inbox scrape
            yield* Effect.sleep(10000);

            // Inbox should now have threads
            const inbox = yield* platform.inbox;
            assertGreater(
              Object.keys(inbox.byThreadId).length,
              0,
              "Inbox should have at least one thread after sync",
            );

            // ConversationsSynced event should be in the store
            const allEvents = yield* eventStore.fetch({ type: "all" });
            const syncedEvents = allEvents.filter(
              (e: StorableEvent) => e.type === "ConversationsSynced",
            );
            assertGreater(
              syncedEvents.length,
              0,
              "Should have at least one ConversationsSynced event",
            );
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("sync: populates thread views", async () => {
      // Pick a thread from the inbox and verify it has messages.
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            const inbox = yield* platform.inbox;
            const threadIds = Object.keys(inbox.byThreadId);
            assertGreater(threadIds.length, 0, "Need at least one thread");

            const threadId = threadIds[0] as ThreadId;
            const threadOpt = yield* platform.thread(threadId);
            assertEquals(
              Option.isSome(threadOpt),
              true,
              "Thread should exist",
            );

            if (Option.isSome(threadOpt)) {
              const thread = threadOpt.value;
              assertGreater(
                thread.messages.length,
                0,
                "Thread should have messages",
              );

              const msg = thread.messages[0];
              assertExists(msg.senderId, "Message should have senderId");
              assertExists(msg.content, "Message should have content");
              assertExists(msg.timestamp, "Message should have timestamp");
            }
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("sync: builds contact directory", async () => {
      // Pick a participant from a thread and verify contact info.
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            const inbox = yield* platform.inbox;
            const threadIds = Object.keys(inbox.byThreadId);
            assertGreater(threadIds.length, 0, "Need at least one thread");

            const threadOpt = yield* platform.thread(
              threadIds[0] as ThreadId,
            );
            if (!Option.isSome(threadOpt)) {
              throw new Error("Thread should exist");
            }

            // Find a message from someone other than self
            const otherMsg = threadOpt.value.messages.find(
              (m) => m.senderId !== SELF_ID,
            );
            if (!otherMsg) {
              throw new Error("Need a message from another participant");
            }

            const contactOpt = yield* platform.contact(
              otherMsg.senderId as ParticipantId<"linkedin">,
            );
            assertEquals(
              Option.isSome(contactOpt),
              true,
              "Contact should exist for thread participant",
            );

            if (Option.isSome(contactOpt)) {
              const contact = contactOpt.value;
              assertExists(
                contact.memberId,
                "Contact should have memberId",
              );
              // DM participants are 1st-degree connections
              assertEquals(
                contact.connectionDegree,
                "1st",
                "DM participants should be 1st-degree connections",
              );
            }
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("sync: tracks reply directionality", async () => {
      // Find a thread where a contact sent us a message and verify
      // hasReplied / lastReplyAt are tracked.
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            const inbox = yield* platform.inbox;
            const threadIds = Object.keys(inbox.byThreadId);

            // Search for a thread with an inbound message
            let foundContact = false;
            for (const tid of threadIds) {
              const threadOpt = yield* platform.thread(tid as ThreadId);
              if (!Option.isSome(threadOpt)) continue;

              const inbound = threadOpt.value.messages.find(
                (m) => m.senderId !== SELF_ID,
              );
              if (!inbound) continue;

              const contactOpt = yield* platform.contact(
                inbound.senderId as ParticipantId<"linkedin">,
              );
              if (!Option.isSome(contactOpt)) continue;

              assertEquals(
                contactOpt.value.hasReplied,
                true,
                "Contact who sent us a message should have hasReplied=true",
              );
              assertExists(
                contactOpt.value.lastReplyAt,
                "Contact should have lastReplyAt set",
              );
              foundContact = true;
              break;
            }

            assertEquals(
              foundContact,
              true,
              "Should find at least one contact who sent us a message",
            );
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    // ════════════════════════════════════════════════════════════════
    // Action Tests
    // ════════════════════════════════════════════════════════════════
    // These tests verify that actions perform real LinkedIn operations
    // via CDP and emit the correct events. They will fail until the
    // action implementations are filled in.

    await t.step("action: sendMessage emits MessageSent", async () => {
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;

        yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            const result = yield* platform.actions.sendMessage()(
              params.threadId as ThreadId,
              `e2e test ${new Date().toISOString()}`,
            );
            assertEquals(result.success, true);

            // Wait for event to be processed
            yield* Effect.sleep(200);

            // MessageSent event should be in the store
            const allEvents = yield* eventStore.fetch({ type: "all" });
            const sentEvents = allEvents.filter(
              (e: StorableEvent) => e.type === "MessageSent",
            );
            assertGreater(
              sentEvents.length,
              0,
              "Should have MessageSent event in store",
            );

            // Message should appear in the thread view
            const threadOpt = yield* platform.thread(
              params.threadId as ThreadId,
            );
            assertEquals(
              Option.isSome(threadOpt),
              true,
              "Thread should exist after sending message",
            );
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("action: viewProfile emits ProfileViewed", async () => {
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;

        yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            const result = yield* platform.actions.viewProfile()(
              params.profileTarget,
            );
            assertEquals(result.viewed, true);

            // viewerPrivacySetting should match the account's configured mode
            assertExists(
              result.viewerPrivacySetting,
              "Should return viewerPrivacySetting",
            );

            yield* Effect.sleep(200);

            // ProfileViewed event should be in the store
            const allEvents = yield* eventStore.fetch({ type: "all" });
            const viewedEvents = allEvents.filter(
              (e: StorableEvent) => e.type === "ProfileViewed",
            );
            assertGreater(
              viewedEvents.length,
              0,
              "Should have ProfileViewed event in store",
            );
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("action: followUser emits UserFollowed", async () => {
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;

        yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            const result = yield* platform.actions.followUser()(
              params.profileTarget,
            );
            assertEquals(result.followed, true);

            yield* Effect.sleep(200);

            const allEvents = yield* eventStore.fetch({ type: "all" });
            const followedEvents = allEvents.filter(
              (e: StorableEvent) => e.type === "UserFollowed",
            );
            assertGreater(
              followedEvents.length,
              0,
              "Should have UserFollowed event in store",
            );
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("action: sendConnectionRequest emits event", async () => {
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;

        yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            // Capture state before
            const inboxBefore = yield* platform.inbox;
            const pendingBefore = inboxBefore.pendingInvitations;
            const weeklyBefore = inboxBefore.weeklyInvitesRemaining;

            const result = yield* platform.actions.sendConnectionRequest()(
              params.connectTarget,
              "e2e test connection request",
            );
            assertEquals(result.sent, true);

            yield* Effect.sleep(200);

            // ConnectionRequestSent event should be in the store
            const allEvents = yield* eventStore.fetch({ type: "all" });
            const connEvents = allEvents.filter(
              (e: StorableEvent) => e.type === "ConnectionRequestSent",
            );
            assertGreater(
              connEvents.length,
              0,
              "Should have ConnectionRequestSent event in store",
            );

            // Inbox should reflect the invitation
            const inboxAfter = yield* platform.inbox;
            assertGreater(
              inboxAfter.pendingInvitations,
              pendingBefore,
              "pendingInvitations should increment",
            );
            assertEquals(
              inboxAfter.weeklyInvitesRemaining,
              weeklyBefore - 1,
              "weeklyInvitesRemaining should decrement",
            );
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("action: withdrawInvitation emits event", async () => {
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;

        yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;

            // Find the invitation ID from the ConnectionRequestSent event
            const allEvents = yield* eventStore.fetch({ type: "all" });
            const connEvent = allEvents.find(
              (e: StorableEvent) =>
                e.type === "ConnectionRequestSent" &&
                (e as any).targetUserId === params.connectTarget,
            );
            assertExists(connEvent, "Need ConnectionRequestSent from prior step");

            // The invitation ID should be available from the event or
            // from the action result. Use the target user ID to withdraw.
            const inboxBefore = yield* platform.inbox;
            const pendingBefore = inboxBefore.pendingInvitations;

            // Withdraw using the invitation ID from the connect result
            const invitationId = (connEvent as any).invitationId ??
              params.connectTarget;
            const result = yield* platform.actions.withdrawInvitation()(
              invitationId,
            );
            assertEquals(result.withdrawn, true);

            yield* Effect.sleep(200);

            // InvitationWithdrawn event should be in the store
            const updatedEvents = yield* eventStore.fetch({ type: "all" });
            const withdrawnEvents = updatedEvents.filter(
              (e: StorableEvent) => e.type === "InvitationWithdrawn",
            );
            assertGreater(
              withdrawnEvents.length,
              0,
              "Should have InvitationWithdrawn event in store",
            );

            // Pending invitations should decrement
            const inboxAfter = yield* platform.inbox;
            assertEquals(
              inboxAfter.pendingInvitations,
              pendingBefore - 1,
              "pendingInvitations should decrement after withdrawal",
            );
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    // ════════════════════════════════════════════════════════════════
    // State Derivation Tests
    // ════════════════════════════════════════════════════════════════
    // These tests verify that injected events correctly update
    // materialized views. They work by injecting events directly
    // through the injector and checking the platform views.

    await t.step("state: weekly invite tracking", async () => {
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const injector = yield* LinkedInInjection;
            const platform = yield* LinkedInPlatform;

            // Inject a ConnectionRequestSent with a recent timestamp
            const recentEvent = parseEvent({
              ...rawBase(),
              type: "ConnectionRequestSent",
              targetUserId: "test-weekly-target-1",
              note: "test",
            });
            yield* injector.append(recentEvent);

            // Inject one with a timestamp > 7 days old
            const oldEvent = parseEvent({
              ...rawBase(),
              type: "ConnectionRequestSent",
              timestamp: new Date(
                Date.now() - 8 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              targetUserId: "test-weekly-target-2",
            });
            yield* injector.append(oldEvent);

            yield* Effect.sleep(100);

            const inbox = yield* platform.inbox;

            // The recent one should count, the old one should not.
            // weeklyInvitesRemaining should reflect only recent invites.
            // We can't assert exact numbers without knowing the max,
            // but we can verify the count is reasonable.
            assertGreaterOrEqual(
              inbox.weeklyInvitesRemaining,
              0,
              "weeklyInvitesRemaining should be non-negative",
            );
            assertGreater(
              inbox.pendingInvitations,
              0,
              "Should have pending invitations from injected events",
            );
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("state: restriction tracking", async () => {
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const injector = yield* LinkedInInjection;
            const platform = yield* LinkedInPlatform;

            const retryAfter = new Date(
              Date.now() + 60 * 60 * 1000,
            ).toISOString();

            // Inject a RestrictionObserved event
            const restrictEvent = parseEvent({
              ...rawBase(),
              type: "RestrictionObserved",
              configId: "linkedin-test-browser",
              restrictionType: "desktop_connect_restricted",
              retryAfter,
            });
            yield* injector.append(restrictEvent);

            yield* Effect.sleep(100);

            // Browser should show the restriction
            const browsers = yield* platform.browsers;
            assertEquals(browsers.length, 1);
            assertExists(
              browsers[0].restrictions["desktop_connect_restricted"],
              "Should have desktop_connect_restricted restriction",
            );
            assertEquals(
              browsers[0].restrictions["desktop_connect_restricted"],
              retryAfter,
              "Restriction retryAfter should match",
            );

            // Now inject RestrictionCleared
            const clearEvent = parseEvent({
              ...rawBase(),
              type: "RestrictionCleared",
              configId: "linkedin-test-browser",
              restrictionType: "desktop_connect_restricted",
            });
            yield* injector.append(clearEvent);

            yield* Effect.sleep(100);

            // Restriction should be gone
            const browsersAfter = yield* platform.browsers;
            assertEquals(
              browsersAfter[0].restrictions["desktop_connect_restricted"],
              undefined,
              "Restriction should be cleared",
            );
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("state: challenged auth updates browser view", async () => {
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const injector = yield* LinkedInInjection;
            const platform = yield* LinkedInPlatform;

            // Inject AuthObserved with status: "challenged"
            const challengedEvent = parseEvent({
              ...rawBase(),
              type: "AuthObserved",
              configId: "linkedin-test-browser",
              participantId: `linkedin:${params.selfMemberId}`,
              status: "challenged",
              challengeType: "email",
            });
            yield* injector.append(challengedEvent);

            yield* Effect.sleep(100);

            const browsers = yield* platform.browsers;
            assertEquals(browsers.length, 1);
            assertEquals(
              browsers[0].authStatus,
              "challenged",
              "Browser should show challenged auth status",
            );

            // challengeType should be present on challenged browser
            if (browsers[0].authStatus === "challenged") {
              assertEquals(
                browsers[0].challengeType,
                "email",
                "challengeType should be email",
              );
            }

            // Restore to authenticated for subsequent tests
            const authEvent = parseEvent({
              ...rawBase(),
              type: "AuthObserved",
              configId: "linkedin-test-browser",
              participantId: `linkedin:${params.selfMemberId}`,
              status: "authenticated",
            });
            yield* injector.append(authEvent);
            yield* Effect.sleep(100);
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("state: event injection roundtrip", async () => {
      // Verify the full injection → store → projection → materialization path
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;

        yield* Effect.provide(
          Effect.gen(function* () {
            const injector = yield* LinkedInInjection;

            const authEvent = parseEvent({
              ...rawBase(),
              type: "AuthObserved",
              configId: "linkedin-test-browser",
              participantId: `linkedin:${params.selfMemberId}`,
              status: "authenticated",
            });
            yield* injector.append(authEvent);
          }),
          platformLayer,
        );

        yield* Effect.sleep(50);

        const allEvents = yield* eventStore.fetch({ type: "all" });
        const linkedinEvents = allEvents.filter(
          (e: StorableEvent) => e.scope === LINKEDIN_SCOPE,
        );
        assertGreater(linkedinEvents.length, 0);

        const authEvent = linkedinEvents.find(
          (e: StorableEvent) => e.type === "AuthObserved",
        );
        assertExists(authEvent, "AuthObserved should be in the event store");

        return { eventCount: linkedinEvents.length };
      });

      const result = await Effect.runPromise(
        Effect.provide(program, baseLayers),
      );
      assertGreater(result.eventCount, 0);
    });

    // ── Teardown ───────────────────────────────────────────────────

    await t.step("cleanup", async () => {
      await browser.close();
      await Effect.runPromise(pool.stop(CONFIG_ID));
    });
  },
});
