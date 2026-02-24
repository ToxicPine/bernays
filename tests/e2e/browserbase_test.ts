// tests/e2e/browserbase_test.ts
// Full E2E test: PostgreSQL + Browserbase CDP

import { assertGreaterOrEqual } from "@std/assert";
import { Effect, Layer } from "effect";
import {
  cleanupTestData,
  createSession,
  type E2EConfig,
  loadConfig,
  type TestSession,
  validateBrowserbase,
  validateDatabase,
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
import { BrowserConfigId, ParticipantId } from "@bernays/server/core";

const TEST_ACCOUNT_ID = "e2e-browserbase-account";
const TEST_BROWSER_ID = "e2e-browserbase-browser";

interface Context {
  config: E2EConfig;
  eventStore: EventStore<StorableEvent>;
  configStore: ConfigStoreService;
  accountStore: LinkedInAccountStoreService;
  browserPool: BrowserPoolService;
  account: LinkedInAccount;
  session?: TestSession;
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

  const browserPool = makeBrowserbaseBackend(
    config.browserbaseApiKey,
    configStore,
  );

  ctx = {
    config,
    eventStore,
    configStore,
    accountStore,
    browserPool,
    account,
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

    await t.step("create session and verify CDP connectivity", async () => {
      ctx!.session = await createSession(ctx!.config);
      console.log(`Session created: ${ctx!.session.sessionId}`);
      console.log(`CDP URL: ${ctx!.session.cdpUrl}`);

      // Verify we can interact with the browser via CDP
      const context = ctx!.session.browser.contexts()[0] ??
        (await ctx!.session.browser.newContext());
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto("https://www.linkedin.com/feed/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      const title = await page.title();
      console.log(`Page title: ${title}`);
    });

    await t.step("verify postgres connectivity", async () => {
      const result = await ctx!.eventStore.fetch({ type: "all" });
      if (!result.ok) throw new Error(result.error.message);
      console.log(`Events in DB: ${result.value.length}`);
    });

    await t.step("launch browser via pool", async () => {
      const configId = BrowserConfigId(TEST_BROWSER_ID);
      const session = await Effect.runPromise(
        ctx!.browserPool.launch(configId),
      );
      console.log(`Pool launched browser, CDP URL: ${session.cdpUrl}`);

      const running = await Effect.runPromise(
        ctx!.browserPool.isRunning(configId),
      );
      console.log(`Browser running: ${running}`);
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
      console.log(
        `Sockpuppet result: ${result.threads} threads, ${result.entries} journal entries`,
      );
      assertGreaterOrEqual(result.entries, 1);
    });

    await t.step("stop browser via pool", async () => {
      const configId = BrowserConfigId(TEST_BROWSER_ID);
      await Effect.runPromise(
        ctx!.browserPool.stop(configId).pipe(
          Effect.catchAll(() => Effect.void),
        ),
      );
    });

    await t.step("close session", async () => {
      if (ctx?.session) {
        await ctx.session.close();
        ctx.session = undefined;
      }
    });
  },
});
