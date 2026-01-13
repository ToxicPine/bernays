# bernays

## Document Purpose

This document provides **coding standards and design principles** for bernays. 
For detailed architectural specifications, layer definitions, and implementation 
patterns, see `ARCHITECTURE.md`.

**This document covers**:

1. System goals and core requirements
2. Coding style and conventions
3. Design principles and non-obvious decisions
4. Architectural overview (lightweight, with references)

---

## The Goal

Build a runtime for **sockpuppets**—long-lived programs that simulate humans
interacting with online accounts. A sockpuppet wakes up when it wants, checks
its inbox, decides what to do, acts, and records what it did. The runtime's job
is to make this feel natural: the sockpuppet shouldn't care about browsers,
platform APIs, or crash recovery.

**Core requirement**: You can restart the process at any time and it will
continue safely. Browser sessions persist externally. Everything the program
"knows" is in an append-only event log. Anything derivable from the log is not
stored as mutable state.

**From the sockpuppet's perspective**:

```typescript
const myBot = Effect.gen(function* () {
  const platform = yield* Platform; // the world I can see and act in
  const journal = yield* Journal; // my memory

  const inbox = yield* platform.inbox;
  for (const [threadId, meta] of Object.entries(inbox.byThreadId)) {
    // decide, act, remember
  }
});
```

Everything else exists to make this possible.

---

## Coding Style & Conventions

### TypeScript Path Alias

Use the `$/` path alias for imports within the server package:

```typescript
// Good
import { Result } from "$/core/mod.ts";
import type { StorableEvent } from "$/store/mod.ts";
import { BrowserPool } from "$/connectivity/mod.ts";

// Bad - relative paths are harder to refactor
import { Result } from "../../core/result.ts";
```

The alias is configured in `deno.json` and resolves to `server/src/`.

### Functional Style

- Prefer pure functions, immutable data structures, composition
- Use discriminated unions and type guards over class hierarchies
- Prefer interfaces + functions or small modules over deep class inheritance
- No `any`; use `unknown` and narrow with type guards

### Result Type for Errors

Use `Result<T, E>` for operations that can fail predictably:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Good - explicit error handling
const result = await store.append(events);
if (!result.ok) {
  console.error("Append failed:", result.error);
  return;
}

// Avoid throwing for expected failures
```

### Effect-TS for Services

Services use Effect-TS for dependency injection and composition:

```typescript
import { Context, Effect, Layer } from "effect";

// Define service interface
interface MyService {
  readonly doThing: () => Effect.Effect<string, MyError>;
}

// Create service tag
class MyServiceTag
  extends Context.Tag("my/Service")<MyServiceTag, MyService>() {}

// Implement as layer
const MyServiceLive = Layer.succeed(MyServiceTag, {
  doThing: () => Effect.succeed("done"),
});
```

**Key patterns**:

- Services are interfaces, not classes
- `Context.Tag` creates the dependency injection token
- `Layer` provides implementations
- Use `Effect.gen(function* () { ... })` for sequential operations
- Use `yield*` to access services: `const svc = yield* MyServiceTag`

### Zod for Validation

Use Zod schemas at system boundaries (bridge messages, storage, external input).
Co-locate schemas with the types they validate:

```typescript
import { z } from "@zod/zod";

export const MyEventSchema = z.object({
  scope: z.literal("myplatform"),
  type: z.literal("MyEvent"),
  eventId: z.string().transform(EventId),
  timestamp: z.string(),
  // ... event-specific fields
});

export type MyEvent = z.infer<typeof MyEventSchema>;
```

**Schema inheritance**: Use `.extend()` to build schema hierarchies:

```typescript
const BaseSchema = z.object({ id: z.string() });
const ExtendedSchema = BaseSchema.extend({ extra: z.number() });
```

### Branded Types

Use branded types to prevent mixing up IDs and other stringly-typed values:

```typescript
type Brand<T, B extends string> = T & { readonly __brand: B };

