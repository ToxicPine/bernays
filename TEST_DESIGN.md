# E2E Test Design: Message Board Sockpuppet

An end-to-end test that exercises the full bernays machinery — from event store
through reactive state to sockpuppet behavior — using a trivially simple
platform: a JSON message board.

---

## Goal

Validate the **entire chain** works together under ideal conditions:

```
EventStoreInMemory (PubSub) → Injection → Projection (subscribe) →
  background fiber fold → Ref<PluginState> → materialize → Sockpuppet
```

Plus Journal for decision memory, and a real browser (local Playwright) talking
to a JSON API via CDP — with the API served in-process through Playwright's
route interception.

This is not about testing edge cases or platform-specific logic. It's about
proving the core machinery composes correctly: events flow, state updates
reactively, views materialize, the sockpuppet can read and act, and the journal
records what happened. Once this passes, we know the architecture works. More
sensitive components (Postgres event store, Browserbase, real platform plugins)
get their own targeted test harnesses.

---

## The Message Board

A pure `Request → Response` handler function. No server, no port, no network.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/messages` | List all messages (JSON array) |
| `POST` | `/messages` | Post a new message (JSON body) |
| `DELETE` | `/messages` | Clear all messages (for test reset) |

### Message Shape

```json
{
  "id": "uuid",
  "author": "string",
  "content": "string",
  "timestamp": "ISO 8601"
}
```

### Auth

Single header: `Authorization: Bearer <API_KEY>`. Reject with 401 if missing or
wrong. That's it.

### Implementation

The board is a plain function — not a running server:

```typescript
interface BoardMessage {
  id: string;
  author: string;
  content: string;
  timestamp: string;
}

const createBoard = (apiKey: string) => {
  const messages: BoardMessage[] = [];

  return async (request: Request): Promise<Response> => {
    // Auth check
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${apiKey}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);

    if (url.pathname === "/messages" && request.method === "GET") {
      return Response.json(messages);
    }

    if (url.pathname === "/messages" && request.method === "POST") {
      const body = await request.json();
      const msg: BoardMessage = {
        id: crypto.randomUUID(),
        author: body.author,
        content: body.content,
        timestamp: new Date().toISOString(),
      };
      messages.push(msg);
      return Response.json(msg, { status: 201 });
    }

    if (url.pathname === "/messages" && request.method === "DELETE") {
      messages.length = 0;
      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  };
};
```

This lives in the test file or a small test utility module. It's ~40 lines. No
deployment, no subprocess, no cleanup.

### How It Connects to the Browser

Playwright's `page.route()` intercepts requests the browser makes before they
hit the network. The test registers a route that forwards matching requests to
the in-process board handler:

```typescript
// Intercept all requests to the fake board URL
await page.route("https://board.test/**", async (route) => {
  const request = route.request();
  const body = request.postData() ?? undefined;

  // Build a standard Request from Playwright's route info
  const req = new Request(request.url(), {
    method: request.method(),
    headers: request.headers(),
    body,
  });

  // Call the in-process handler
  const response = await boardHandler(req);

  // Fulfill the route with the handler's response
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  });
});
```

From the browser's perspective, `fetch("https://board.test/messages")` works
normally — it gets a response with the right status, headers, and body. From the
bernays machinery's perspective, everything is identical to hitting a real
server: CDP session, `page.evaluate`, `fetch()` call, response parsing. The only
difference is that no TCP connection is made.

This means:

- **No port conflicts** — nothing listens on any port
- **No subprocess management** — no server to spawn or kill
- **No network dependency** — works offline, works in CI
- **No configuration** — the URL is a hardcoded fake (`https://board.test`)
- **Hermetic** — board state is an in-memory array scoped to the test run
- **Full CDP pipeline exercised** — the browser still runs, Playwright still
  connects over CDP, `page.evaluate` still executes in the browser context

---

## The `messageboard` Plugin

A minimal bernays platform plugin. Scope: `"messageboard"`. Identity:
`"messageboard"`.

### Event Schemas

Three event types, all extending `CorrelatedEventSchema`:

```typescript
// MessageBoardAnchorMessageObserved — a new thread (message with no parent)
{
  scope: "messageboard",
  type: "AnchorMessageObserved",
  eventId, correlationId, timestamp,
  canonicalId: CanonicalId,        // hash(scope, author, content, timestamp)
  senderId: ParticipantId<"messageboard">,
  content: string,
  anchor: { boardMessageId: string },  // the server-assigned UUID
}

// MessageBoardReplyObserved — a reply to an existing message
{
  scope: "messageboard",
  type: "ReplyObserved",
  eventId, correlationId, timestamp,
  canonicalId: CanonicalId,
  senderId: ParticipantId<"messageboard">,
  content: string,
  predecessorId: CanonicalId,
}

// MessageBoardMessageSent — confirmation that we posted
{
  scope: "messageboard",
  type: "MessageSent",
  eventId, correlationId, timestamp,
  canonicalId: CanonicalId,
  senderId: ParticipantId<"messageboard">,
  content: string,
  boardMessageId: string,          // the server-assigned UUID
}
```

This is the minimum needed for the thread graph machinery to work:
`AnchorMessageObserved` creates roots, `ReplyObserved` creates edges via
`predecessorId`, and `MessageSent` records our own posts.

### Plugin State

```typescript
interface MessageBoardPluginState {
  graph: GraphState;   // thread graph from server/views/graph.ts
}
```

That's it. No auth tracking, no rate limits, no contacts. The simplest possible
state that still exercises `applyEvent` → `materialize*`.

### Behavior

```typescript
const messageBoardBehavior: PlatformBehavior<...> = {
  scope: "messageboard",
  identity: "messageboard",

  emptyState: () => ({ graph: emptyGraphState() }),

  applyEvent: (state, event) => {
    applyGraphEvent(state.graph, event);
  },

  materializeInbox: (state, participantId) => {
    const threads = materializeThreadGraphs("messageboard", state.graph);
    const byThreadId: Record<string, { lastActivity: string }> = {};
    for (const [id, thread] of threads) {
      byThreadId[id] = { lastActivity: thread.lastActivity };
    }
    return { byThreadId };
  },

  materializeThread: (state, threadId) => {
    const threads = materializeThreadGraphs("messageboard", state.graph);
    const thread = threads.get(threadId);
    if (!thread) return undefined;
    return {
      threadId,
      messages: thread.nodes.map(n => ({
        id: n.message.canonicalId,
        senderId: n.message.senderId,
        content: n.message.content,
        timestamp: n.message.timestamp ?? "",
      })),
      participants: [],   // not tracked for simplicity
      anchor: thread.anchor,
    };
  },

  materializeBrowsers: (_state, account, runningConfigIds) =>
    account.browserBindings.map(b => ({
      configId: b.configId,
      isRunning: runningConfigIds.has(b.configId),
      metadata: b.metadata ?? {},
    })),
};
```

### Actions (CDP-based, route-intercepted)

The action implementations use Playwright connected over CDP. The plugin gets a
`CdpSession` from the `BrowserPool`, connects Playwright via
`chromium.connectOverCDP(session.cdpUrl)`, and uses `page.evaluate` to execute
`fetch()` calls inside the browser context.

The page has route interception registered (see "How It Connects to the Browser"
above), so `fetch("https://board.test/messages")` inside `page.evaluate` is
intercepted by Playwright and fulfilled from the in-process board handler. The
action code doesn't know or care — it just does `fetch()` and gets a response.

This is the key design choice: **we use CDP not because we need a browser to
call a JSON API**, but because the point is to exercise the BrowserPool → CDP →
action → injection pipeline. The browser is the vehicle for HTTP calls, same as
a real platform plugin would use a browser to interact with a website.

The actions factory receives a pre-configured `page` (with routes already
registered) rather than creating pages itself. This keeps route setup in one
place (the test harness) and keeps the action code focused on its job.

