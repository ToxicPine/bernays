# Shared Platform State

This document describes the changes needed to support shared plugin state with
thin per-participant platform services. This is a refactoring of
`makePlatformLayer` and `makePlatformService` to separate infrastructure (state
ownership, observation, projection) from the per-sockpuppet service
(materialization, actions).

---

## Problem

Today, `makePlatformLayer` creates everything in one bundle per account:

```
makePlatformLayer(tag, injTag, projTag, { platform, account, actions })
  └─ creates Injection layer
  └─ creates Projection layer
  └─ hydrates Ref<PluginState> from existing events
  └─ forks projection fiber (folds new events into Ref)
  └─ returns PlatformService bound to one account
```

This means:
- Two sockpuppets on the same platform get two `Ref`s, two projection fibers,
  two copies of state — even though they're folding the same events.
- The observation fiber (once added) would also be duplicated per account.
- There's no way to share state between sockpuppets operating on the same
  platform.

The plugin state is already designed to be plugin-wide (not per-account) —
`applyEvent` folds all events regardless of which account they belong to, and
`materializeInbox(state, participantId)` filters per-account at read time. The
state is shared by design; the infrastructure isn't.

## Design

Split `makePlatformLayer` into two concerns:

### 1. Platform Infra Layer — runs once, owns state

Owns the `Ref<PluginState>`, the projection fiber, and the observation fiber.
Provides the `Ref` as a service in the layer graph via a platform-specific tag.

```typescript
// Each plugin defines a state tag
class LinkedInState extends Context.Tag("linkedin/State")<
  LinkedInState,
  Ref.Ref<LinkedInPluginState>
>() {}
```

```typescript
// Generic factory — any plugin can use this
function makePlatformInfra<
  TScope extends Scope,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TPluginState,
  TStateTag extends Context.Tag<any, Ref.Ref<TPluginState>>,
>(
  stateTag: TStateTag,
  projectionTag: Context.Tag<any, Projection<TEvent>>,
  behavior: {
    readonly emptyState: () => TPluginState;
    readonly applyEvent: (state: TPluginState, event: TEvent) => void;
  },
  observe?: Effect.Effect<never, never, any>,
): Layer.Layer<
  Context.Tag.Identifier<TStateTag>,
  EventStoreError,
  Projection<TEvent>
> {
  return Layer.scoped(
    stateTag,
    Effect.gen(function* () {
      const projection = yield* projectionTag;

      // Hydrate
      const events = yield* projection.query();
      const state = behavior.emptyState();
      for (const e of events) behavior.applyEvent(state, e);
      const stateRef = yield* Ref.make(state);

      // Projection fiber — folds new events into shared Ref
      const lastTs = events.at(-1)?.timestamp;
      yield* projection.subscribe(lastTs).pipe(
        Stream.runForEach((chunk) =>
          Ref.update(stateRef, (s) => {
            for (const e of chunk) behavior.applyEvent(s, e);
            return s;
          })
        ),
        Effect.forkScoped,
      );

      // Observer fiber (if provided)
      if (observe) {
        yield* Effect.forkScoped(observe);
      }

      return stateRef;
    }),
  );
}
```

### 2. Platform Service Layer — per participant, thin

Reads from the shared `Ref` and materializes views for one `participantId`.
Holds the actions for one account's browser bindings.

