// tests/e2e/linkedin_e2e_test.ts
// LinkedIn E2E test: sign-in and send message using local Playwright backend

import { assertEquals } from "@std/assert";
import { Effect, Layer, Stream } from "effect";
import {
  type LinkedInTestConfig,
  loadLinkedInTestConfig,
  type LocalTestConfig,
  loadLocalTestConfig,
} from "../lib/mod.ts";
import {
  createInMemoryConfigStore,
  createInMemoryEventStore,
  type EventStore,
  type StorableEvent,
} from "@bernays/server/store";
import {
  BrowserBackendLive,
  BrowserPool,
  makeLocalBackendWithTestUtils,
  type LocalBackendWithTestUtils,
} from "@bernays/server/browsers";
import {
  Journal,
  makeJournalLayer,
  makePlatformLayer,
} from "@bernays/server/runtime";
import {
  type LinkedInAccount,
  LinkedInPlatform,
  linkedInPlatform,
  makeLinkedInActions,
} from "@bernays/plugins/linkedin";
import { BrowserConfigId, ParticipantId, ThreadId } from "@bernays/server/core";

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_ACCOUNT_ID = "e2e-linkedin-test-account";
const TEST_BROWSER_ID = "e2e-linkedin-test-browser";

// =============================================================================
// Test Context
// =============================================================================

interface Context {
  localConfig: LocalTestConfig;
  linkedInConfig: LinkedInTestConfig;
  eventStore: EventStore<StorableEvent>;
  backend: LocalBackendWithTestUtils;
  account: LinkedInAccount;
}

let ctx: Context | undefined;

// =============================================================================
// Sockpuppet Layer Factory
// =============================================================================

const createSockpuppetLayer = (context: Context) => {
  const actions = makeLinkedInActions(context.backend.pool, context.account);

  const platformLayer = makePlatformLayer(LinkedInPlatform, {
    platform: linkedInPlatform,
    account: context.account,
    eventStore: context.eventStore,
    browserPool: context.backend.pool,
    actions,
  });

  const journalLayer = makeJournalLayer({
    participantId: context.account.id,
    eventStore: context.eventStore,
  });

  return Layer.merge(platformLayer, journalLayer);
};

// =============================================================================
// Effect-Based Sockpuppet Programs
// =============================================================================

const beginSignInProgram = (email: string, password: string) =>
  Effect.gen(function* () {
    const platform = yield* LinkedInPlatform;
    const journal = yield* Journal;

    yield* Effect.log(`Beginning sign-in as ${email}...`);

    const result = yield* platform.actions.beginSignIn()(email, password);

    yield* journal.record({
      kind: "sign_in_attempted",
      email,
      status: result.status,
      ts: Date.now(),
    });

    yield* Effect.log(`Sign-in result: ${result.status}`);

    return result;
  });

const submitTwoFactorProgram = (code: string) =>
  Effect.gen(function* () {
    const platform = yield* LinkedInPlatform;
    const journal = yield* Journal;

    yield* Effect.log(`Submitting 2FA code...`);

    const result = yield* platform.actions.submitTwoFactorCode()(code);

    yield* journal.record({
      kind: "two_factor_submitted",
      status: result.status,
      ts: Date.now(),
    });

    yield* Effect.log(`2FA result: ${result.status}`);

    return result;
  });

const sendMessageProgram = (threadId: ThreadId, content: string) =>
  Effect.gen(function* () {
    const platform = yield* LinkedInPlatform;
    const journal = yield* Journal;

    yield* Effect.log(`Sending message to thread ${threadId}...`);

    const result = yield* platform.actions.sendMessage()(threadId, content);

    yield* journal.record({
      kind: "message_sent",
      threadId,
      content,
      success: result.success,
      ts: Date.now(),
    });

    yield* Effect.log("Message sent");

    return result;
  });

const checkStateProgram = Effect.gen(function* () {
  const platform = yield* LinkedInPlatform;

  yield* Effect.log("Checking platform state...");

  const inbox = yield* platform.inbox;
  const browsers = yield* platform.browsers;

  const threadCount = Object.keys(inbox.byThreadId).length;
  const authenticatedBrowsers = browsers.filter(
    (b) => b.authStatus === "authenticated",
  );

  yield* Effect.log(
    `Inbox: ${threadCount} threads, Browsers: ${authenticatedBrowsers.length}/${browsers.length} authenticated`,
  );

  return { threadCount, authenticatedBrowsers: authenticatedBrowsers.length };
});

const fullE2EProgram = (
  email: string,
  password: string,
  threadId: ThreadId,
  message: string,
) =>
  Effect.gen(function* () {
    const platform = yield* LinkedInPlatform;
    const journal = yield* Journal;

    // Step 1: Sign in
    yield* Effect.log("=== Step 1: Sign In ===");
    const signInResult = yield* platform.actions.beginSignIn()(email, password);

    // Handle 2FA if required
    if (signInResult.status === "two_factor_required") {
      yield* Effect.log(`2FA required (${signInResult.challengeType}), waiting for code...`);
      // In a real test, we'd prompt for 2FA code or use a test authenticator
      // For now, fail explicitly
      return yield* Effect.fail(new Error("2FA required but not handled in test"));
    }

    if (signInResult.status === "failed") {
      return yield* Effect.fail(new Error(`Sign-in failed: ${signInResult.error}`));
    }

    yield* journal.record({ kind: "signed_in", ts: Date.now() });

    // Step 2: Check state
    yield* Effect.log("=== Step 2: Check State ===");
    const inbox = yield* platform.inbox;
    const browsers = yield* platform.browsers;
    yield* Effect.log(
      `Found ${Object.keys(inbox.byThreadId).length} threads, ${browsers.length} browsers`,
    );

    // Step 3: Send message
    yield* Effect.log("=== Step 3: Send Message ===");
    const messageResult = yield* platform.actions.sendMessage()(
      threadId,
      `${message} - ${new Date().toISOString()}`,
    );
    yield* journal.record({ kind: "message_sent", threadId, ts: Date.now() });

    // Step 4: Verify journal
    yield* Effect.log("=== Step 4: Verify Journal ===");
    const entries = yield* journal.entries();
    yield* Effect.log(`Journal has ${entries.length} entries`);

    return {
      signedIn: signInResult.status === "authenticated",
      threadCount: Object.keys(inbox.byThreadId).length,
      messageSent: messageResult.success,
      journalEntries: entries.length,
    };
  });

