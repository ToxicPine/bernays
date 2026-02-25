# Reactive State Plan

Migration from stateless full-fold derivation to incremental, reactive plugin
state.

---

## Problem

Every call to `platform.inbox`, `platform.thread`, etc. runs the full pipeline:

1. Query **all** events for the scope from Postgres
2. Validate every event through Zod
3. Fold the entire event history through `buildThreadGraphs` + platform counters
4. Return a view

This happens on every call. `inbox` then `thread` means two full DB queries, two
full Zod passes, two full folds over the same data. `buildThreadGraphs` is
called redundantly by both `deriveInbox` and `deriveThread`. Work scales linearly
with total event count and is entirely redundant between calls.

When sockpuppets loop (check inbox, act, sleep, repeat), this becomes N full
re-derivations per loop iteration, all from scratch.

---

## Solution

Two-layer separation:

1. **Plugin-wide state** — events are folded into a `Ref` via the existing
   Injection/Projection boundary. How events flow from store to state (polling
   vs reactive push) is an implementation detail behind the EventStore/Projection
   boundary.
2. **Sockpuppet views** — pure materialization from the shared state. Pull-based.
   The sockpuppet reads when it's ready. Cheap: read from Ref, materialize.

---

## Architecture After Change

```
    HTTP API       CDP Actions      Journal       Scraper
        │               │              │              │
        └───────┬───────┘              │              │
                ▼                      ▼              ▼
       Injection (linkedin)   Injection (journal)  Injection (...)
          │                            │
    Zod validate                 Zod validate
          │                            │
          ▼                            ▼
       EventStore               EventStore
          │
          │  Projection.query() (poll, or reactive if store supports it)
          ▼
    ┌──────────────────────────┐
    │  Ref<LinkedInPluginState>│
    │                          │
    │  (plugin-specific state  │  designed and implemented by each plugin
    │   schema — opaque to     │
    │   the framework)         │
    └────────────┬─────────────┘
                 │
                 │  Ref.get + materialize (pure function, no IO)
                 │
        ┌────────┼────────┐
        │        │        │
   sockpuppet  sockpuppet  API handler
   account A   account B   (reads from Ref
                            or queries via
                            Projection)
```

### Data flow

**Building state:**

```
Projection.query(since?)
  → EventStore.fetch (scope-filtered)
  → Zod validate, filter invalid with warnings
  → TEvent[]
  → for each event: behavior.applyEvent(state, event)
  → Ref updated
```

**Writing events:**

```
Something happens (HTTP API, CDP action, journal, scraper)
  → Injection.append(event)
    → Zod validate (catch bugs in calling code)
    → EventStore.append (persist)
```

**Reading views:**

```
Sockpuppet wakes up
  → yield* platform.inbox
    → Ref.get(stateRef)
    → behavior.materializeInbox(state, myAccountId)
    ← TInbox
```

How and when the state Ref gets updated with new events is behind the
EventStore/Projection boundary. Today, the platform layer can poll
`projection.query(since)` on a schedule or before each sockpuppet wake. If the
EventStore later supports change notifications, the Projection can surface them
without any code above it changing.

### Two Zod boundaries, two purposes

| When | Path | Purpose |
|------|------|---------|
| Write time | Injection | Catch bugs in calling code. Prevent garbage entering the store. |
| Read time | Projection | Handle schema evolution across deploys. Filter events current code doesn't understand. |

---

## Changes by Component

### 1. `graph.ts` — Extract incremental primitives

Factor `buildThreadGraphs` into three pieces:

```typescript
// New exports
export const emptyGraphState = (): GraphState => ({
  nodes: new Map(),
  children: new Map(),
});

export const applyGraphEvent = (state: GraphState, event: StorableEvent): void => {
  // The existing loop body from buildThreadGraphs (lines 170-204)
  // Parse event against GraphEventSchema
  // Apply anchor/reply/mutation to state maps
};

export const materializeThreads = <TScope, TMessage, TAnchor>(
  scope: TScope,
  state: GraphState,
): Map<ThreadId, ThreadGraph<TScope, TMessage, TAnchor>> => {
  // The existing post-loop code from buildThreadGraphs (lines 206-246)
  // Filter to anchor roots, collect thread nodes via BFS, sort, build ThreadGraph
};

// buildThreadGraphs becomes composition of the above (no behavior change):
export function buildThreadGraphs<TScope, TMessage, TAnchor>(
  scope: TScope,
  events: readonly StorableEvent[],
): Map<ThreadId, ThreadGraph<TScope, TMessage, TAnchor>> {
  const state = emptyGraphState();
  for (const event of events) applyGraphEvent(state, event);
  return materializeThreads(scope, state);
}
```