```typescript
function makePlatformServiceLayer<
  TScope extends Scope,
  TIdentity extends string,
  TEvent extends StorableEvent & { readonly scope: TScope },
  TAnchor,
  TThread extends BaseThreadView<TAnchor>,
  TInbox extends BaseInboxView<unknown>,
  TAccount extends BaseAccount<TIdentity>,
  TBrowser extends BaseBoundBrowser,
  TContact extends BaseContact<TIdentity>,
  TActions extends ActionsRecord,
  TPluginState,
  TTag extends Context.Tag<any, PlatformService<...>>,
  TStateTag extends Context.Tag<any, Ref.Ref<TPluginState>>,
>(
  tag: TTag,
  stateTag: TStateTag,
  config: {
    readonly platform: PlatformDefinition<...>;
    readonly account: TAccount;
    readonly actions: TActions;
  },
): Layer.Layer<
  Context.Tag.Identifier<TTag>,
  never,
  Context.Tag.Identifier<TStateTag> | BrowserPool
> {
  const { platform, account, actions } = config;
  const behavior = platform.behavior;

  return Layer.effect(
    tag,
    Effect.gen(function* () {
      const stateRef = yield* stateTag;
      const pool = yield* BrowserPool;

      const getRunningIds = Effect.gen(function* () {
        const results = yield* Effect.forEach(
          account.browserBindings,
          (b) => Effect.map(pool.isRunning(b.configId), (r) =>
            r ? b.configId : null),
        );
        return new Set(results.filter(
          (id): id is BrowserConfigId => id !== null,
        ));
      });

      return {
        scope: platform.scope,
        identity: platform.identity,
        participantId: account.id,

        inbox: Effect.map(Ref.get(stateRef), (s) =>
          behavior.materializeInbox(s, account.id)),

        thread: (threadId) =>
          Effect.map(Ref.get(stateRef), (s) =>
            Option.fromNullable(behavior.materializeThread(s, threadId))),

        browsers: Effect.gen(function* () {
          const s = yield* Ref.get(stateRef);
          const ids = yield* getRunningIds;
          return behavior.materializeBrowsers(s, account, ids);
        }),

        contact: (pid) =>
          Effect.map(Ref.get(stateRef), (s) =>
            Option.fromNullable(behavior.materializeContact?.(s, pid))),

        actions,
      };
    }),
  );
}
```

### Convenience: `makePlatformLayer` (unchanged API)

For the common single-account case, `makePlatformLayer` stays as the public API.
It composes both pieces internally — callers don't need to know about the split:

```typescript
function makePlatformLayer<...>(
  tag: TTag,
  injectionTag, projectionTag,
  config: {
    readonly platform: PlatformDefinition<...>;
    readonly account: TAccount;
    readonly actions: TActions;
    readonly observe?: Effect.Effect<never, never, any>;
  },
): Layer.Layer<...> {
  // Internal state tag — not exported, not visible to callers
  const stateTag = Context.GenericTag<Ref.Ref<TPluginState>>(
    `${config.platform.scope}/State`,
  );

  const infraLayer = makePlatformInfra(
    stateTag, projectionTag,
    config.platform.behavior,
    config.observe,
  );

  const serviceLayer = makePlatformServiceLayer(
    tag, stateTag,
    config,
  );

  const injectionLayer = makeInjectionLayer(...);
  const projectionLayer = makeProjectionLayer(...);

  return serviceLayer.pipe(
    Layer.provide(infraLayer),
    Layer.provideMerge(injectionLayer),
    Layer.provideMerge(projectionLayer),
  );
}
```

Existing code (messageboard test, LinkedIn single-account) continues to call
`makePlatformLayer` exactly as before. No changes needed.

## Multi-Account Composition

When a plugin needs shared state across participants, it uses the split pieces
directly:

```typescript
// ── Plugin exports ──────────────────────────────────────────────

// The state tag IS exported (unlike the single-account case)
export class LinkedInState extends Context.Tag("linkedin/State")<
  LinkedInState,
  Ref.Ref<LinkedInPluginState>
>() {}

// Infra: one Ref, one projection fiber, one observer
export const makeLinkedInInfra = (
  observe: Effect.Effect<never, never, Injector<LinkedInEvent> | BrowserPool>,
) =>
  makePlatformInfra(
    LinkedInState,
    LinkedInProjection,
    linkedInBehavior,
    observe,
  );

// Per-participant: thin service
export const makeLinkedInServiceFor = (
  account: LinkedInAccount,
  actions: LinkedInActions,
) =>
  makePlatformServiceLayer(
    LinkedInPlatform,
    LinkedInState,
    { platform: linkedInPlatform, account, actions },
  );

// ── Composition ─────────────────────────────────────────────────

// Shared infra — runs once
const observe = makeLinkedInObserver(pool, [alice, bob]);
const infra = makeLinkedInInfra(observe).pipe(
  Layer.provide(LinkedInProjectionLive),
);

// Per-sockpuppet layers
const aliceActions = makeLinkedInActions(pool, alice);
const aliceLayer = makeLinkedInServiceFor(alice, aliceActions).pipe(
  Layer.provide(infra),
);

const bobActions = makeLinkedInActions(pool, bob);
const bobLayer = makeLinkedInServiceFor(bob, bobActions).pipe(
  Layer.provide(infra),
);

// Effect memoizes layers — both get the same LinkedInState (same Ref)
await Effect.runPromise(Effect.provide(aliceBot, aliceLayer));
await Effect.runPromise(Effect.provide(bobBot, bobLayer));
```

