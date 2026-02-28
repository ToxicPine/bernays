// tests/e2e/messageboard_test.ts
// E2E test: full bernays machinery via an in-process JSON message board.
//
// Chain exercised:
//   EventStoreInMemory (PubSub) → Injection → Projection (subscribe) →
//   background fiber fold → Ref<PluginState> → materialize → Sockpuppet
//   + Journal for decision memory
//   + local Playwright browser (CDP) with page.route interception

import {
  assertEquals,
  assertExists,
  assertGreater,
  assertMatch,
} from "@std/assert";
import { chromium } from "playwright";
import { Effect, Layer, Option } from "effect";
import { BrowserConfigId, ParticipantId, ThreadId } from "@bernays/server/core";
import {
  EventStoreInMemory,
  EventStoreTag,
  type StorableEvent,
} from "@bernays/server/store";
import {
  browserError,
  BrowserPool,
  BrowserPoolLive,
  type BrowserPoolService,
} from "@bernays/server/browsers";
import {
  Journal,
  type JournalEntry,
  makeJournalLayer,
  makeJournalScope,
} from "@bernays/server/runtime";
import { createBoard } from "$/lib/board.ts";
import {
  makeMessageBoardActions,
  makeMessageBoardPlatformLayer,
  MESSAGEBOARD_SCOPE,
  MessageBoardPlatform,
} from "$/plugins/messageboard/mod.ts";
import type { MessageBoardAccount } from "$/plugins/messageboard/mod.ts";

// =============================================================================
// Constants
// =============================================================================

const BOARD_URL = "https://board.test";
const BOARD_API_KEY = "test-key";
const CONFIG_ID = BrowserConfigId("test-browser-1");

const BOT_ACCOUNT: MessageBoardAccount = {
  id: ParticipantId("messageboard", "bot"),
  browserBindings: [{ configId: CONFIG_ID, metadata: {} }],
};

// Stub pool — the test manages the browser directly so the pool is never
// asked to launch anything. Satisfies the BrowserPool dependency in
// makePlatformService (used for materializeBrowsers).
const stubPool: BrowserPoolService = {
  launch: (_id) => Effect.fail(browserError("NotFound", "stub")),
  stop: (_id) => Effect.void,
  isRunning: (_id) => Effect.succeed(false),
  getSession: (_id) => Effect.fail(browserError("NotRunning", "stub")),
};

// Base layer stack shared by both Effect.runPromise calls in this test.
// EventStoreInMemory is provided via Layer.provideMerge (provides AND re-exports EventStoreTag).
// Note: Platform injection/projection and Journal layers are created internally
// by makePlatformLayer and makeJournalLayer respectively.
const baseLayers = BrowserPoolLive(stubPool).pipe(
  Layer.provideMerge(EventStoreInMemory),
);

// =============================================================================
// Test
// =============================================================================