`buildThreadGraphs` still works identically. Existing callers unchanged.

**Also export `GraphState` as a public type** so plugin state types can include
it.

### 2. `PlatformBehavior` — Replace `derive*` with incremental interface

Remove `deriveInbox`, `deriveThread`, `deriveBrowsers`, `deriveContact`. Replace
with:

```typescript
interface PlatformBehavior<
  TScope, TIdentity, TEvent, TAnchor,
  TThread, TInbox, TAccount, TBrowser, TContact,
  TPluginState,  // NEW type parameter
> {
  readonly scope: TScope;
  readonly identity: TIdentity;

  // State management
  readonly emptyState: () => TPluginState;
  readonly applyEvent: (state: TPluginState, event: TEvent) => void;

  // View materialization (pure projections from accumulated state)
  readonly materializeInbox: (
    state: TPluginState,
    participantId: ParticipantId<TIdentity>,
  ) => TInbox;

  readonly materializeThread: (
    state: TPluginState,
    threadId: ThreadId,
  ) => TThread | undefined;

  readonly materializeBrowsers: (
    state: TPluginState,
    account: TAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ) => readonly TBrowser[];

  readonly materializeContact?: (
    state: TPluginState,
    participantId: ParticipantId<TIdentity>,
  ) => TContact | undefined;
}
```

**`TPluginState` is fully opaque to the framework.** The runtime wires
`emptyState`, `applyEvent`, and `materialize*` through the PubSub/Ref machinery
but never inspects or constrains what `TPluginState` contains. Each plugin
decides:

- What state to accumulate (LinkedIn can track invitation counters and connection
  degrees; Reddit can track ban status and karma; X can track suspension and
  read/write capabilities)
- How `applyEvent` mutates it (which event types update which fields, what
  data structures to use internally)
- How `materialize*` reads it (what filtering, aggregation, or formatting to
  apply when projecting a view)

The only shared piece is `GraphState` from `graph.ts`, which plugins include in
their state and update via `applyGraphEvent`. Even this is optional — a plugin
that doesn't use the thread graph model could define its own state entirely.

The old `derive*` functions are removed from the interface. Any caller that needs
full-fold derivation (API layer, tests) can do:

```typescript
const state = behavior.emptyState();
for (const event of events) behavior.applyEvent(state, event);
const inbox = behavior.materializeInbox(state, participantId);
```

This can be a generic utility function if needed.

### 3. Each plugin behavior — Refactor to incremental

Each plugin (linkedin, reddit, x, linkedindojo) defines its own state type,
reducer, and materializers. The state schema is entirely plugin-specific — the
framework is generic over `TPluginState` and never inspects it.

**Example: LinkedIn plugin state** (other plugins will differ):

```typescript
// plugins/linkedin/state.ts
interface LinkedInPluginState {
  graph: GraphState;                    // shared thread graph primitive
  sentInvitations: number;              // LinkedIn-specific
  resolvedInvitations: number;          // LinkedIn-specific
  weeklyInvites: Array<{ timestamp: string }>;  // LinkedIn-specific
  browserStatus: Map<string, { authStatus: LinkedInAuthStatus; rateLimitedUntil?: string }>;
  contacts: Map<string, { name?: string; headline?: string; profileUrl?: string; connectionDegree?: string; lastInteraction?: string }>;
}
```

**Example: Reddit plugin state** (different shape, different concerns):

```typescript
// plugins/reddit/state.ts
interface RedditPluginState {
  graph: GraphState;                    // shared thread graph primitive
  browserStatus: Map<string, { authStatus: RedditAuthStatus; isBanned: boolean; bannedReason?: string; rateLimitedUntil?: string }>;
  contacts: Map<string, { username?: string; karma?: number; accountAge?: string; lastInteraction?: string }>;
}
```

Reddit has no invitation counters (not a LinkedIn concept). It tracks ban status
and karma instead. Each plugin tracks what matters for its platform.

