# Plan: ParticipantId Consolidation + Contact Derivation

## Context

**Problem Statement:**

The codebase currently uses two concepts for user identity:
- `AccountId` — branded type for "our owned accounts"
- `senderId` / `participants` — unbranded strings for message senders and thread participants

This creates issues:
1. **Type safety gap**: `senderId` fields are plain strings, losing compile-time protection
2. **Incompatible types**: Can't compare `msg.senderId === account.id` without casting
3. **Missing functionality**: No way to look up contact info for a `senderId`

**Insight:**

Our owned accounts ARE participants on the platform. The distinction is contextual (which accounts we control), not structural. A unified `ParticipantId` type serves both purposes.

**Requested Changes:**

1. **Consolidate to `ParticipantId`**: Replace `AccountId` entirely. Use `ParticipantId` for:
   - Owned account IDs (`BaseAccount.id`)
   - Message senders (`senderId`)
   - Thread participants (`participants` arrays)
   - Auth/rate-limit events (the account being affected)
   - Journal entries (which account recorded this)

2. **Add contact derivation**: Give `PlatformBehavior` an optional `deriveContact` method that folds events to build a picture of any participant (name, profile URL, connection degree, etc.)

3. **Expose contact lookup**: Add `platform.contact(participantId)` to `PlatformService` so sockpuppets can look up who they're talking to.

---

## Design Decisions

### Why not keep AccountId as an alias?

User explicitly requested no alias—just one type everywhere. The semantic distinction "owned vs external" is expressed by:
- Field naming (`account.id` vs `msg.senderId`)
- Context (in `BaseAccount` vs in message)
- Documentation

Not by separate branded types.

### Why is deriveContact optional?

Not all platforms have rich contact info. A minimal platform might only have IDs. Making it optional allows platforms to opt-in without forcing stub implementations.

### What events feed deriveContact?

Platform-specific. For LinkedIn:
- `ProfileViewed` → profileUrl
- `SearchResultsRetrieved` → name, headline
- `ConnectionRequestSent` → we initiated contact
- `ConnectionAccepted` → now 1st degree connection
- Message events → name from anchor participants

For X:
- `TweetObserved` → authorHandle, metrics
- Profile fetch events → follower counts, verification status

---

## Implementation Plan

### Phase 1: Core Type Changes

**1.1 Update branded.ts**
- Remove `AccountId` type and constructor
- Add `ParticipantId` type and constructor
- Update exports in `core/mod.ts`

**Files:**
- `backend/server/src/core/branded.ts`
- `backend/server/src/core/mod.ts`

---

### Phase 2: Event Templates

**2.1 Update message templates**
- `anchor-message.ts`: Change `senderId: z.string()` → `senderId: z.string().transform(ParticipantId)`
- `message.ts`: Same change

**2.2 Update auth template**
- `auth.ts`: Change `accountId` → `participantId` with `ParticipantId` transform

**2.3 Update rate-limit template**
- `rate-limit.ts`: Change `accountId` → `participantId` with `ParticipantId` transform

**Files:**
- `backend/server/src/events/templates/anchor-message.ts`
- `backend/server/src/events/templates/message.ts`
- `backend/server/src/events/templates/auth.ts`
- `backend/server/src/events/templates/rate-limit.ts`

---

### Phase 3: View Types

**3.1 Update thread.ts**
- `Participant.id`: `string` → `ParticipantId`
- `MessageView.senderId`: `string` → `ParticipantId`
- Update `calculateUnreadCount` signature

**3.2 Update graph.ts**
- `GraphAnchorSchema.senderId`: transform to `ParticipantId`
- `GraphReplySchema.senderId`: transform to `ParticipantId`
- `GraphNodeView.senderId`: `string` → `ParticipantId`

**3.3 Add contact.ts**
- New file with `BaseContact` interface:
```typescript
interface BaseContact {
  readonly id: ParticipantId;
  readonly name?: string;
}
```

**3.4 Update browser.ts**
- `BaseAccount.id`: `AccountId` → `ParticipantId`

**3.5 Update views/mod.ts**
- Export `BaseContact` from new file

**Files:**
- `backend/server/src/views/thread.ts`
- `backend/server/src/views/graph.ts`
- `backend/server/src/views/contact.ts` (new)
- `backend/server/src/views/browser.ts`
- `backend/server/src/views/mod.ts`

---

### Phase 4: Platform Infrastructure