Both sockpuppets share one `Ref<LinkedInPluginState>`, one projection fiber, and
one observer fiber. Each gets a `PlatformService` that materializes views for
its own `participantId` and holds actions bound to its own browser bindings.

## What Changes

### New Files

| File | Purpose |
|------|---------|
| `server/platforms/infra.ts` | `makePlatformInfra` — shared state + fibers |
| `server/platforms/service-layer.ts` | `makePlatformServiceLayer` — thin per-participant |

### Modified Files

| File | Change |
|------|--------|
| `server/runtime/sockpuppet/platform-runtime.ts` | `makePlatformLayer` refactored to compose the two new pieces. Same public API. |
| `server/platforms/service.ts` | `makePlatformService` deprecated or inlined — its job is split between infra (Ref + fiber) and service-layer (materialization). |
| `server/platforms/mod.ts` | Export new pieces |
| `server/runtime/mod.ts` | Export new pieces |

### Unchanged

| File | Why |
|------|-----|
| `tests/e2e/messageboard_test.ts` | Uses `makePlatformLayer` — unchanged API |
| `tests/plugins/messageboard/*` | Uses `makePlatformLayer` — unchanged API |
| `plugins/linkedin/service.ts` | Actions unchanged |
| `plugins/linkedin/behavior.ts` | Behavior unchanged |
| `plugins/linkedin/schemas.ts` | Schemas unchanged |
| All sockpuppet code | `yield* LinkedInPlatform` unchanged |

## What Does NOT Change

- **Sockpuppet API**: `yield* LinkedInPlatform` returns the same
  `PlatformService` shape.
- **PlatformBehavior**: `emptyState`, `applyEvent`, `materialize*` unchanged.
- **PlatformDefinition**: schema + behavior bundle unchanged.
- **Actions**: `PlatformMethod` pattern unchanged.
- **Events / Schemas**: unchanged.
- **Single-account usage**: `makePlatformLayer` API unchanged — existing call
  sites continue to work.

## Dependency Flow

### Single Account (current default)

```
EventStoreTag
  └─ Projection
       └─ makePlatformInfra → Ref<State>  ─┐
  └─ Injection ─────────────────────────────┤
BrowserPool ────────────────────────────────┤
                                            └─ makePlatformServiceLayer → PlatformService
                                                 └─ Sockpuppet yields
```

All composed inside `makePlatformLayer`. Caller sees one function, one layer.

### Multi Account

```
EventStoreTag
  └─ Projection
       └─ makePlatformInfra → Ref<State> (shared)
  └─ Injection (shared)
BrowserPool

  Ref<State> + BrowserPool
    ├─ makePlatformServiceLayer(alice) → PlatformService(alice)
    │    └─ Alice's sockpuppet yields
    └─ makePlatformServiceLayer(bob)   → PlatformService(bob)
         └─ Bob's sockpuppet yields
```

Caller composes explicitly. Infra runs once, services are thin views over
shared state.

## Implementation Order

1. Extract `makePlatformInfra` from the Ref/fiber logic currently in
   `makePlatformService`.
2. Extract `makePlatformServiceLayer` from the materialization/actions logic
   currently in `makePlatformService`.
3. Rewrite `makePlatformLayer` to compose them internally.
4. Verify the messageboard test passes (unchanged API).
5. Add `observe` support to `makePlatformLayer` config.
6. LinkedIn plugin uses `makePlatformLayer` (single account, with `observe`).

Multi-account composition is available immediately after step 3 but doesn't
need to be exercised until we have a use case.