**`emptyState()`** — returns a fresh empty state. Plugin-defined.

**`applyEvent(state, event)`** — the existing loop bodies from `deriveInbox`,
`deriveBrowsers`, `deriveContact`, merged into a single reducer. This is not new
logic — it's the same `if (event.type === "ConnectionRequestSent")
sentInvitations++` patterns extracted from the for-loops. Each plugin's reducer
handles its own event types and updates its own state shape.

**`materializeInbox(state, participantId)`** — the existing post-loop code from
`deriveInbox`. Reads `state.graph` via `materializeThreads()`, reads counters
from state, builds the inbox view. Each plugin formats its own inbox type
(LinkedIn includes `pendingInvitations` and `weeklyInvitesRemaining`; Reddit
includes `unreadTotal`; X includes `totalUnread`).

**`materializeThread(state, threadId)`** — reads from `state.graph`. Each plugin
adds its own metadata (LinkedIn: `isSponsored`; Reddit: `isGroupChat`; X:
`isArchived`).

**`materializeBrowsers(state, account, runningIds)`** — reads from
`state.browserStatus`. Each plugin defines its own browser view (LinkedIn:
`weeklyInvitesRemaining`; Reddit: `isBanned`; X: `suspended`, `canRead`,
`canWrite`).

**`materializeContact(state, participantId)`** — reads from `state.contacts`.
Each plugin defines its own contact view (LinkedIn: `connectionDegree`,
`headline`; Reddit: `karma`, `accountAge`; X: `following`, `handle`).

### 4. Injection and Projection — No interface changes

Injection already validates and persists. Projection already validates and reads.
Their interfaces don't change. What changes is that consumers (Journal, Briefing,
Platform) depend on them as Effect service dependencies rather than receiving the
raw EventStore as a config field.

If the EventStore later supports reactive change notifications, the Projection
can gain a `subscribe` or streaming interface. That change is internal to the
Projection/EventStore boundary — nothing above them needs to change.

### 5. Platform runtime — Wire state from Projection

`makePlatformLayer` in `platform-runtime.ts` becomes the wiring point. It
depends on `Injection<TEvent>`, `Projection<TEvent>`, and `BrowserPool` as
Effect service dependencies — it never sees the raw `EventStore`.

```typescript
export const makePlatformLayer = <...>(...) =>
  Layer.scoped(tag, Effect.gen(function* () {
    const behavior = platform.behavior;
    const projection = yield* Projection<TEvent>;

    // 1. Build state from events via Projection
    const events = yield* projection.query();
    const state = behavior.emptyState();
    for (const event of events) behavior.applyEvent(state, event);
    const stateRef = yield* Ref.make(state);

    // NOTE: Today this is a one-time fold at startup. When the EventStore
    // supports reactive notifications, the Projection can surface new
    // events incrementally and a state fiber applies them to the Ref.
    // That change lives inside the Projection/EventStore boundary —
    // nothing here needs to change.

    // 2. Build service (reads from ref + materializes)
    const pool = yield* BrowserPool;

    return {
      scope: platform.scope,
      identity: platform.identity,
      participantId: account.id,

      inbox: Effect.map(Ref.get(stateRef), (s) =>
        behavior.materializeInbox(s, account.id)),

      thread: (threadId) => Effect.map(Ref.get(stateRef), (s) =>
        Option.fromNullable(behavior.materializeThread(s, threadId))),

      browsers: Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        const runningIds = yield* getRunningConfigIds;
        return behavior.materializeBrowsers(s, account, runningIds);
      }),

      contact: (participantId) => Effect.map(Ref.get(stateRef), (s) =>
        Option.fromNullable(behavior.materializeContact?.(s, participantId))),

      actions,
    };
  }));
