// tests/e2e/local_pool_test.ts
// Smoke test: local browser pool launches chromium and returns a working CDP session.
//
// Proves that server/browsers/local/ works end-to-end:
//   createInMemoryConfigStore → createLocalPool → launch → getSession →
//   chromium.connectOverCDP(cdpUrl) → page.evaluate
//
// Requires: nix develop (provides PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH)

import { assertEquals, assertExists } from "@std/assert";
import { Effect } from "effect";
import { chromium } from "playwright";
import { BrowserConfigId } from "@bernays/server/core";
import { createInMemoryConfigStore } from "@bernays/server/store";
import { makeLocalBackend } from "@bernays/server/browsers";

const CONFIG_ID = BrowserConfigId("test-local-1");

Deno.test({
  name: "local pool: launch, getSession, connect, evaluate",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // 1. In-memory config store with a single browser config (no persistent profile)
    const configStore = createInMemoryConfigStore([
      { id: CONFIG_ID, context: "" },
    ]);

    // 2. Create the local pool via the public factory
    const pool = makeLocalBackend(configStore, { pool: { headless: true } });

    // 3. Launch — starts a Chromium process, returns CDP WebSocket URL
    const session = await Effect.runPromise(pool.launch(CONFIG_ID));
    assertExists(session.cdpUrl);
    assertEquals(session.configId, CONFIG_ID);

    // 4. getSession — should return the same session
    const session2 = await Effect.runPromise(pool.getSession(CONFIG_ID));
    assertEquals(session2.cdpUrl, session.cdpUrl);

    // 5. isRunning — should be true
    const running = await Effect.runPromise(pool.isRunning(CONFIG_ID));
    assertEquals(running, true);

    // 6. Connect via CDP and evaluate JS
    const browser = await chromium.connectOverCDP(session.cdpUrl);
    try {
      const context = browser.contexts()[0] ?? await browser.newContext();
      const page = await context.newPage();

      const result = await page.evaluate(() => 2 + 2);
      assertEquals(result, 4);

      // Verify we can navigate
      await page.goto("data:text/html,<h1>hello</h1>");
      const text = await page.textContent("h1");
      assertEquals(text, "hello");

      await page.close();
    } finally {
      await browser.close();
    }

    // 7. Stop — tears down the Chromium process
    await Effect.runPromise(pool.stop(CONFIG_ID));
    const stoppedRunning = await Effect.runPromise(pool.isRunning(CONFIG_ID));
    assertEquals(stoppedRunning, false);
  },
});
