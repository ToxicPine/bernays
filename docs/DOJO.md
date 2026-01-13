# Dojo: Sandbox Platforms for Agent Testing

## Purpose

Dojo plugins (`linkedindojo`, `xdojo`, `redditdojo`) are sandboxed versions of real platform plugins. They allow testing sockpuppet behavior without hitting real platforms.

## Key Insight

The **only** difference between a dojo plugin and a real plugin is what happens in `execute()`:

| Real Plugin | Dojo Plugin |
|-------------|-------------|
| `execute()` → BrowserPool.send() → Browser does action → Extension emits event | `execute()` → Append event directly to EventStore |

Everything else is identical:
- Same event schemas
- Same intent schemas
- Same `deriveInbox()`, `deriveThread()`, `deriveBrowsers()`, `deriveContact()`
- Same view types
- Same account types

## Minimal Implementation

No new services needed. Each dojo plugin needs only:

```
plugins/linkedindojo/
  mod.ts        # PlatformDefinition with scope "linkedindojo"
  behavior.ts   # Custom execute() that appends to EventStore
  deno.json     # Package config
```

### behavior.ts

```typescript
import { Effect } from "effect";
import { EventStore } from "@bernays/server/store";
import {
  deriveInbox,
  deriveThread,
  deriveBrowsers,
  deriveContact,
  selectBrowser,  // Browser selection logic
} from "../linkedin/behavior.ts";
import type { LinkedInIntent, LinkedInEvent } from "../linkedin/schemas.ts";

const SCOPE = Scope("linkedindojo");

export const linkedInDojoBehavior: PlatformBehavior<...> = {
  scope: SCOPE,

  // Reuse all pure derivation functions from real plugin
  deriveInbox,
  deriveThread,
  deriveBrowsers,
  deriveContact,

  // Only execute() differs
  execute: (intent, browsers, preferConfigId) =>
    Effect.gen(function* () {
      const store = yield* EventStore;

      // Use same browser selection logic as real plugin
      const selected = selectBrowser(browsers, preferConfigId);
      if (!selected) {
        return yield* Effect.fail({ code: "NoBrowserAvailable" });
      }

      // Instead of sending to browser, directly append the resulting event
      switch (intent.type) {
        case "SendMessage": {
          const event: LinkedInEvent = {
            scope: SCOPE,
            type: "MessageSent",
            eventId: EventId(crypto.randomUUID()),
            timestamp: new Date().toISOString(),
            configId: selected.configId,
            threadId: intent.threadId,
            canonicalId: CanonicalId(await hashMessage(...)),
            content: intent.content,
            senderId: selected.participantId,
          };

          yield* Effect.tryPromise(() => store.append([event]));
          return { ok: true, usedConfigId: selected.configId };
        }

        // ... other intent types
      }
    }),
};
```

### mod.ts

```typescript
import { linkedInDojoBehavior } from "./behavior.ts";
import {
  LinkedInEventSchema,
  LinkedInIntentSchema,
  LinkedInAnchorSchema,
} from "../linkedin/schemas.ts";

// Transform schemas to use dojo scope
const dojoEventSchema = LinkedInEventSchema.transform((e) => ({
  ...e,
  scope: Scope("linkedindojo"),
}));

export const linkedInDojoPlatform: PlatformDefinition<...> = {
  scope: Scope("linkedindojo"),
  eventSchema: dojoEventSchema,
  intentSchema: LinkedInIntentSchema,
  anchorSchema: LinkedInAnchorSchema,
  behavior: linkedInDojoBehavior,
};
```

## Scope Segregation

Events are segregated by scope in the event store:

- `scope: "linkedin"` → Real LinkedIn events
- `scope: "linkedindojo"` → Sandbox LinkedIn events

This allows:
1. Dojo and real platforms to coexist in the same event store
2. Independent testing without polluting production data
3. Same sockpuppet code works with either scope

## Manual Reply Injection

For testing, we need to inject fake replies from "other users". This is just appending events to the EventStore:

```typescript
// In dojo-inject.tsx TUI script
const injectReply = async (
  store: EventStore,
  threadId: string,
  senderId: string,
  content: string,
) => {
  await store.append([{
    scope: "linkedindojo",
    type: "MessageObserved",  // Not MessageSent - this is an "incoming" message
    eventId: EventId(crypto.randomUUID()),
    timestamp: new Date().toISOString(),
    threadId: ThreadId(threadId),
    canonicalId: CanonicalId(await hashMessage(threadId, senderId, content)),
    content,
    senderId: ParticipantId(senderId),
    kind: "reply",
    predecessorId: /* last message in thread */,
  }]);
};
```

No special DojoService needed - the EventStore is the only interface.

## Creating New Threads

To start a new thread in the dojo:

```typescript
const createThread = async (
  store: EventStore,
  threadId: string,
  anchor: LinkedInAnchor,
  initialMessage: { senderId: string; content: string },
) => {
  await store.append([{
    scope: "linkedindojo",
    type: "AnchorMessageObserved",
    eventId: EventId(crypto.randomUUID()),
    timestamp: new Date().toISOString(),
    threadId: ThreadId(threadId),
    kind: "anchor",
    anchor,
    canonicalId: CanonicalId(await hashMessage(...)),
    senderId: ParticipantId(initialMessage.senderId),
    content: initialMessage.content,
  }]);
};
```

## Setting Auth Status

To simulate login/logout:

```typescript
const setAuth = async (
  store: EventStore,
  configId: BrowserConfigId,
  participantId: ParticipantId,
  authenticated: boolean,
) => {
  await store.append([{
    scope: "linkedindojo",
    type: "AuthObserved",
    eventId: EventId(crypto.randomUUID()),
    timestamp: new Date().toISOString(),
    configId,
    participantId,
    status: authenticated ? "authenticated" : "unknown",
    canRead: authenticated,
    canWrite: authenticated,
  }]);
};
```

## Future: Agent-Based Replies

When adding AI agents for fake replies, the pattern is the same:

```typescript
const dojoAgent = Effect.gen(function* () {
  const store = yield* EventStore;
  const llm = yield* LLMService;

  // Poll for new MessageSent events in dojo scope
  const events = yield* store.fetch({ type: "byScope", scope: "linkedindojo" });
  const newMessages = events.filter((e) => e.type === "MessageSent");

  for (const msg of newMessages) {
    // Generate reply
    const reply = yield* llm.generateReply(msg.content);

    // Inject as MessageObserved (incoming message)
    yield* store.append([{
      scope: "linkedindojo",
      type: "MessageObserved",
      // ... fields
    }]);
  }
});
```

No special service - just EventStore operations.

## Benefits of Minimal Approach

1. **No new abstractions**: DojoService was unnecessary indirection
2. **Consistent with architecture**: Everything is just events in the store
3. **Easy to understand**: Dojo = real plugin with different `execute()`
4. **Reuses all derivation logic**: `deriveInbox`, `deriveThread`, etc. are pure functions
5. **Same testing pattern**: Manual injection and agent-based injection both just append events

## Files to Create

| File | LOC (est) | Purpose |
|------|-----------|---------|
| `plugins/linkedindojo/mod.ts` | ~20 | Platform definition |
| `plugins/linkedindojo/behavior.ts` | ~100 | Custom execute() |
| `plugins/linkedindojo/deno.json` | ~10 | Package config |
| `plugins/xdojo/*` | ~130 | Same pattern |
| `plugins/redditdojo/*` | ~130 | Same pattern |
| `scripts/dojo-inject.tsx` | ~200 | TUI for manual injection |

Total: ~600 lines for all three dojo plugins + TUI script.

## What We Don't Need

- ❌ DojoService
- ❌ Separate schemas (reuse from real plugins)
- ❌ Separate view types (reuse from real plugins)
- ❌ Separate account types (reuse from real plugins)
- ❌ Browser extensions
- ❌ Browser pool integration