type Scope = Brand<string, "Scope">;
type AccountId = Brand<string, "AccountId">;
type ThreadId = Brand<string, "ThreadId">;
type EventId = Brand<string, "EventId">;
type CorrelationId = Brand<string, "CorrelationId">;
type CanonicalId = Brand<string, "CanonicalId">;
type BrowserConfigId = Brand<string, "BrowserConfigId">;
type ExtensionId = Brand<string, "ExtensionId">;

// Constructor functions
const Scope = (value: string): Scope => value as Scope;
const AccountId = (value: string): AccountId => value as AccountId;
const ExtensionId = (value: string): ExtensionId => value as ExtensionId;
```

**Where to use branded types**:

| Type              | Why                                                    |
| ----------------- | ------------------------------------------------------ |
| `Scope`           | Extensible string—new platforms without modifying core |
| `AccountId`       | Don't mix with user IDs or other identifiers           |
| `ThreadId`        | Prevent passing a message ID where thread ID expected  |
| `EventId`         | Deduplication key—must not collide with correlation ID |
| `CorrelationId`   | Tracing—links related events across the system         |
| `CanonicalId`     | Message identity—distinct from platform's native ID    |
| `BrowserConfigId` | Don't mix with browser instance IDs                    |
| `ExtensionId`     | Don't mix extension IDs with other identifiers         |

Branded types catch bugs at compile time where plain strings would silently pass
the wrong value. Use Zod's `.transform()` to cast strings to branded types.

### Naming Conventions

| Category | Pattern                     | Examples                                           |
| -------- | --------------------------- | -------------------------------------------------- |
| Events   | `{What}{Verb}` + context    | `AuthObserved`, `MessageSent`, `RateLimitObserved` |
| Intents  | `{Verb}{What}`              | `SendMessage`, `SyncConversations`                 |
| Schemas  | `{TypeName}Schema`          | `LinkedInEventSchema`, `SendMessageSchema`         |
| Services | `{Domain}Service`           | `BrowserPoolService`, `JournalService`             |
| Tags     | `{Domain}` (no suffix)      | `BrowserPool`, `Journal`, `Platform`               |
| Views    | `{What}` or `{Scope}{What}` | `LinkedInBrowser`, `LinkedInInbox`                 |

### Module Organization

Each module has a `mod.ts` barrel that exports the public API:

```typescript
// connectivity/mod.ts
export { BrowserPool, type BrowserPoolService } from "./pool.ts";
export type { BridgeError, BridgeEvent } from "./bridge.ts";
```

Import from barrels, not internal files:

```typescript
// Good
import { BrowserPool } from "$/connectivity/mod.ts";

// Bad
import { BrowserPool } from "$/connectivity/pool.ts";
```

---

## Design Principles

### 1. Sockpuppets See a Simple World

Sockpuppets interact with two services only:

- `Platform` — inbox, threads, browsers, execute
- `Journal` — record decisions, restore state

They never see: EventStore, BrowserPool, Projections, Behaviors, schemas.
Everything complex is hidden behind these two interfaces.

### 2. One Flow

Events flow through one path:

```
Extension → BrowserPool → EventIngestion → EventStore → Projection → Platform → Sockpuppet
```

Auth events, message events, rate limit events—all platform-scoped, all the same
pipe. No separate loops for different event types.

### 3. Derive Everything

Inbox, threads, auth state, rate limits—all derived from the same event stream
by pure adapter functions. Nothing is stored except the append-only event log.
This enables:

- **Restartability**: Rebuild state by replaying events
- **Auditability**: Complete history of everything that happened
- **Consistency**: Single source of truth, no sync issues

### 4. Scope-Based Event Routing

Every event has a `scope` field (e.g., `"linkedin"`, `"journal"`). This enables:

- Database-level filtering: `WHERE scope = 'linkedin'`
- Schema routing: Look up validation schema by scope
- Type safety: Projections return typed events for their scope

### 5. Platform-Agnostic Core

The runtime knows about `PlatformDefinition`, `PlatformBehavior`, `Projection`.
It doesn't know about LinkedIn or X specifically. Platforms plug in by
registering:

- **Schemas**: Event/intent validation (the contract)
- **Behavior**: Derivation and execution (the pure functions)
- **Account storage**: Platform-specific fields

### 6. Active Services Own Their Lifecycle

Services that need background work (like consuming streams) start that work when
their layer initializes. No manual daemon forking in main.

```typescript
const makeEventIngestion = (schemas) =>
  Layer.scoped(
    EventIngestion,
    Effect.gen(function* () {
      // Start consuming on layer init
      yield* Effect.forkScoped(
        pool.events.pipe(Stream.runForEach(processEvent)),
      );
      return {};
    }),
  );