Deno.test({
  name: "messageboard: e2e sockpuppet with reactive state",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const boardHandler = createBoard(BOARD_API_KEY);

    let page: import("playwright").Page | null = null;
    let browserCleanup: (() => Promise<void>) | null = null;

    // ── Step 1: seed messages on the board ────────────────────────────────

    await t.step("seed messages on the board", async () => {
      const seedRes = await boardHandler(
        new Request(`${BOARD_URL}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${BOARD_API_KEY}`,
          },
          body: JSON.stringify({ author: "human-alice", content: "Hello?" }),
        }),
      );
      assertEquals(seedRes.status, 201);
      const msg = await seedRes.json() as { author: string; content: string };
      assertEquals(msg.author, "human-alice");
      assertEquals(msg.content, "Hello?");
    });

    // ── Step 2: launch browser and wire routes ────────────────────────────

    await t.step("launch browser and wire routes", async () => {
      const executablePath = Deno.env.get(
        "PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH",
      );
      const browser = await chromium.launch({
        headless: true,
        ...(executablePath && { executablePath }),
      });
      const context = await browser.newContext();
      page = await context.newPage();

      // Bridge: browser fetch → in-process board handler
      await page.route(`${BOARD_URL}/**`, async (route) => {
        const pw = route.request();
        const req = new Request(pw.url(), {
          method: pw.method(),
          headers: pw.headers() as Record<string, string>,
          body: pw.postData() ?? undefined,
        });
        const res = await boardHandler(req);
        await route.fulfill({
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body: await res.text(),
        });
      });

      browserCleanup = async () => {
        await page?.close().catch(() => {});
        await browser.close().catch(() => {});
      };
    });

    // ── Step 3: run sockpuppet ─────────────────────────────────────────────

    let sockpuppetResult: {
      initialThreadCount: number;
      updatedThreadCount: number;
      journalEntries: readonly JournalEntry[];
      messageboardEvents: StorableEvent[];
      journalEvents: StorableEvent[];
    } | null = null;

    await t.step("run sockpuppet", async () => {
      if (!page) throw new Error("page not initialised");

      // Create actions (injector is obtained from Effect context when actions execute)
      // and platform layer (which creates injection/projection internally).
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;
        const actions = makeMessageBoardActions({
          page: page!,
          account: BOT_ACCOUNT,
        });

        const platformLayer = makeMessageBoardPlatformLayer(
          BOT_ACCOUNT,
          actions,
        );
        const journalLayer = makeJournalLayer(BOT_ACCOUNT.id);

        const innerResult = yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* MessageBoardPlatform;
            const journal = yield* Journal;

            // Initial inbox — empty, no events in the store yet
            const initialInbox = yield* platform.inbox;
            const initialThreadCount =
              Object.keys(initialInbox.byThreadId).length;

            // Read from board via CDP + route interception →
            // injects AnchorMessageObserved events into the store
            yield* platform.actions.readMessages()();

            // Yield to let the background fiber process the PubSub message
            yield* Effect.sleep(50);

            // Inbox should now reflect the injected events
            const updatedInbox = yield* platform.inbox;
            const updatedThreadCount =
              Object.keys(updatedInbox.byThreadId).length;

            // Reply to each thread the bot hasn't sent to
            for (
              const [threadId, _meta] of Object.entries(updatedInbox.byThreadId)
            ) {
              const thread = yield* platform.thread(ThreadId(threadId));
              if (Option.isNone(thread)) continue;

              const lastMsg = thread.value.messages.at(-1);
              if (!lastMsg || lastMsg.senderId === BOT_ACCOUNT.id) continue;

              yield* platform.actions.postMessage()(
                `Reply from bot at ${new Date().toISOString()}`,
              );

              yield* journal.record({ kind: "replied", threadId });
            }

            const entries = yield* journal.entries();

            return {
              initialThreadCount,
              updatedThreadCount,
              journalEntries: entries,
            };
          }),
          Layer.merge(platformLayer, journalLayer),
        );

        // Query the event store directly to verify events
        const allEvents = yield* eventStore.fetch({ type: "all" });
        const messageboardEvents = allEvents.filter(
          (e) => e.scope === MESSAGEBOARD_SCOPE,
        );
        const journalScope = makeJournalScope(BOT_ACCOUNT.id);
        const journalEvents = allEvents.filter(
          (e) => e.scope === journalScope,
        );

        return {
          ...innerResult,
          messageboardEvents: [...messageboardEvents],
          journalEvents: [...journalEvents],
        };
      });

      sockpuppetResult = await Effect.runPromise(
        Effect.provide(program, baseLayers),
      );
    });

    // ── Step 4: assertions ────────────────────────────────────────────────

    await t.step("verify reactive pipeline: inbox updated after inject", () => {
      if (!sockpuppetResult) throw new Error("sockpuppet did not run");
      assertEquals(sockpuppetResult.initialThreadCount, 0);
      assertGreater(sockpuppetResult.updatedThreadCount, 0);
    });

    await t.step("verify messageboard events in store", () => {
      if (!sockpuppetResult) throw new Error("sockpuppet did not run");
      const events = sockpuppetResult.messageboardEvents;

      // Should have AnchorMessageObserved (from readMessages) and MessageSent (from postMessage)
      assertGreater(events.length, 0, "Should have messageboard events");

      const anchorEvents = events.filter((e) =>
        e.type === "AnchorMessageObserved"
      );
      const sentEvents = events.filter((e) => e.type === "MessageSent");

      assertGreater(
        anchorEvents.length,
        0,
        "Should have AnchorMessageObserved events",
      );
      assertGreater(sentEvents.length, 0, "Should have MessageSent events");

      // Verify event structure
      for (const event of events) {
        assertEquals(
          event.scope,
          MESSAGEBOARD_SCOPE,
          "Event scope should be messageboard",
        );
        assertExists(event.eventId, "Event should have eventId");
        assertMatch(
          event.eventId,
          /^[0-9a-f-]{36}$/,
          "eventId should be UUID format",
        );
        assertExists(event.timestamp, "Event should have timestamp");
        // Timestamp should be ISO 8601 format
        assertEquals(
          isNaN(Date.parse(event.timestamp)),
          false,
          "timestamp should be valid ISO date",
        );
      }
    });

    await t.step("verify journal events in store", () => {
      if (!sockpuppetResult) throw new Error("sockpuppet did not run");
      const events = sockpuppetResult.journalEvents;

      assertGreater(events.length, 0, "Should have journal events");

      // Verify journal event structure - scope is per-participant
      const expectedScope = makeJournalScope(BOT_ACCOUNT.id);
      for (const event of events) {
        assertEquals(
          event.scope,
          expectedScope,
          `Journal event scope should be '${expectedScope}'`,
        );
        assertExists(event.eventId, "Journal event should have eventId");
        assertMatch(
          event.eventId,
          /^[0-9a-f-]{36}$/,
          "eventId should be UUID format",
        );
        assertExists(event.timestamp, "Journal event should have timestamp");
      }
    });

    await t.step("verify journal entries have correct structure", () => {
      if (!sockpuppetResult) throw new Error("sockpuppet did not run");
      const entries = sockpuppetResult.journalEntries;

      assertGreater(entries.length, 0, "Should have journal entries");

      // Verify journal entry structure (the typed entries returned by journal.entries())
      for (const entry of entries) {
        assertExists(entry.kind, "Journal entry should have kind");
        assertEquals(
          entry.kind,
          "replied",
          "Journal entry kind should be 'replied'",
        );
        assertExists(entry.threadId, "Journal entry should have threadId");
        // Verify participantId is set (journals are filtered by this)
        assertEquals(
          entry.participantId,
          BOT_ACCOUNT.id,
          "Journal entry should belong to the bot's participantId",
        );
      }
    });

    await t.step("verify bot reply visible on board", async () => {
      const res = await boardHandler(
        new Request(`${BOARD_URL}/messages`, {
          headers: { "Authorization": `Bearer ${BOARD_API_KEY}` },
        }),
      );
      assertEquals(res.status, 200);
      const messages = await res.json() as Array<{ author: string }>;
      assertGreater(messages.filter((m) => m.author === "bot").length, 0);
    });

    // ── Step 5: external inject, verify reactive state update ─────────────

    await t.step("inject event externally, verify state updates", async () => {
      if (!page) throw new Error("page not initialised");

      // Seed another message directly on the board
      await boardHandler(
        new Request(`${BOARD_URL}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${BOARD_API_KEY}`,
          },
          body: JSON.stringify({
            author: "human-bob",
            content: "Anyone else here?",
          }),
        }),
      );

      // Fresh layer stack — new in-memory store, reads all messages from board
      const readProgram = Effect.gen(function* () {
        const actions = makeMessageBoardActions({
          page: page!,
          account: BOT_ACCOUNT,
        });
        const platformLayer = makeMessageBoardPlatformLayer(
          BOT_ACCOUNT,
          actions,
        );

        return yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* MessageBoardPlatform;
            yield* platform.actions.readMessages()();
            yield* Effect.sleep(50);
            const inbox = yield* platform.inbox;
            return Object.keys(inbox.byThreadId).length;
          }),
          platformLayer,
        );
      });

      const threadCount = await Effect.runPromise(
        Effect.provide(readProgram, baseLayers),
      );

      // Board has: "Hello?", bot reply, "Anyone else here?" → ≥ 1 thread
      assertGreater(threadCount, 0);
    });

    // ── Teardown ──────────────────────────────────────────────────────────

    await t.step("stop browser", async () => {
      await browserCleanup?.();
      browserCleanup = null;
      page = null;
    });
  },
});