```typescript
const BOARD_URL = "https://board.test";
const BOARD_API_KEY = "test-key";

interface MessageBoardActionDeps {
  page: Page;                            // pre-configured with route interception
  injector: Injector<MessageBoardEvent>;
  account: MessageBoardAccount;
}

const makeMessageBoardActions = (
  deps: MessageBoardActionDeps,
): MessageBoardActions => ({
  postMessage: (_options) => (content) =>
    Effect.tryPromise({
      try: async () => {
        const result = await deps.page.evaluate(
          async ({ url, key, body }) => {
            const res = await fetch(`${url}/messages`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${key}`,
              },
              body: JSON.stringify(body),
            });
            return res.json();
          },
          {
            url: BOARD_URL,
            key: BOARD_API_KEY,
            body: { author: deps.account.id, content },
          },
        );
        return result;
      },
      catch: (err) => ({ code: "PostFailed" as const, message: String(err) }),
    }).pipe(
      Effect.flatMap((result) =>
        deps.injector.append({
          scope: "messageboard",
          type: "MessageSent",
          eventId: EventId(crypto.randomUUID()),
          correlationId: CorrelationId(crypto.randomUUID()),
          timestamp: new Date().toISOString(),
          canonicalId: /* hash(...) */,
          senderId: deps.account.id,
          content,
          boardMessageId: result.id,
        }).pipe(Effect.map(() => ({ success: true, messageId: result.id })))
      ),
    ),

  readMessages: (_options) => () =>
    Effect.tryPromise({
      try: async () => {
        return await deps.page.evaluate(
          async ({ url, key }) => {
            const res = await fetch(`${url}/messages`, {
              headers: { "Authorization": `Bearer ${key}` },
            });
            return res.json();
          },
          { url: BOARD_URL, key: BOARD_API_KEY },
        );
      },
      catch: (err) => ({ code: "ReadFailed" as const, message: String(err) }),
    }).pipe(
      Effect.flatMap((messages) =>
        // Inject each observed message as an AnchorMessageObserved event
        Effect.forEach(messages, (msg) =>
          deps.injector.append({
            scope: "messageboard",
            type: "AnchorMessageObserved",
            eventId: EventId(crypto.randomUUID()),
            correlationId: CorrelationId(crypto.randomUUID()),
            timestamp: msg.timestamp,
            canonicalId: /* hash(...) */,
            senderId: ParticipantId("messageboard", msg.author),
            content: msg.content,
            anchor: { boardMessageId: msg.id },
          }),
          { discard: true },
        ).pipe(Effect.map(() => messages))
      ),
    ),
});
```

### Platform Definition & Tags

```typescript
const MESSAGEBOARD_SCOPE = Scope("messageboard");

const MessageBoardInjection = makeInjectorTag<MessageBoardEvent>("messageboard/Injection");
const MessageBoardProjection = makeProjectionTag<MessageBoardEvent>("messageboard/Projection");

const MessageBoardInjectionLive = makeInjectionLayer(
  MessageBoardInjection, MESSAGEBOARD_SCOPE, MessageBoardEventSchema,
);
const MessageBoardProjectionLive = makeProjectionLayer(
  MessageBoardProjection, MESSAGEBOARD_SCOPE, MessageBoardEventSchema,
);

class MessageBoardPlatform extends Context.Tag("messageboard/Platform")<
  MessageBoardPlatform, MessageBoardService
>() {}
```

---

## Test Structure

### Test Harness Setup

The test harness creates the board handler, launches a browser via the pool,
connects Playwright over CDP, registers route interception, and wires the
Effect layers. All of this happens in `beforeAll` / the test setup step.

```typescript
// 1. Create the in-process board
const boardHandler = createBoard("test-key");

// 2. Launch browser via BrowserPool (exercises pool.launch, CdpSession)
const session = await pool.launch(configId);

// 3. Connect Playwright over CDP (exercises the CDP pipeline)
const browser = await chromium.connectOverCDP(session.cdpUrl);
const context = browser.contexts()[0] ?? await browser.newContext();
const page = await context.newPage();

// 4. Register route interception — this is the bridge
await page.route("https://board.test/**", async (route) => {
  const req = new Request(route.request().url(), {
    method: route.request().method(),
    headers: route.request().headers(),
    body: route.request().postData() ?? undefined,
  });
  const res = await boardHandler(req);
  await route.fulfill({
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.text(),
  });
});