```

### 7. Canonical IDs for Restartability

Message events use deterministic IDs generated from content:

```typescript
const canonicalId = await hash(scope, threadAnchor, sender, content, timestamp);
```

Same message observed twice → same ID → deduplicated. This is what makes
restarts safe.

### 8. Failures Are Events

No special error handling. Extensions observe what happens and emit events:

```typescript
{ scope: "linkedin", type: "RateLimitObserved", retryAfter: "..." }
{ scope: "linkedin", type: "AuthExpiredObserved", configId: "..." }
```

The behavior's `deriveBrowsers` function folds these events to determine which
browsers are usable, with platform-specific status attached.

### 9. Journal for Sockpuppet State

The global event log records world state. The journal records sockpuppet
decisions. On restart, sockpuppets fold their journal to restore their own
state:

```typescript
const past = yield * journal.entries();
const repliedThreads = new Set(
  past.filter((e) => e.kind === "replied").map((e) => e.threadId),
);
```

### 10. Accounts Are Bindings, Not Metadata

An account is a **binding** between a persistent platform ID and browser sessions.
It contains only:

- `id`: The platform's persistent identifier (LinkedIn member ID, X user ID)
- `browserBindings`: Which browsers are logged into this account

**Accounts do NOT store:**

- Display names, handles, profile URLs (can change, observed from events)
- Follower counts, verification status (dynamic, observed from events)
- Rate limits, invite limits (platform-imposed, derived from rate limit events)
- Any metadata the platform controls

All dynamic platform state is derived from the event stream. The account store
only tracks "this ID exists and uses these browsers."

---

## Architectural Overview

> **Full details**: See `EFFECT_ARCHITECTURE.md` for complete layer definitions,
> interfaces, and implementation patterns.

### Layer Stack

```
Layer 0: Storage        — Database, EventStore, ConfigStore
Layer 1: Browser Backend — BrowserBackend (bundles BrowserPool + ExtensionStore)
Layer 2: Event Flow      — EventIngestion (consumes stream, validates, stores)
Layer 3: Projections     — Typed, filtered access to EventStore per scope
Layer 4: Platform        — What sockpuppets use (Platform + Journal services)
Layer 5: Sockpuppet      — The human-like agent
```

BrowserBackend bundles pool and extension store together to ensure compatibility
between implementations (e.g., Browserbase stores extensions for you, local
Playwright loads from filesystem).

### Key Types

| Type                      | Purpose                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `StorableEvent`           | Base event shape: `scope`, `type`, `eventId`, `timestamp`    |
| `BaseIntent<TScope>`      | Base intent shape: `scope`, `type`                           |
| `BaseAccount`             | Complete account: `id` + `browserBindings` (no other fields) |
| `BaseBoundBrowser`        | Base browser view: `configId`, `isRunning`, `metadata`       |
| `Projection<TEvent>`      | Type-safe filtered access to events by scope                 |
| `PlatformDefinition<...>` | Registration unit: schemas + behavior for a platform         |
| `PlatformBehavior<...>`   | Derivation + browser selection + execution for a platform    |
| `PlatformService<...>`    | What sockpuppets use: inbox, thread, browsers, execute       |
| `BrowserBackend`          | Bundles BrowserPool + ExtensionStore (ensures compatibility) |

### PlatformDefinition Interface

Platform definitions bundle everything needed for a platform:

```typescript
interface PlatformDefinition<TScope, TEvent, TIntent, TAnchor, TThread, TInbox, TAccount, TBrowser> {
  readonly scope: TScope;
  readonly eventSchema: z.ZodType<TEvent>;
  readonly intentSchema: z.ZodType<TIntent>;
  readonly anchorSchema: z.ZodType<TAnchor>;
  readonly behavior: PlatformBehavior<...>;
}
```

The behavior provides pure derivation and execution:

- `deriveInbox(events, accountId)` → inbox view
- `deriveThread(events, threadId)` → thread view
- `deriveBrowsers(events, account, runningIds)` → platform-specific browser
  status
- `execute(intent, browsers, preferConfigId?)` → browser selection + execution

### Message Graph Model

Messages form a graph via `predecessorId` references:

- **Anchor messages**: Thread roots with platform-specific anchor data
- **Reply messages**: Reference their predecessor

Each behavior's `deriveThread` walks the graph according to platform-specific
threading rules.

### Templates

Event and intent templates provide base schemas that platforms extend:

```typescript
// Base template
const AuthObservedBase = CorrelatedEventSchema.extend({
  configId: z.string().transform(BrowserConfigId),
  accountId: z.string().transform(AccountId),
  status: z.enum(["authenticated", "expired", "unknown"]),
});

