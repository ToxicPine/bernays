// packages/commandline/src/main.ts
// Entry point

import { Effect } from "effect";
import { config } from "./config.ts";
import { tty } from "./logger.ts";
import { initializeStores } from "./stores.ts";
import { createBrowserLayer, runWithSockpuppet } from "./runtime.ts";
import { Journal, Platform } from "@bernays/server/runtime";

export const sockpuppet = Effect.gen(function* () {
  const platform = yield* Platform;
  const journal = yield* Journal;

  const inbox = yield* platform.inbox;
  const threads = Object.keys(inbox.byThreadId);

  yield* Effect.log(`Found ${threads.length} threads`);

  yield* journal.record({
    kind: "checked_inbox",
    threadCount: threads.length,
  });

  yield* Effect.log("Done!");
});

async function main() {
  tty.info("SOCIAL AUTOMATION FRAMEWORK\n");

  if (!config.browserbaseApiKey) {
    tty.warn("BROWSERBASE_API_KEY not set");
  }
  if (!config.databaseUrl) {
    tty.error("DATABASE_URL is required");
    Deno.exit(1);
  }

  const { configStore, eventStore, account } = await initializeStores();
  const browserLayer = createBrowserLayer(configStore);

  if (config.runSockpuppet) {
    const program = runWithSockpuppet(sockpuppet, account, eventStore);
    await Effect.runPromise(Effect.provide(program, browserLayer));
  }

  tty.info("Done!");
}

if (import.meta.main) {
  main().catch((err) => {
    if (err instanceof Error && err.name === "Interrupted") {
      tty.info("Interrupted.");
      Deno.exit(0);
    }
    tty.error("Fatal:", err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  });
}