**4.1 Update platforms/mod.ts**
- Add `TContact` type parameter to `PlatformBehavior`
- Add `deriveContact?` method to `PlatformBehavior`
- Add `TContact` type parameter to `PlatformDefinition`
- Update `AnyPlatform` type
- Change `deriveInbox` parameter from `accountId: AccountId` → `participantId: ParticipantId`

**4.2 Update platforms/service.ts**
- Add `TContact` type parameter to `PlatformService`
- Add `contact()` method to `PlatformService`
- Rename `accountId` → `participantId` in service interface
- Update `makePlatformService` implementation

**Files:**
- `backend/server/src/platforms/mod.ts`
- `backend/server/src/platforms/service.ts`

---

### Phase 5: Journal

**5.1 Update journal schemas and service**
- Change `accountId` → `participantId` in `JournalEntry`
- Update `makeJournalLive` to use `ParticipantId`

**Files:**
- `backend/server/src/events/journal.ts`

---

### Phase 6: LinkedIn Plugin

**6.1 Update schemas.ts**
- `LinkedInAnchorSchema.participants`: `z.array(z.string())` → `z.array(z.string().transform(ParticipantId))`
- All `accountId` fields → `participantId` with `ParticipantId` transform
- Update `LinkedInAuthObservedSchema`, `LinkedInRateLimitObservedSchema`, etc.

**6.2 Update account.ts**
- `LinkedInAccount.id`: `AccountId` → `ParticipantId`
- Update `LinkedInAccountStoreService` signatures

**6.3 Add contact.ts**
- New file with `LinkedInContact` interface:
```typescript
interface LinkedInContact extends BaseContact {
  readonly headline?: string;
  readonly profileUrl?: string;
  readonly connectionDegree?: "1st" | "2nd" | "3rd" | "out";
  readonly lastInteraction?: string;
}
```

**6.4 Update behavior.ts**
- Add `deriveContact` implementation
- Update `deriveInbox` to use `participantId: ParticipantId`
- Update type references from `AccountId` → `ParticipantId`

**6.5 Update mod.ts**
- Add `TContact` type parameter to platform definition

**Files:**
- `plugins/linkedin/schemas.ts`
- `plugins/linkedin/account.ts`
- `plugins/linkedin/contact.ts` (new)
- `plugins/linkedin/behavior.ts`
- `plugins/linkedin/mod.ts`

---

### Phase 7: X Plugin

Same changes as LinkedIn plugin.

**Files:**
- `plugins/x/schemas.ts`
- `plugins/x/account.ts`
- `plugins/x/contact.ts` (new)
- `plugins/x/behavior.ts`
- `plugins/x/mod.ts`

---

### Phase 8: Reddit Plugin

Same changes as LinkedIn plugin.

**Files:**
- `plugins/reddit/schemas.ts`
- `plugins/reddit/account.ts`
- `plugins/reddit/contact.ts` (new)
- `plugins/reddit/behavior.ts`
- `plugins/reddit/mod.ts`

---

### Phase 9: Browser Extension Updates

**9.1 Update handlers to emit `participantId` instead of `accountId`**

The browser extension emits events with `accountId` for auth and rate-limit events. These need to change to `participantId` to match the new schema.

**Files:**
- `backend/browser/src/handlers/linkedin/handlers.ts`
- `backend/browser/src/handlers/x/handlers.ts`
- `backend/browser/src/handlers/reddit/handlers.ts`

---

### Phase 10: Runtime & Scripts

**10.1 Update runtime files**
- Any files using `AccountId` in sockpuppet/runtime code

**10.2 Update scripts**
- `scripts/load-accounts.ts` and related

**Files:**
- `backend/server/src/runtime/**/*.ts`
- `scripts/*.ts`

---

## Verification Steps

After each phase:
1. Run `deno check` to catch type errors
2. Fix any cascading type issues

Final verification:
1. Run full type check: `deno task check`
2. Run tests (if any exist)
3. Manual smoke test with a running browser

---

## File Summary

| Phase | Scope | Files |
|-------|-------|-------|
| 1 | Core types | 2 |
| 2 | Event templates | 4 |
| 3 | View types | 5 |
| 4 | Platform infrastructure | 2 |
| 5 | Journal | 1 |
| 6 | LinkedIn plugin | 5 |
| 7 | X plugin | 5 |
| 8 | Reddit plugin | 5 |
| 9 | Browser extension | 3 |
| 10 | Runtime & scripts | ~5 |

**Total: ~37 files**

---

## Related Documents

- `ARCHITECTURE.md` — Updated to reflect the new design
- `CLAUDE.md` — Branded types section references `ParticipantId`
