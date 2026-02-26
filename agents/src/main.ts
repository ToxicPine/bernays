// packages/commandline/src/main.ts
// Entry point

import { Effect } from "effect";
import { config } from "./config.ts";
import { tty } from "./logger.ts";
import { initializeStores } from "./stores.ts";
import { createBrowserLayer, runWithSockpuppet } from "./runtime.ts";
import { Journal } from "@bernays/server/runtime";
import { LinkedInPlatform } from "@bernays/plugins/linkedin";
import { sleep } from "effect/Clock";
import { seconds } from "effect/Duration";

export const sockpuppet = Effect.gen(function* () {
  const platform = yield* LinkedInPlatform;
  const journal = yield* Journal;

  const inbox = yield* platform.inbox;
  const threads = Object.keys(inbox.byThreadId);

  yield* Effect.log(`Found ${threads.length} Threads`);

  yield* sleep(seconds(1));

  yield* journal.record({
    kind: "checked_inbox",
    threadCount: threads.length,
  });

  yield* Effect.log("Done!");
});

async function main() {
  tty.info("BERNAYS\n");

  const { configStore, eventStoreLayer, account } = await initializeStores();
  const browserLayer = createBrowserLayer(configStore);

  if (config.runSockpuppet) {
    const program = runWithSockpuppet(sockpuppet, account, eventStoreLayer);
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