// =============================================================================
// Runner with Browser Pool
// =============================================================================

const runWithBrowserPool = <A, E>(
  program: Effect.Effect<A, E, LinkedInPlatform | Journal>,
  context: Context,
) =>
  Effect.gen(function* () {
    const browserPool = yield* BrowserPool;

    yield* Effect.fork(
      Stream.runForEach(browserPool.events, (event) =>
        Effect.log(
          `[Event] ${event.configId}: ${event.event.type}`,
        ),
      ),
    );

    const layer = createSockpuppetLayer(context);
    return yield* Effect.provide(program, layer);
  });

// =============================================================================
// Test Setup and Teardown
// =============================================================================

Deno.test.beforeAll(async () => {
  const localConfig = await loadLocalTestConfig();
  const linkedInConfig = await loadLinkedInTestConfig();

  const eventStore = createInMemoryEventStore();
  const configStore = createInMemoryConfigStore();

  await Effect.runPromise(
    configStore.upsert({
      id: BrowserConfigId(TEST_BROWSER_ID),
      context: localConfig.extensionPath,
      extensionIds: [],
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

  const backend = makeLocalBackendWithTestUtils(configStore, {
    pool: {
      extensionPath: localConfig.extensionPath,
      headless: false,
      slowMo: localConfig.slowMo,
      userDataDir: localConfig.userDataDir,
    },
  });

  ctx = {
    localConfig,
    linkedInConfig,
    eventStore,
    backend,
    account,
  };
});

Deno.test.afterAll(async () => {
  if (ctx) {
    await Effect.runPromise(
      ctx.backend.pool.stop(BrowserConfigId(TEST_BROWSER_ID)).pipe(
        Effect.catchAll(() => Effect.void),
      ),
    );
  }
  ctx = undefined;
});

// =============================================================================
// Tests
// =============================================================================

Deno.test({
  name: "linkedin: e2e sign-in and message flow",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    if (!ctx) {
      throw new Error("Context not initialized");
    }

    const configId = BrowserConfigId(TEST_BROWSER_ID);
    const browserLayer = BrowserBackendLive(ctx.backend);

    await t.step("launch browser", async () => {
      await Effect.runPromise(ctx!.backend.pool.launch(configId));
      const running = await Effect.runPromise(
        ctx!.backend.pool.isRunning(configId),
      );
      assertEquals(running, true);
    });

    await t.step("sign in via Effect action", async () => {
      const { linkedinTestEmail, linkedinTestPassword } = ctx!.linkedInConfig;

      const program = runWithBrowserPool(
        beginSignInProgram(linkedinTestEmail, linkedinTestPassword),
        ctx!,
      );

      const result = await Effect.runPromise(
        Effect.provide(program, browserLayer),
      );

      // Handle 2FA if needed - for now just check we got a valid result
      if (result.status === "two_factor_required") {
        console.log(`2FA required (${result.challengeType}), test would need manual code entry`);
        // Could add submitTwoFactorProgram here with a test code
      } else {
        assertEquals(result.status, "authenticated");
      }
    });

    await t.step("check platform state", async () => {
      const program = runWithBrowserPool(checkStateProgram, ctx!);

      const result = await Effect.runPromise(
        Effect.provide(program, browserLayer),
      );

      console.log("State:", result);
    });

    await t.step("send message via Effect action", async () => {
      const { linkedinTestThreadId } = ctx!.linkedInConfig;

      const program = runWithBrowserPool(
        sendMessageProgram(
          ThreadId(linkedinTestThreadId),
          `E2E Test - ${new Date().toISOString()}`,
        ),
        ctx!,
      );

      const result = await Effect.runPromise(
        Effect.provide(program, browserLayer),
      );

      assertEquals(result.success, true);
    });

    await t.step("stop browser", async () => {
      await Effect.runPromise(ctx!.backend.pool.stop(configId));
      const running = await Effect.runPromise(
        ctx!.backend.pool.isRunning(configId),
      );
      assertEquals(running, false);
    });
  },
});

Deno.test({
  name: "linkedin: full e2e program",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    if (!ctx) {
      throw new Error("Context not initialized");
    }

    const configId = BrowserConfigId(TEST_BROWSER_ID);
    const browserLayer = BrowserBackendLive(ctx.backend);

    await t.step("run full program", async () => {
      await Effect.runPromise(ctx!.backend.pool.launch(configId));

      const {
        linkedinTestEmail,
        linkedinTestPassword,
        linkedinTestThreadId,
      } = ctx!.linkedInConfig;

      const program = runWithBrowserPool(
        fullE2EProgram(
          linkedinTestEmail,
          linkedinTestPassword,
          ThreadId(linkedinTestThreadId),
          "Full E2E Test",
        ),
        ctx!,
      );

      const result = await Effect.runPromise(
        Effect.provide(program, browserLayer),
      );

      console.log("Result:", result);

      assertEquals(result.signedIn, true);
      assertEquals(result.messageSent, true);

      await Effect.runPromise(ctx!.backend.pool.stop(configId));
    });
  },
});