// 5. Create actions with the pre-configured page
const actions = makeMessageBoardActions({ page, injector, account });
```

### Layer Composition

```
EventStoreInMemory          (Layer 0 — reactive, PubSub-backed)
  ├─ MessageBoardInjectionLive    (Layer 3 — validated writes)
  ├─ MessageBoardProjectionLive   (Layer 3 — validated reads + subscribe)
  ├─ JournalInjectionLive         (Layer 3 — journal writes)
  └─ JournalProjectionLive        (Layer 3 — journal reads)

ConfigStore (in-memory)     (Layer 0)
  └─ Local Playwright Pool  (Layer 1 — BrowserPool)

makePlatformLayer(MessageBoardPlatform, MessageBoardProjection, {
  platform: messageBoardPlatform,
  account,
  actions,             ← actions hold the page with route interception
})                          (Layer 4 — reactive state + materialization)

makeJournalLayer(account.id)  (Layer 4 — decision memory)
```

All layers compose into a single `Layer` that provides
`MessageBoardPlatform | Journal`. The sockpuppet program depends on exactly
these two services.

### The Sockpuppet Program

```typescript
const messageBoardBot = Effect.gen(function* () {
  const platform = yield* MessageBoardPlatform;
  const journal = yield* Journal;

  // 1. Read inbox — exercises reactive state materialization
  const inbox = yield* platform.inbox;
  const threadIds = Object.keys(inbox.byThreadId);

  // 2. Read messages from the board (action via CDP + route interception)
  //    page.evaluate → fetch("https://board.test/messages") → intercepted →
  //    in-process board handler → response → back to page.evaluate →
  //    action injects AnchorMessageObserved events
  yield* platform.actions.readMessages()();

  // 3. Read inbox again — should now reflect the injected events
  //    This exercises the reactive pipeline:
  //    action → injection → event store → PubSub → projection subscribe →
  //    background fiber fold → Ref update → materializeInbox
  const updatedInbox = yield* platform.inbox;

  // 4. Look at a specific thread
  for (const [threadId, _meta] of Object.entries(updatedInbox.byThreadId)) {
    const thread = yield* platform.thread(ThreadId(threadId));
    if (Option.isNone(thread)) continue;

    const lastMsg = thread.value.messages.at(-1);
    if (!lastMsg || lastMsg.senderId === platform.participantId) continue;

    // 5. Reply via CDP action — browser fetches POST, intercepted, board
    //    handler adds message, action injects MessageSent event
    yield* platform.actions.postMessage()(
      `Reply from bot at ${new Date().toISOString()}`,
    );

    // 6. Journal records the decision
    yield* journal.record({ kind: "replied", threadId });
  }

  // 7. Verify journal has our entries
  const entries = yield* journal.entries();

  return {
    initialThreadCount: threadIds.length,
    updatedThreadCount: Object.keys(updatedInbox.byThreadId).length,
    journalEntries: entries.length,
    entries,
  };
});
```

### Test Steps

```typescript
Deno.test({
  name: "messageboard: e2e sockpuppet with reactive state",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {

    // ── Setup ────────────────────────────────────────────────────────────

    // Board handler is created fresh — starts empty, no reset needed

    await t.step("seed messages on the board", async () => {
      // Call boardHandler directly (not through the browser) to seed
      // messages from a "human" account so the bot has something to see
      await boardHandler(new Request("https://board.test/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-key",
        },
        body: JSON.stringify({ author: "human-alice", content: "Hello?" }),
      }));
    });

    await t.step("launch browser and wire routes", async () => {
      // pool.launch(configId) → CDP session
      // chromium.connectOverCDP → page
      // page.route("https://board.test/**", handler)
      // Assert: pool.isRunning(configId) === true
    });

    // ── Core Test ────────────────────────────────────────────────────────

    await t.step("run sockpuppet", async () => {
      const result = await Effect.runPromise(
        Effect.provide(messageBoardBot, sockpuppetLayer),
      );

      // Assertions:
      // 1. updatedThreadCount > 0 — the bot saw messages
      // 2. journalEntries > 0 — the bot recorded decisions
      // 3. Verify board state directly via boardHandler GET:
      //    should contain the bot's reply message
    });

    // ── Verify Reactive State ────────────────────────────────────────────

    await t.step("verify events in store", async () => {
      // Query the in-memory event store directly
      // Assert: contains AnchorMessageObserved, MessageSent events
      // Assert: events have correct scope, valid eventIds, timestamps
    });

    await t.step("verify journal events", async () => {
      // Query journal events from the store
      // Assert: contains "replied" entries with threadIds
    });

    // ── Reactive Pipeline Verification ───────────────────────────────────

    await t.step("inject event externally, verify state updates", async () => {
      // Seed another message directly on the board via boardHandler
      // Inject a corresponding AnchorMessageObserved event directly
      //   into the event store via the Injector
      // Read platform.inbox — should reflect the new message
      //   (proves: injection → PubSub → projection subscribe →
      //    Ref update → materialize)
    });

    // ── Teardown ─────────────────────────────────────────────────────────

    await t.step("stop browser", async () => {
      // page.close(), browser.close()
      // pool.stop(configId)
      // Assert: isRunning === false
    });
  },
});
```

---

## What This Tests

Each numbered item maps to a layer of the architecture:

| # | Component | What's verified |
|---|-----------|-----------------|
| 1 | `EventStoreInMemory` | PubSub-based append + subscribe delivers events to subscribers |
| 2 | `Injection` | Zod validation on write, events reach the store |
| 3 | `Projection.query` | Scope-filtered fetch, Zod validation on read |
| 4 | `Projection.subscribe` | Reactive stream delivers new events after initial hydration |
| 5 | `makePlatformService` | Hydrate → subscribe → Ref → materialize pipeline |
| 6 | `PlatformBehavior` | `emptyState` / `applyEvent` / `materialize*` for a real plugin |
| 7 | `Thread Graph` | `applyGraphEvent` + `materializeThreadGraphs` via the behavior |
| 8 | `BrowserPool` (local) | Launch, getSession (CDP URL), stop lifecycle |
| 9 | `CDP + page.evaluate` | Playwright connected over CDP, `fetch()` inside browser context |
| 10 | `page.route` interception | Browser requests fulfilled from in-process handler |
| 11 | `Journal` | Record decisions, query entries, Zod-validated via Injection/Projection |
| 12 | `Layer Composition` | All Effect layers compose and provide correct services |
| 13 | `PlatformService` | Sockpuppet reads `inbox`, `thread`, calls `actions`, gets typed results |

### What This Does NOT Test

- **Real TCP from the browser** — requests are intercepted by `page.route` and
  never hit the network. This is intentional: the test is about the bernays
  machinery, not Chromium's network stack.
- Postgres event store (separate test harness)
- Browserbase pool (separate test harness, `tests/e2e/browserbase_test.ts`)
- Real platform plugins (LinkedIn, X, Reddit — separate targeted tests)
- HTTP API / Hono routes (separate test)
- Briefing service (could be added to this test later but not in scope)
- Schema evolution / invalid event handling (unit test territory)
- Multi-account scenarios (out of scope for first pass)

---

## File Layout

```
tests/
├── e2e/
│   └── messageboard_test.ts       # The E2E test
├── lib/
│   ├── mod.ts                     # Existing test utilities
│   └── board.ts                   # createBoard() handler (~40 lines)
└── plugins/
    └── messageboard/
        ├── mod.ts                 # PlatformDefinition, tags, layers
        ├── schemas.ts             # 3 event schemas + union
        ├── behavior.ts            # State, applyEvent, materialize*
        ├── service.ts             # MessageBoardPlatform tag, actions factory
        └── account.ts             # MessageBoardAccount type
```

The `messageboard` plugin is test infrastructure — it exists solely to exercise
the bernays machinery and has no purpose outside of `messageboard_test.ts`. It
lives under `tests/` alongside the board handler and other test utilities, not
in `plugins/` where the real platform integrations live.

No `board/` directory. No `deno.json` for the board. No Fly.io config. The
entire "server" is `createBoard(apiKey)` returning a `Request → Response`
function.

---

## Configuration

None. The board URL is a hardcoded fake (`https://board.test`), the API key is a
hardcoded test value. No `.env` files, no environment variables, no config
loading.

The only external dependency is Playwright's Chromium binary, which is already
required by the local browser pool and managed by the Nix flake.

---

## Running

```bash
# Run the E2E test — no setup, no deployment, no server to start
deno test --allow-all tests/e2e/messageboard_test.ts
```
