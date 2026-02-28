// tests/e2e/linkedin_test.ts
// E2E test: LinkedIn plugin against real LinkedIn via local browser pool.
//
// Chain exercised:
//   Local browser pool (CDP) → cookie injection → LinkedIn Voyager API →
//   EventStoreInMemory (PubSub) → Injection → Projection (subscribe) →
//   background fiber fold → Ref<PluginState> → materialize → Sockpuppet
//
// Requires: LinkedIn cookies (env vars or .linkedin-cookies.json)
// Run: nix develop -c deno test --allow-all tests/e2e/linkedin_test.ts

import { assertEquals, assertExists, assertGreater } from "@std/assert";
import { chromium } from "playwright";
import { Effect, Layer } from "effect";
import {
  BrowserConfigId,
  ParticipantId,
} from "@bernays/server/core";
import {
  createInMemoryConfigStore,
  EventStoreInMemory,
  EventStoreTag,
  type StorableEvent,
} from "@bernays/server/store";
import {
  BrowserPool,
  BrowserPoolLive,
  makeLocalBackend,
} from "@bernays/server/browsers";
import { makePlatformLayer } from "@bernays/server/runtime";
import {
  type LinkedInAccount,
  LinkedInInjection,
  linkedInPlatform,
  LinkedInPlatform,
  LinkedInProjection,
  LINKEDIN_SCOPE,
  makeLinkedInActions,
} from "@bernays/plugins/linkedin";
import { loadLinkedInCookies } from "../lib/linkedin-cookies.ts";

// =============================================================================
// Constants
// =============================================================================

const CONFIG_ID = BrowserConfigId("linkedin-test-browser");

// =============================================================================
// Test
// =============================================================================

Deno.test({
  name: "linkedin: e2e plugin tests",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    // ── Setup ──────────────────────────────────────────────────────

    // Load cookies — skip entire suite if unavailable
    let cookies: { li_at: string; JSESSIONID: string };
    try {
      cookies = loadLinkedInCookies();
    } catch (err) {
      console.log(
        `Skipping LinkedIn e2e tests: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }

    // Create the local browser pool with in-memory config store
    const configStore = createInMemoryConfigStore([
      { id: CONFIG_ID, context: "" },
    ]);
    const pool = makeLocalBackend(configStore);

    // Launch the browser
    const session = await Effect.runPromise(pool.launch(CONFIG_ID));

    // Connect via CDP and inject cookies
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

    // Build the LinkedIn account
    const SELF_ID = ParticipantId("linkedin", "test-user");
    const account: LinkedInAccount = {
      id: SELF_ID,
      browserBindings: [{ configId: CONFIG_ID, metadata: { deviceType: "desktop" } }],
    };

    // Create actions backed by the real pool
    const actions = makeLinkedInActions(pool, account);

    // Layer stack: real local pool + in-memory event store
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
          await page.close();
          console.log(
            "LinkedIn cookies expired. Re-run: deno run -A tests/scripts/linkedin-auth.ts",
          );
          return;
        }
        // We're on /feed — cookies are valid
        assertEquals(url.includes("/feed"), true);
      } finally {
        await page.close();
      }
    });

    // ── Platform layer tests ───────────────────────────────────────

    await t.step("platform: layer wires up correctly", async () => {
      const program = Effect.gen(function* () {
        const platform = yield* Effect.provide(
          LinkedInPlatform,
          platformLayer,
        );

        // Inbox should be empty initially (no events yet)
        const inbox = yield* platform.inbox;
        assertExists(inbox);
        assertEquals(Object.keys(inbox.byThreadId).length, 0);

        // Browsers should show the browser as running
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

    // ── Actions: stub verification ─────────────────────────────────
    // Actions are currently TODO stubs that get a CDP session but don't
    // do real automation. These tests verify the wiring works — the
    // action resolves, gets a session, and returns a stub result.

    await t.step("action: sendMessage stub resolves", async () => {
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;
            // Stub returns { success: true } without actually sending
            const result = yield* platform.actions.sendMessage()(
              "thread-1" as any,
              "test message",
            );
            assertEquals(result.success, true);
            return result;
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("action: viewProfile stub resolves", async () => {
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;
            const result = yield* platform.actions.viewProfile()(
              "target-user",
            );
            assertEquals(result.viewed, true);
            return result;
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    await t.step("action: sendConnectionRequest stub resolves", async () => {
      const program = Effect.gen(function* () {
        return yield* Effect.provide(
          Effect.gen(function* () {
            const platform = yield* LinkedInPlatform;
            const result = yield* platform.actions.sendConnectionRequest()(
              "target-user",
              "Let's connect",
            );
            assertEquals(result.sent, true);
            return result;
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    // ── Event store: verify event injection works ───────────────────

    await t.step("injection: events land in store", async () => {
      const program = Effect.gen(function* () {
        const eventStore = yield* EventStoreTag;

        yield* Effect.provide(
          Effect.gen(function* () {
            const injector = yield* LinkedInInjection;
            yield* injector.append({
              scope: LINKEDIN_SCOPE,
              type: "AuthObserved",
              eventId: crypto.randomUUID(),
              correlationId: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              configId: CONFIG_ID,
              participantId: SELF_ID,
              status: "authenticated",
            } as any);
          }),
          platformLayer,
        );

        // Let the PubSub propagate
        yield* Effect.sleep(50);

        const allEvents = yield* eventStore.fetch({ type: "all" });
        const linkedinEvents = allEvents.filter(
          (e: StorableEvent) => e.scope === LINKEDIN_SCOPE,
        );
        assertGreater(linkedinEvents.length, 0);

        const authEvent = linkedinEvents.find(
          (e: StorableEvent) => e.type === "AuthObserved",
        );
        assertExists(authEvent);

        return { eventCount: linkedinEvents.length };
      });

      const result = await Effect.runPromise(
        Effect.provide(program, baseLayers),
      );
      assertGreater(result.eventCount, 0);
    });

    // ── Reactive state: injected events update materialized views ───

    await t.step("reactive: injected auth updates browser view", async () => {
      const program = Effect.gen(function* () {
        yield* Effect.provide(
          Effect.gen(function* () {
            const injector = yield* LinkedInInjection;
            const platform = yield* LinkedInPlatform;

            // Inject AuthObserved
            yield* injector.append({
              scope: LINKEDIN_SCOPE,
              type: "AuthObserved",
              eventId: crypto.randomUUID(),
              correlationId: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              configId: CONFIG_ID,
              participantId: SELF_ID,
              status: "authenticated",
            } as any);

            // Wait for background fiber to process
            yield* Effect.sleep(100);

            // Browser view should now show authenticated
            const browsers = yield* platform.browsers;
            assertEquals(browsers.length, 1);
            assertEquals(browsers[0].authStatus, "authenticated");
          }),
          platformLayer,
        );
      });

      await Effect.runPromise(Effect.provide(program, baseLayers));
    });

    // ── Teardown ───────────────────────────────────────────────────

    await t.step("cleanup", async () => {
      await browser.close();
      await Effect.runPromise(pool.stop(CONFIG_ID));
    });
  },
});
