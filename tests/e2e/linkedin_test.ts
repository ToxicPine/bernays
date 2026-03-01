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
import { BrowserPoolLive, makeLocalBackend } from "@bernays/server/browsers";
import { makePlatformLayer } from "@bernays/server/runtime";
import {
  LINKEDIN_SCOPE,
  type LinkedInAccount,
  LinkedInEventSchema,
  LinkedInInjection,
  LinkedInPlatform,
  linkedInPlatform,
  LinkedInProjection,
  makeLinkedInActions,
  makeLinkedInSync,
} from "@bernays/plugins/linkedin";
import { loadLinkedInTestConfig } from "$/lib/linkedin-params.ts";

// =============================================================================
// Setup
// =============================================================================

const CONFIG_ID = BrowserConfigId("linkedin-test-browser");
const { cookies, params } = loadLinkedInTestConfig();

const SELF_ID = ParticipantId("linkedin", params.selfMemberId);

const linkedInAccount: LinkedInAccount = {
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

    // ── Layers ─────────────────────────────────────────────────────

    const linkedInActions = makeLinkedInActions(pool, linkedInAccount);

    const baseLayers = BrowserPoolLive(pool).pipe(
      Layer.provideMerge(EventStoreInMemory),
    );

    // Layer without sync — for verifying wiring before any observation
    const bareLayer = makePlatformLayer(
      LinkedInPlatform,
      LinkedInInjection,
      LinkedInProjection,
      { platform: linkedInPlatform, account: linkedInAccount, actions: linkedInActions },
    );

    // Layer with sync — the sync fiber is forked internally by makePlatformLayer
    const syncLayer = makePlatformLayer(
      LinkedInPlatform,
      LinkedInInjection,
      LinkedInProjection,
      { platform: linkedInPlatform, account: linkedInAccount, actions: linkedInActions, sync: makeLinkedInSync },
    );

    // Fully composed layer: platform (with sync) + event store + browser pool
    const fullLayer = syncLayer.pipe(Layer.provide(baseLayers));

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

    // ── Platform layer wiring (no sync) ────────────────────────────

    await t.step("platform: layer wires up correctly", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* Effect.provide(
          LinkedInPlatform,
          bareLayer,
        );

        const inbox = yield* platform.inbox;
        assertExists(inbox);
        assertEquals(Object.keys(inbox.byThreadId).length, 0);

        const browsers = yield* platform.browsers;
        assertEquals(browsers.length, 1);
        assertEquals(browsers[0].configId, CONFIG_ID);
        assertEquals(browsers[0].isRunning, true);
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    // ════════════════════════════════════════════════════════════════
    // Sync + Action + State Tests
    // ════════════════════════════════════════════════════════════════
    // All subsequent tests share one platform layer with the sync
    // fiber running. The sync fiber is forked by makePlatformLayer
    // and populates state in the background.
    //
    // We wait once for the sync fiber to complete its first cycle,
    // then all tests read from the populated state.

    await t.step("sync: populates state after first cycle", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;

        // Wait for the sync fiber to complete its first cycle
        yield* Effect.sleep(20000);

        // Auth status should be authenticated
        const browsers = yield* platform.browsers;
        assertEquals(browsers.length, 1);
        assertEquals(browsers[0].authStatus, "authenticated");

        // Profile viewing mode should be populated on first cycle
        if (browsers[0].authStatus === "authenticated") {
          assertExists(
            browsers[0].profileViewingMode,
            "profileViewingMode should be populated after first sync cycle",
          );
        }

        // Inbox should have threads from inbox sync
        const inbox = yield* platform.inbox;
        assertGreater(
          Object.keys(inbox.byThreadId).length,
          0,
          "Inbox should have at least one thread after sync",
        );
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("sync: thread views have messages", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;

        const inbox = yield* platform.inbox;
        const threadIds = Object.keys(inbox.byThreadId);
        assertGreater(threadIds.length, 0, "Need at least one thread");

        const threadId = threadIds[0] as ThreadId;
        const threadOpt = yield* platform.thread(threadId);
        assertEquals(Option.isSome(threadOpt), true, "Thread should exist");

        if (Option.isSome(threadOpt)) {
          const thread = threadOpt.value;
          assertGreater(thread.messages.length, 0, "Thread should have messages");

          const msg = thread.messages[0];
          assertExists(msg.senderId, "Message should have senderId");
          assertExists(msg.content, "Message should have content");
          assertExists(msg.timestamp, "Message should have timestamp");
        }
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("sync: contact directory populated", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;

        const inbox = yield* platform.inbox;
        const threadIds = Object.keys(inbox.byThreadId);
        assertGreater(threadIds.length, 0, "Need at least one thread");

        const threadOpt = yield* platform.thread(threadIds[0] as ThreadId);
        if (!Option.isSome(threadOpt)) {
          throw new Error("Thread should exist");
        }

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
          assertExists(contactOpt.value.memberId, "Contact should have memberId");
          assertEquals(
            contactOpt.value.connectionDegree,
            "1st",
            "DM participants should be 1st-degree connections",
          );
        }
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("sync: reply directionality tracked", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;

        const inbox = yield* platform.inbox;
        const threadIds = Object.keys(inbox.byThreadId);

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
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("sync: ConversationsSynced event emitted", async () => {
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;

        const allEvents = yield* eventStore.fetch({ type: "all" });
        const syncedEvents = allEvents.filter(
          (e: StorableEvent) => e.type === "ConversationsSynced",
        );
        assertGreater(
          syncedEvents.length,
          0,
          "Should have at least one ConversationsSynced event",
        );
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    // ════════════════════════════════════════════════════════════════
    // Action Tests
    // ════════════════════════════════════════════════════════════════

    await t.step("action: sendMessage emits MessageSent", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;
        const eventStore = yield* EventStoreTag;

        const result = yield* platform.actions.sendMessage()(
          params.threadId as ThreadId,
          `e2e test ${new Date().toISOString()}`,
        );
        assertEquals(result.success, true);

        yield* Effect.sleep(200);

        const allEvents = yield* eventStore.fetch({ type: "all" });
        const sentEvents = allEvents.filter(
          (e: StorableEvent) => e.type === "MessageSent",
        );
        assertGreater(sentEvents.length, 0, "Should have MessageSent event");

        const threadOpt = yield* platform.thread(params.threadId as ThreadId);
        assertEquals(Option.isSome(threadOpt), true, "Thread should exist after send");
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("action: viewProfile emits ProfileViewed", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;
        const eventStore = yield* EventStoreTag;

        const result = yield* platform.actions.viewProfile()(
          params.profileTarget,
        );
        assertEquals(result.viewed, true);
        assertExists(result.viewerPrivacySetting, "Should return viewerPrivacySetting");

        yield* Effect.sleep(200);

        const allEvents = yield* eventStore.fetch({ type: "all" });
        const viewedEvents = allEvents.filter(
          (e: StorableEvent) => e.type === "ProfileViewed",
        );
        assertGreater(viewedEvents.length, 0, "Should have ProfileViewed event");
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("action: followUser emits UserFollowed", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;
        const eventStore = yield* EventStoreTag;

        const result = yield* platform.actions.followUser()(
          params.profileTarget,
        );
        assertEquals(result.followed, true);

        yield* Effect.sleep(200);

        const allEvents = yield* eventStore.fetch({ type: "all" });
        const followedEvents = allEvents.filter(
          (e: StorableEvent) => e.type === "UserFollowed",
        );
        assertGreater(followedEvents.length, 0, "Should have UserFollowed event");
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("action: sendConnectionRequest emits event", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;
        const eventStore = yield* EventStoreTag;

        const inboxBefore = yield* platform.inbox;
        const pendingBefore = inboxBefore.pendingInvitations;
        const weeklyBefore = inboxBefore.weeklyInvitesRemaining;

        const result = yield* platform.actions.sendConnectionRequest()(
          params.connectTarget,
          "e2e test connection request",
        );
        assertEquals(result.sent, true);

        yield* Effect.sleep(200);

        const allEvents = yield* eventStore.fetch({ type: "all" });
        const connEvents = allEvents.filter(
          (e: StorableEvent) => e.type === "ConnectionRequestSent",
        );
        assertGreater(connEvents.length, 0, "Should have ConnectionRequestSent event");

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
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("action: withdrawInvitation emits event", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;
        const eventStore = yield* EventStoreTag;

        const allEvents = yield* eventStore.fetch({ type: "all" });
        const rawConnEvent = allEvents.find(
          (e: StorableEvent) => e.type === "ConnectionRequestSent",
        );
        assertExists(rawConnEvent, "Need ConnectionRequestSent from prior step");

        const connEvent = LinkedInEventSchema.parse(rawConnEvent);
        if (connEvent.type !== "ConnectionRequestSent") {
          throw new Error("Unexpected event type after parse");
        }
        assertEquals(connEvent.targetUserId, params.connectTarget);

        const inboxBefore = yield* platform.inbox;
        const pendingBefore = inboxBefore.pendingInvitations;

        const invitationId = connEvent.invitationId ?? params.connectTarget;
        const result = yield* platform.actions.withdrawInvitation()(
          invitationId,
        );
        assertEquals(result.withdrawn, true);

        yield* Effect.sleep(200);

        const updatedEvents = yield* eventStore.fetch({ type: "all" });
        const withdrawnEvents = updatedEvents.filter(
          (e: StorableEvent) => e.type === "InvitationWithdrawn",
        );
        assertGreater(withdrawnEvents.length, 0, "Should have InvitationWithdrawn event");

        const inboxAfter = yield* platform.inbox;
        assertEquals(
          inboxAfter.pendingInvitations,
          pendingBefore - 1,
          "pendingInvitations should decrement after withdrawal",
        );
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    // ════════════════════════════════════════════════════════════════
    // State Derivation Tests
    // ════════════════════════════════════════════════════════════════
    // These verify that injected events correctly update materialized
    // views via the injection → store → projection → Ref path.

    await t.step("state: weekly invite tracking", async () => {
      const program = Effect.gen(function* () {
        const injector = yield* LinkedInInjection;
        const platform = yield* LinkedInPlatform;

        yield* injector.append(parseEvent({
          scope: "linkedin",
          type: "ConnectionRequestSent",
          targetUserId: "test-weekly-target-1",
          note: "test",
        }));

        yield* injector.append(parseEvent({
          scope: "linkedin",
          type: "ConnectionRequestSent",
          timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
          targetUserId: "test-weekly-target-2",
        }));

        yield* Effect.sleep(100);

        const inbox = yield* platform.inbox;
        assertGreaterOrEqual(inbox.weeklyInvitesRemaining, 0);
        assertGreater(inbox.pendingInvitations, 0);
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("state: restriction tracking", async () => {
      const program = Effect.gen(function* () {
        const injector = yield* LinkedInInjection;
        const platform = yield* LinkedInPlatform;

        const retryAfter = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        yield* injector.append(parseEvent({
          scope: "linkedin",
          type: "RestrictionObserved",
          configId: "linkedin-test-browser",
          restrictionType: "desktop_connect_restricted",
          retryAfter,
        }));

        yield* Effect.sleep(100);

        const browsers = yield* platform.browsers;
        assertEquals(browsers.length, 1);
        assertExists(browsers[0].restrictions["desktop_connect_restricted"]);
        assertEquals(browsers[0].restrictions["desktop_connect_restricted"], retryAfter);

        yield* injector.append(parseEvent({
          scope: "linkedin",
          type: "RestrictionCleared",
          configId: "linkedin-test-browser",
          restrictionType: "desktop_connect_restricted",
        }));

        yield* Effect.sleep(100);

        const browsersAfter = yield* platform.browsers;
        assertEquals(
          browsersAfter[0].restrictions["desktop_connect_restricted"],
          undefined,
          "Restriction should be cleared",
        );
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("state: challenged auth updates browser view", async () => {
      const program = Effect.gen(function* () {
        const injector = yield* LinkedInInjection;
        const platform = yield* LinkedInPlatform;

        yield* injector.append(parseEvent({
          scope: "linkedin",
          type: "AuthObserved",
          configId: "linkedin-test-browser",
          participantId: `linkedin:${params.selfMemberId}`,
          status: "challenged",
          challengeType: "email",
        }));

        yield* Effect.sleep(100);

        const browsers = yield* platform.browsers;
        assertEquals(browsers.length, 1);
        assertEquals(browsers[0].authStatus, "challenged");

        if (browsers[0].authStatus === "challenged") {
          assertEquals(browsers[0].challengeType, "email");
        }

        // Restore to authenticated for subsequent tests
        yield* injector.append(parseEvent({
          scope: "linkedin",
          type: "AuthObserved",
          configId: "linkedin-test-browser",
          participantId: `linkedin:${params.selfMemberId}`,
          status: "authenticated",
        }));
        yield* Effect.sleep(100);
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    await t.step("state: event injection roundtrip", async () => {
      const program = Effect.gen(function* () {
        const injector = yield* LinkedInInjection;
        const eventStore = yield* EventStoreTag;

        yield* injector.append(parseEvent({
          scope: "linkedin",
          type: "AuthObserved",
          configId: "linkedin-test-browser",
          participantId: `linkedin:${params.selfMemberId}`,
          status: "authenticated",
        }));

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
      });

      await Effect.runPromise(Effect.provide(program, fullLayer));
    });

    // ── Teardown ───────────────────────────────────────────────────

    await t.step("cleanup", async () => {
      await browser.close();
      await Effect.runPromise(pool.stop(CONFIG_ID));
    });
  },
});