// Platform extends with scope and type
const LinkedInAuthObservedSchema = AuthObservedBase.extend({
  scope: z.literal("linkedin"),
  type: z.literal("AuthObserved"),
});
```

---

## Non-Obvious Decisions

### Why `Scope` is a Branded String, Not a Union

The system must be extensible. New platforms can be added without modifying core
types. A union type would require changing core code for each new platform.

### Why Projections Exist

Type safety at service boundaries. The platform service yields a projection and
gets typed events—guaranteed. No filtering logic, no "what if wrong events leak
through."

### Why Browser Bindings Are on Accounts

An account can be logged into multiple browsers (mobile, desktop). The
sockpuppet decides which to use based on its own logic (time of day, rate
limits, etc.). Browser bindings connect accounts to their available browsers.

### Why Behaviors Are Pure Functions

Behaviors have no state, no side effects (except `execute`). They're pure
derivation over event streams. This makes them testable, predictable, and easy
to reason about.

### Why the Journal Is Separate

World events (what happened) vs. agent decisions (what the sockpuppet did).
These are different concerns. The journal is just a projection filtered by
`scope: "journal"` and `accountId`.

### Why Events Have Both `eventId` and `correlationId`

- `eventId`: Deduplication key, deterministic for messages
- `correlationId`: Tracing, links related events (an intent and its outcomes)

They serve different purposes and must not be confused.

---

## Quick Reference

### Creating a New Platform Definition

1. Define schemas in `plugins/{platform}/schemas.ts`
2. Implement behavior in `plugins/{platform}/behavior.ts`
3. Define views in `plugins/{platform}/views.ts`
4. Create account store in `plugins/{platform}/account.ts` (uses BaseAccount—no custom fields)
5. Export platform definition in `plugins/{platform}/mod.ts`
6. Register in `main.ts` PLATFORMS array

### Adding a New Event Type

1. Create or extend template in `events/templates/`
2. Extend in platform's `schemas.ts` with scope and type literals
3. Add to platform's discriminated union schema
4. Update behavior derivation functions as needed

### Adding a New Intent Type

1. Create or extend template in `intents/templates/`
2. Extend in platform's `schemas.ts`
3. Add to platform's intent union schema
4. Implement handling in behavior's `execute` function

### Agents

Specialized agents in `.claude/agents/` handle cross-cutting concerns:

| Agent | Use When |
|-------|----------|
| `plugin-scaffold` | Creating new platform plugins |
| `deploy-orchestrator` | Changing deployment backends, updating Justfile |
| `hack-tracker` | Documenting deviations in HACKS.md |
| `test-architect` | Writing tests for store, backend, projections |
| `codebase-auditor` | Checking layer boundaries, import discipline |
| `campaign-planner` | Planning sockpuppet campaigns |
| `proxy-setup` | Configuring Tailscale proxy infrastructure |

When changing infrastructure (DB, browser backend), check `deploy-orchestrator` and
`hack-tracker` agents for script dependencies that may need updates.
