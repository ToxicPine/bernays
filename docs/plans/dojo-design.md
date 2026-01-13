IMMEDIATE FEEDBACK FOR THE DOC BELOW:

* you say to depend on eventstore, but we have projections that we use for safety, should we not be using those?
* can we keep the functionality of deriveBrowsers open-ended? what if we want to test a plugin that deliberately makes unavailable certain browsers at certain points in the day?

---

# Dojo Design: Browser-Free Platform Testing

## Problem

Sockpuppets use `Platform.execute()` to send messages. In real platforms, this goes through `BrowserPool`. Dojos need the same interface but without browser dependencies.

Current coupling:
```typescript
// PlatformBehavior.execute has BrowserPool in requirements
execute: (...) => Effect<{ usedConfigId }, ExecuteError, BrowserPool>
```

## Goal

1. Same sockpuppet code works for real platforms and dojos
2. Dojos have zero browser dependencies
3. TUI can inject "external world" events (messages from other users)
4. Clean, minimal abstraction

## Key Insight

**EventStore is the universal interface.** Both TUI and dojo sockpuppets communicate through it:
- TUI injects `MessageObserved` (incoming from "other users")
- Dojo `execute` appends `MessageSent` (outgoing from sockpuppet)
- Both read the same event stream for derived views

## Design

### 1. Parameterize Execute Requirements

Make `PlatformBehavior` generic over what `execute` needs:

```typescript
interface PlatformBehavior<
  TScope, TEvent, TIntent, TAnchor, TThread, TInbox, TAccount, TBrowser,
  TExecuteRequirements = BrowserPool  // NEW: default to BrowserPool
> {
  readonly scope: TScope

  // Pure derivation (unchanged)
  readonly deriveInbox: (events, accountId) => TInbox
  readonly deriveThread: (events, threadId) => TThread | undefined
  readonly deriveBrowsers: (events, account, runningIds) => readonly TBrowser[]

  // Execute with parameterized requirements
  readonly execute: (intent, browsers, preferConfigId?) =>
    Effect<{ usedConfigId }, ExecuteError, TExecuteRequirements>
}
```

Real plugins: `PlatformBehavior<..., BrowserPool>`
Dojo plugins: `PlatformBehavior<..., EventStore>`

### 2. Dojo Behavior Implementation

Dojo plugins reuse all pure derivation from real plugins:

```typescript
// plugins/linkedindojo/behavior.ts
import { deriveInbox, deriveThread, deriveBrowsers } from "../linkedin/behavior.ts"
import { EventStore } from "@bernays/server/store"

export const linkedInDojoBehavior: PlatformBehavior<
  "linkedindojo", LinkedInEvent, LinkedInIntent, ..., EventStore  // EventStore, not BrowserPool
> = {
  scope: Scope("linkedindojo"),

  // Reuse pure derivation
  deriveInbox,
  deriveThread,
  deriveBrowsers,

  // Execute writes directly to EventStore
  execute: (intent, browsers, preferConfigId) =>
    Effect.gen(function* () {
      const store = yield* EventStore

      // Same browser selection logic
      const selected = selectBrowser(browsers, preferConfigId)
      if (!selected) {
        return yield* Effect.fail(executeError(...))
      }

      // Map intent to resulting event
      const event = intentToEvent(intent, selected)
      yield* Effect.tryPromise(() => store.append([event]))

      return { usedConfigId: selected.configId }
    })
}
```

### 3. Phantom Browsers

Dojos simulate browsers without real browser processes:

- `deriveBrowsers` still works (folds `AuthObserved` events)
- TUI injects `AuthObserved` to "log in" phantom browsers
- Phantom browsers are always "running" (no real process to check)

```typescript
// In dojo's deriveBrowsers or makePlatformService
const runningConfigIds = new Set(
  account.browserBindings.map(b => b.configId)  // All phantom browsers "run"
)
```

### 4. TUI Injection (Helper Functions, Not a Service)

TUI uses EventStore directly. Provide typed helpers:

```typescript
// dojo/inject.ts
export const injectMessage = (
  store: EventStore,
  scope: Scope,
  params: {
    threadId: ThreadId
    senderId: ParticipantId
    content: string
    predecessorId: CanonicalId
  }
) => Effect.gen(function* () {
  const canonicalId = yield* hashMessage(scope, params.threadId, params.senderId, params.content)
  yield* Effect.tryPromise(() => store.append([{
    scope,
    type: "MessageObserved",
    eventId: EventId(crypto.randomUUID()),
    timestamp: new Date().toISOString(),
    threadId: params.threadId,
    canonicalId,
    senderId: params.senderId,
    content: params.content,
    kind: "reply",
    predecessorId: params.predecessorId,
  }]))
  return canonicalId
})

export const createThread = (store, scope, anchor, initialMessage) => ...
export const setAuth = (store, scope, configId, accountId, status) => ...
```

### 5. Message Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         EventStore                               │
│  scope: "linkedindojo"                                           │
└─────────────────────────────┬───────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
    TUI injects         Sockpuppet reads    Sockpuppet executes
    ───────────         ────────────────    ───────────────────
    MessageObserved     platform.inbox      platform.execute()
    AuthObserved        platform.thread()   → appends MessageSent
    createThread()      platform.browsers
```

## Changes Required

### Core Changes

1. **`platforms/mod.ts`** - Add `TExecuteRequirements` type parameter to `PlatformBehavior`
2. **`platforms/mod.ts`** - Add `TExecuteRequirements` to `PlatformDefinition`
3. **`platforms/service.ts`** - `makePlatformService` becomes generic over requirements

### New Files

1. **`dojo/inject.ts`** - Helper functions for TUI event injection
2. **`dojo/phantom.ts`** - Phantom browser utilities (always-running logic)
3. **`plugins/linkedindojo/`** - LinkedIn dojo plugin
4. **`plugins/xdojo/`** - X dojo plugin
5. **`plugins/redditdojo/`** - Reddit dojo plugin

### Plugin Changes

Each real plugin's behavior type annotation changes (no code change, just type):
```typescript
// Before
export const linkedInBehavior: PlatformBehavior<...>

// After (explicit)
export const linkedInBehavior: PlatformBehavior<..., BrowserPool>
```

## No Separate DojoReader/DojoInjector Services

The original DOJO.md was right: **EventStore is the only interface**.

- DojoReader? No. Use `Platform` service (same as sockpuppets).
- DojoInjector? No. Use helper functions over EventStore.
- DojoService? No. It was unnecessary indirection.

The TUI just needs:
1. A `Platform` service (for reading inbox/threads)
2. Direct EventStore access (for injecting events)

Both of these already exist.

## Scope Handling

Events use dojo-specific scope for isolation:
- `"linkedin"` → real LinkedIn events
- `"linkedindojo"` → sandbox events

Same event schemas, different scope literal. Projections filter by scope.

## Implementation Order

1. Add `TExecuteRequirements` type parameter to core interfaces
2. Create `dojo/inject.ts` helpers
3. Create `plugins/linkedindojo/` (simplest first)
4. Create TUI script using Ink
5. Repeat for X and Reddit dojos
