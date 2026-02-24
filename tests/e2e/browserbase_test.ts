// tests/e2e/browserbase_test.ts
// Full E2E test: PostgreSQL + Browserbase + Extension

import { assertGreaterOrEqual } from "@std/assert";
import { Effect, Layer } from "effect";
import {
  type BridgeMessage,
  cleanupTestData,
  createSession,
  type E2EConfig,
  loadConfig,
  setupBridge,
  type TestSession,
  validateBrowserbase,
  validateDatabase,
  waitForExtension,
} from "../lib/mod.ts";
import {
  type ConfigStoreService,
  configurePostgresEventStore,
  createPostgresConfigStore,
  type EventStore,
  type StorableEvent,
} from "@bernays/server/store";
import {
  type BrowserPoolService,
  makeBrowserbaseBackend,
} from "@bernays/server/browsers";
import {
  Journal,
  makeJournalLayer,
  makePlatformLayer,
} from "@bernays/server/runtime";
import {
  createPostgresLinkedInAccountStore,
  type LinkedInAccount,
  type LinkedInAccountStoreService,
  LinkedInPlatform,
  linkedInPlatform,
  makeLinkedInActions,
} from "@bernays/plugins/linkedin";
import {
  BrowserConfigId,
  ExtensionId,
  ParticipantId,
} from "@bernays/server/core";

const TEST_ACCOUNT_ID = "e2e-browserbase-account";
const TEST_BROWSER_ID = "e2e-browserbase-browser";
const TEST_URL = "https://www.linkedin.com/feed/";

interface Context {
  config: E2EConfig;
  eventStore: EventStore<StorableEvent>;
  configStore: ConfigStoreService;
  accountStore: LinkedInAccountStoreService;
  browserPool: BrowserPoolService;
  account: LinkedInAccount;
  session?: TestSession;
  events: BridgeMessage[];
}

let ctx: Context | undefined;

Deno.test.beforeAll(async () => {
  const config = await loadConfig();
  await validateDatabase(config.databaseUrl);
  await validateBrowserbase(
    config.browserbaseApiKey,
    config.browserbaseProjectId,
  );

  const eventStore = await Effect.runPromise(
    configurePostgresEventStore({ databaseUrl: config.databaseUrl }),
  );
  const configStore = await createPostgresConfigStore({
    connectionString: config.databaseUrl,
  });
  const accountStore = await createPostgresLinkedInAccountStore({
    connectionString: config.databaseUrl,
  });

  await Effect.runPromise(
    configStore.upsert({
      id: BrowserConfigId(TEST_BROWSER_ID),
      context: config.browserbaseContextId,
      extensionIds: config.browserbaseExtensionId
        ? [ExtensionId(config.browserbaseExtensionId)]
        : [],
    }),
  );

  const account: LinkedInAccount = {
    id: ParticipantId("linkedin", TEST_ACCOUNT_ID),
    browserBindings: [
      {
        configId: BrowserConfigId(TEST_BROWSER_ID),
        metadata: { deviceType: "desktop" },
      },
    ],
  };
  await Effect.runPromise(accountStore.upsert(account));

  const backend = makeBrowserbaseBackend(config.browserbaseApiKey, configStore);

  ctx = {
    config,
    eventStore,
    configStore,
    accountStore,
    browserPool: backend.pool,
    account,
    events: [],
  };
});

Deno.test.afterAll(async () => {
  if (ctx?.session) {
    await ctx.session.close();
  }
  if (Deno.args.includes("--cleanup") && ctx?.config) {
    await cleanupTestData(ctx.config.databaseUrl);
  }
  ctx = undefined;
});

Deno.test({
  name: "browserbase: full e2e flow",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    if (!ctx) {
      throw new Error("Context not initialized - check beforeAll errors");
    }

    await t.step("create session", async () => {
      ctx!.session = await createSession(ctx!.config);
    });

    await t.step("navigate and wait for extension", async () => {
      await waitForExtension(ctx!.session!.page, TEST_URL, 60000);
    });

    await t.step("verify bidirectional communication", async () => {
      const { send, events, cleanup } = await setupBridge(ctx!.session!.page);

      // Set context so events are tagged with our config ID
      await send("observe:setContext", {
        configId: TEST_BROWSER_ID,
        tabId: "e2e-test",
      });

      // Send test:echo command with a unique ID
      const echoId = crypto.randomUUID();
      await send("test:echo", { echoId });

      // Wait for event to arrive
      await new Promise((r) => setTimeout(r, 1000));

      // Find our echo event
      const echoEvent = events.find((e) => {
        const payload = e.payload as Record<string, unknown> | undefined;
        return payload?.type === "TestEcho" && payload?.echoId === echoId;
      });

      ctx!.events = [...events];
      cleanup();

      // Verify we got the exact event we sent
      if (!echoEvent) {
        console.log("Events received:", JSON.stringify(events, null, 2));
        throw new Error(
          `Expected TestEcho event with echoId=${echoId}, got ${events.length} events`,
        );
      }
    });

    await t.step("verify postgres connectivity", async () => {
      // Note: Events from this test session don't flow to postgres because we're
      // using a direct Browserbase session, not the BrowserPool+EventIngestion pipeline.
      // This step just verifies we can query the event store.
      const result = await ctx!.eventStore.fetch({ type: "all" });
      if (!result.ok) throw new Error(result.error.message);
      console.log(`Events in DB: ${result.value.length}`);
    });

    await t.step("run sockpuppet", async () => {
      const actions = makeLinkedInActions(ctx!.browserPool, ctx!.account);
      const platformLayer = makePlatformLayer(LinkedInPlatform, {
        platform: linkedInPlatform,
        account: ctx!.account,
        eventStore: ctx!.eventStore,
        browserPool: ctx!.browserPool,
        actions,
      });
      const journalLayer = makeJournalLayer({
        participantId: ctx!.account.id,
        eventStore: ctx!.eventStore,
      });

      const program = Effect.gen(function* () {
        const platform = yield* LinkedInPlatform;
        const journal = yield* Journal;
        const inbox = yield* platform.inbox;
        const threads = Object.keys(inbox.byThreadId).length;
        yield* journal.record({ kind: "e2e_test", threads, ts: Date.now() });
        const entries = yield* journal.entries();
        return { threads, entries: entries.length };
      });

      const result = await Effect.runPromise(
        Effect.provide(program, Layer.merge(platformLayer, journalLayer)),
      );
      assertGreaterOrEqual(result.entries, 1);
    });

    await t.step("close session", async () => {
      if (ctx?.session) {
        await ctx.session.close();
        ctx.session = undefined;
      }
    });
  },
});