```

### 6. `PlatformService` interface — Unchanged

The sockpuppet-facing types don't change:

```typescript
interface PlatformService<...> {
  readonly inbox: Effect.Effect<TInbox, EventStoreError>;
  readonly thread: (id: ThreadId) => Effect.Effect<Option<TThread>, EventStoreError>;
  readonly browsers: Effect.Effect<readonly TBrowser[], EventStoreError>;
  readonly contact: (id: ParticipantId<TIdentity>) => Effect.Effect<Option<TContact>, EventStoreError>;
  readonly actions: TActions;
}
```

### 7. API layer — Minimal change

API handlers can either:
- Read from the Ref if the plugin state is available (fast)
- Or hydrate from the store and use `emptyState + fold + materialize` for
  one-off requests (same as today, just decomposed)

### 8. `EventStore` — Make idiomatic Effect service

The current `EventStore` is a plain TypeScript interface with `Promise`-returning
methods, passed around as a config field. This is non-idiomatic for Effect-TS.

Change to an Effect `Context.Tag`:

```typescript
interface EventStoreService {
  readonly append: (events: readonly StorableEvent[]) => Effect.Effect<void, EventStoreError>;
  readonly query: (q: EventStoreQuery) => Effect.Effect<readonly StorableEvent[], EventStoreError>;
}

class EventStore extends Context.Tag("EventStore")<EventStore, EventStoreService>() {}
```

This is already documented in ARCHITECTURE.md but not implemented. The reactive
migration is a natural time to make this change, since the Injector, hydration,
and platform runtime all interact with the store and benefit from Effect-native
error handling and dependency injection.

`BriefingRuntimeConfig`, `JournalRuntimeConfig`, and `makePlatformLayer` config
should stop accepting `eventStore` as a plain field. Instead, their layers should
declare typed Injection and Projection as dependencies — never the raw
EventStore:

```typescript
// Before
const makeBriefingLayer = (config: { self: AgentId; eventStore: EventStore }) => ...

// After
const makeBriefingLayer = (
  self: AgentId,
): Layer.Layer<Briefing, never, Injection<BriefingEvent> | Projection<BriefingEvent>> => ...

const makeJournalLayer = (
  participantId: ParticipantId,
): Layer.Layer<Journal, never, Injection<JournalEntry> | Projection<JournalEntry>> => ...
```

Only Injection and Projection touch the EventStore. Everything above them
depends on the typed, validated abstractions.

---

## Migration Order

1. **Extract `graph.ts` incremental primitives** — `emptyGraphState`,
   `applyGraphEvent`, `materializeThreads`. No behavior change. Existing
   `buildThreadGraphs` becomes composition.

2. **Add `TPluginState` to `PlatformBehavior`** — Add `emptyState`,
   `applyEvent`, `materialize*` to the interface. Keep `derive*` temporarily
   for backward compat.

3. **Implement plugin state for each platform** — Define state types, implement
   `applyEvent` and `materialize*` by extracting existing loop bodies. Verify
   `materialize*(fold(events))` produces identical output to `derive*(events)`.

4. **Remove `derive*` from `PlatformBehavior`** — Once all callers use the
   incremental interface.

5. **Make EventStore an Effect service** — Wrap in `Context.Tag`, update all
   config types and layer factories.

6. **Switch `PlatformService` to read from Ref** — Build state via
   `projection.query() → fold → Ref.make`. Reads become
   `Ref.get → materialize*`.

7. **Update Journal and Briefing dependencies** — Replace raw EventStore config
   fields with typed Injection/Projection Effect service dependencies.

Steps 1-4 can be done independently of 5-7. The incremental behavior refactor
is pure code reorganization with no runtime behavior change. The dependency
cleanup (Effect services, Ref-based reads) builds on top.

Future optimization: when the EventStore supports reactive notifications, the
Projection can surface new events incrementally. A background fiber can then
apply deltas to the Ref instead of re-folding. That change is internal to the
Projection/EventStore boundary — nothing above them needs to change.

---

## What Doesn't Change

- **EventStore** — Still dumb persistence (append, fetch). No PubSub awareness.
- **Event schemas** — All Zod schemas unchanged.
- **Projection interface** — Still Zod-validated, scope-filtered reads. Used for
  startup hydration and API layer.
- **PlatformService interface** — `inbox`, `thread`, `browsers`, `contact` keep
  the same Effect types. Sockpuppet code unchanged.
- **Sockpuppet code** — `yield* platform.inbox` works exactly as before.
- **Branded types** — All branded types unchanged.
- **Account model** — Accounts are still bindings, not metadata.
- **Actions** — Curried `PlatformMethod` pattern unchanged.
- **Journal** — Same scope, same Injection/Projection pattern. Dependency
  changes from raw EventStore to typed Injection/Projection.
- **Briefing** — Same scope, same pattern. Dependency changes from raw
  EventStore to typed Injection/Projection.
