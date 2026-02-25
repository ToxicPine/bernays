// tests/e2e/messageboard_test.ts
// E2E test: full bernays machinery via an in-process JSON message board.
//
// Chain exercised:
//   EventStoreInMemory (PubSub) → Injection → Projection (subscribe) →
//   background fiber fold → Ref<PluginState> → materialize → Sockpuppet
//   + Journal for decision memory
//   + local Playwright browser (CDP) with page.route interception

import { assertEquals, assertGreater } from "@std/assert";
import { chromium } from "playwright";
import { Effect, Layer, Option } from "effect";
import {
  BrowserConfigId,
  ParticipantId,
  ThreadId,
} from "@bernays/server/core";
import { EventStoreInMemory } from "@bernays/server/store";
import {
  BrowserPool,
  BrowserPoolLive,
  type BrowserPoolService,
  browserError,
} from "@bernays/server/browsers";
import {
  Journal,
  JournalInjectionLive,
  JournalProjectionLive,
  makeJournalLayer,
} from "@bernays/server/runtime";
import { createBoard } from "../lib/board.ts";
import {
  makeMessageBoardActions,
  makeMessageBoardPlatformLayer,
  MessageBoardInjection,
  MessageBoardInjectionLive,
  MessageBoardPlatform,
  MessageBoardProjectionLive,
} from "../plugins/messageboard/mod.ts";
import type { MessageBoardAccount } from "../plugins/messageboard/mod.ts";

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
// The injection/projection layers need EventStoreTag, so we wire EventStoreInMemory
// in via Layer.provide rather than Layer.mergeAll (which doesn't auto-satisfy deps).
const baseLayers = Layer.mergeAll(
  MessageBoardInjectionLive,
  MessageBoardProjectionLive,
  JournalInjectionLive,
  JournalProjectionLive,
  BrowserPoolLive(stubPool),
).pipe(Layer.provide(EventStoreInMemory));

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
      const server = await chromium.launchServer({ headless: true });
      const browser = await chromium.connectOverCDP(server.wsEndpoint());
      const context = browser.contexts()[0] ?? await browser.newContext();
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
        await server.close().catch(() => {});
      };
    });

    // ── Step 3: run sockpuppet ─────────────────────────────────────────────

    let sockpuppetResult: {
      initialThreadCount: number;
      updatedThreadCount: number;
      journalEntries: number;
    } | null = null;

    await t.step("run sockpuppet", async () => {
      if (!page) throw new Error("page not initialised");

      // We resolve the injector from the layer context so we can wire it into
      // the actions factory before constructing the platform layer.
      const program = Effect.gen(function* () {
        const injector = yield* MessageBoardInjection;
        const actions = makeMessageBoardActions({
          page: page!,
          injector,
          account: BOT_ACCOUNT,
        });

        const platformLayer = makeMessageBoardPlatformLayer(BOT_ACCOUNT, actions);
        const journalLayer = makeJournalLayer(BOT_ACCOUNT.id);

        return yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* MessageBoardPlatform;
            const journal = yield* Journal;

            // Initial inbox — empty, no events in the store yet
            const initialInbox = yield* platform.inbox;
            const initialThreadCount = Object.keys(initialInbox.byThreadId).length;

            // Read from board via CDP + route interception →
            // injects AnchorMessageObserved events into the store
            yield* platform.actions.readMessages()();

            // Yield to let the background fiber process the PubSub message
            yield* Effect.sleep(50);

            // Inbox should now reflect the injected events
            const updatedInbox = yield* platform.inbox;
            const updatedThreadCount = Object.keys(updatedInbox.byThreadId).length;

            // Reply to each thread the bot hasn't sent to
            for (const [threadId, _meta] of Object.entries(updatedInbox.byThreadId)) {
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

            return { initialThreadCount, updatedThreadCount, journalEntries: entries.length };
          }),
          Layer.merge(platformLayer, journalLayer),
        );
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

    await t.step("verify journal recorded decisions", () => {
      if (!sockpuppetResult) throw new Error("sockpuppet did not run");
      assertGreater(sockpuppetResult.journalEntries, 0);
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
        const injector = yield* MessageBoardInjection;
        const actions = makeMessageBoardActions({
          page: page!,
          injector,
          account: BOT_ACCOUNT,
        });
        const platformLayer = makeMessageBoardPlatformLayer(BOT_ACCOUNT, actions);

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
