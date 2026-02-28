# LinkedIn Testing Strategy

This document is the **specification** for the LinkedIn plugin. It defines the
ideal shape of the plugin — events, state, views, sync fiber, and actions — and
describes the tests we will implement against. The plugin implementation is
built to make these tests pass.

---

## Table of Contents

- [Core Principle: Pure Cookie Injection](#core-principle-pure-cookie-injection)
- [Plugin Shape](#plugin-shape)
  - [Events](#events)
  - [Plugin State](#plugin-state)
  - [Views](#views)
  - [Sync Fiber](#sync-fiber)
  - [Actions](#actions)
- [Phase 1: Auth Acquisition Script](#phase-1-auth-acquisition-script)
- [Phase 2: Test Harness](#phase-2-test-harness)
- [Cookie Transport](#cookie-transport)
- [Environment Variables](#environment-variables)
- [File Layout](#file-layout)
- [CI Considerations](#ci-considerations)

---

## Core Principle: Pure Cookie Injection

Every test run starts from a **fresh browser profile**. No persistent
`--user-data-dir`, no Browserbase contexts, no stale state carried between runs.

LinkedIn auth state is two cookies (per
[WAALAXY_INTERNALS.md](extensions/waalaxy/WAALAXY_INTERNALS.md)):

| Cookie       | Purpose                                                      |
| ------------ | ------------------------------------------------------------ |
| `li_at`      | Primary auth token. Presence = logged in.                    |
| `JSESSIONID` | Session ID. Value (stripped of quotes) = CSRF token.         |

These are injected into a fresh browser at the start of every test run. No
localStorage, IndexedDB, or service worker state is required.

---

## Plugin Shape

The ideal LinkedIn plugin, derived from the Waalaxy internals and our
architecture. This is what we implement against.

### Events

Events are observations — things that happened on LinkedIn, recorded in the
event store. They are emitted by the sync fiber (passive observation) or by
actions (consequences of intentional acts).

#### Auth Events

| Event | Emitted By | Fields | Purpose |
|-------|-----------|--------|---------|
| `AuthObserved` | Sync fiber | `configId`, `tabId`, `authenticated`, `canRead`, `canWrite` | Periodic auth health check. Sync fiber reads `li_at` cookie presence and emits this. |
| `TwoFactorChallengeObserved` | Auth script | `configId`, `tabId`, `challengeType` (`sms` / `authenticator` / `email` / `phone_call`), `deliveryHint?`, `challengeId?` | Detected during sign-in when LinkedIn redirects to `/checkpoint/challenge/`. |
| `TwoFactorResultObserved` | Auth script | `configId`, `tabId`, `success`, `error?` | Result of 2FA code submission. |

#### Message Events

| Event | Emitted By | Fields | Purpose |
|-------|-----------|--------|---------|
| `AnchorMessageObserved` | Sync fiber | `anchor` (`conversationId`, `participants`), `threadId`, `canonicalId`, `senderId`, `content`, `timestamp` | First message observed in a conversation. Establishes the thread anchor. |
| `MessageObserved` | Sync fiber | `threadId`, `canonicalId`, `senderId`, `content`, `timestamp` | Subsequent message in an existing thread. |
| `MessageSent` | `sendMessage` action | `threadId`, `canonicalId`, `content` | Consequence of the sockpuppet sending a message. |
| `MessageMutated` | Sync fiber | `canonicalId`, `threadId`, `mutation` (`deleted` / `edited`), `editedContent?` | Detected when a message changes or disappears. |

#### Connection Events

| Event | Emitted By | Fields | Purpose |
|-------|-----------|--------|---------|
| `ConnectionRequestSent` | `sendConnectionRequest` action | `targetUserId`, `note?` | Consequence of sending an invitation. |
| `InvitationWithdrawn` | `withdrawInvitation` action | `invitationId`, `targetUserId` | Consequence of withdrawing an invitation. |
| `ConnectionAccepted` | Sync fiber | `invitationId`, `userId` | Detected when a pending invitation is accepted. |
| `ConnectionRejected` | Sync fiber | `invitationId`, `userId` | Detected when a pending invitation is rejected / expires. |

#### Profile Events

| Event | Emitted By | Fields | Purpose |
|-------|-----------|--------|---------|
| `ProfileViewed` | `viewProfile` action | `targetUserId`, `profileUrl?`, `viewedAt` | Consequence of viewing a profile. |

#### Rate Limit Events

| Event | Emitted By | Fields | Purpose |
|-------|-----------|--------|---------|
| `RateLimitObserved` | Sync fiber or actions | `configId`, `limitType` (`weekly_invites` / `daily_messages` / `searches`), `retryAfter?` | Detected from HTTP 429 or known restriction patterns. Actions emit this when LinkedIn rejects a request due to rate limiting. |

#### Conversation Sync Events

| Event | Emitted By | Fields | Purpose |
|-------|-----------|--------|---------|
| `ConversationsSynced` | Sync fiber | `participantId`, `threadCount`, `syncedAt` | Emitted after a full inbox scrape completes. Informational / audit trail. |

### Plugin State

The state that the projection fiber folds events into. All views are derived
from this state via pure materialization functions.

```typescript
interface LinkedInPluginState {
  // Thread graph — shared infra, handles anchor/reply/mutation
  graph: GraphState;

  // Connection tracking
  sentInvitations: number;
  resolvedInvitations: number;
  weeklyInviteTimestamps: string[];

  // Per-browser auth/rate-limit status
  browserStatus: Map<string, {
    authStatus: "authenticated" | "expired" | "unknown";
    rateLimitedUntil?: string;
  }>;

  // Contact directory — built from observations
  contacts: Map<string, {
    name?: string;
    headline?: string;
    profileUrl?: string;
    lastInteraction?: string;
    connectionDegree?: "1st" | "2nd" | "3rd" | "out";
  }>;

  // Last successful sync timestamp
  lastSyncedAt?: string;
}
```

### Views

Pure derivations from `LinkedInPluginState`. The sockpuppet reads these — it
never touches state directly.

#### LinkedInInbox

```typescript
interface LinkedInInbox extends BaseInboxView<LinkedInIndexMeta> {
  readonly pendingInvitations: number;
  readonly weeklyInvitesRemaining: number;
  readonly syncedAt: string;
}

interface LinkedInIndexMeta {
  readonly lastActivity: string;
  readonly unreadCount: number;
  readonly isSponsored: boolean;
}
```

#### LinkedInThread

```typescript
interface LinkedInThread extends BaseThreadView<LinkedInAnchor> {
  readonly isSponsored: boolean;
  readonly unreadCount: number;
  readonly lastActivity: string;
}
```

#### LinkedInBrowser

```typescript
interface LinkedInBrowser extends BaseBoundBrowser {
  readonly authStatus: "authenticated" | "expired" | "unknown";
  readonly rateLimitedUntil: string | undefined;
  readonly weeklyInvitesRemaining: number | undefined;
}
```

#### LinkedInContact

```typescript
interface LinkedInContact extends BaseContact<"linkedin"> {
  readonly headline?: string;
  readonly profileUrl?: string;
  readonly connectionDegree?: "1st" | "2nd" | "3rd" | "out";
  readonly lastInteraction?: string;
}
```

### Sync Fiber

The sync fiber is background observation logic defined by the LinkedIn plugin
and forked by `makePlatformLayer`. It periodically observes LinkedIn via CDP and
emits events through injection. The sockpuppet never calls or sees the sync
fiber — it just reads the views that the fiber keeps current.

The sync fiber performs three observation tasks:

#### 1. Auth Check

Reads the `li_at` cookie from the browser via CDP (`Network.getCookies`). Emits
`AuthObserved` with `authenticated: true/false`. This is how the `browsers`
view stays current — the sockpuppet reads `platform.browsers` and sees
`authStatus: "authenticated"` or `"expired"` without ever checking cookies
itself.

#### 2. Inbox Sync

Navigates to LinkedIn's messaging page (or uses the Voyager API via CDP fetch),
scrapes conversations and messages, and emits `AnchorMessageObserved` /
`MessageObserved` events for anything new. This is how the `inbox` and `thread`
views stay current.

Also detects:
- New connections (pending invitations that were accepted) → `ConnectionAccepted`
- Message deletions/edits → `MessageMutated`
- Rate limit signals → `RateLimitObserved`

After a full sync, emits `ConversationsSynced`.

#### 3. Connection Status Check

Checks the status of pending invitations by querying LinkedIn's connections
API. Emits `ConnectionAccepted` or `ConnectionRejected` for resolved
invitations.

#### Schedule

```typescript
// Defined inline by the plugin, passed to makePlatformLayer as config.sync
const makeLinkedInSync = (pool, account) =>
  Effect.gen(function* () {
    const injection = yield* LinkedInInjection;

    yield* Effect.repeat(
      Effect.gen(function* () {
        const session = yield* pool.getSession(account.browserBindings[0].configId);

        // 1. Check auth (every cycle)
        // ... read li_at cookie, emit AuthObserved ...

        // 2. Sync inbox (every cycle)
        // ... scrape conversations, emit message events ...

        // 3. Check connection status (every cycle)
        // ... check pending invitations, emit connection events ...
      }).pipe(Effect.catchAll((err) => Effect.log(`sync: ${err}`))),
      Schedule.spaced("2 minutes").pipe(Schedule.jittered),
    );
  });
```

### Actions

Actions are intentional acts the sockpuppet performs. Each action automates the
browser via CDP, performs the act on LinkedIn, observes the result, and emits
events recording the consequences.

#### sendMessage

Sends a message to a 1st-degree connection in an existing thread.

- **Input**: `threadId: ThreadId`, `content: string`
- **CDP**: Navigates to thread, types message, sends via UI or Voyager API
- **Events emitted**: `MessageSent`
- **Errors**: Thread not found, not connected, rate limited, auth expired
- **Voyager endpoint**: `POST /voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage`

#### sendConnectionRequest

Sends a connection invitation with optional note.

- **Input**: `targetId: string`, `note?: string`
- **CDP**: Sends invitation via Voyager API
- **Events emitted**: `ConnectionRequestSent`. On rate limit: `RateLimitObserved`.
- **Errors**: Already connected, weekly limit reached, profile inaccessible, note restricted
- **Voyager endpoint**: `POST /voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=...`
- **Rate limit behavior**: On 429 or `WEEKLY_CONNECTIONS_LIMIT_REACHED`, emit `RateLimitObserved` with `limitType: "weekly_invites"` and `retryAfter` set to 1 hour from now.

#### withdrawInvitation

Withdraws a pending connection invitation.

- **Input**: `targetId: string`
- **CDP**: Withdraws via Voyager API
- **Events emitted**: `InvitationWithdrawn`
- **Voyager endpoint**: `POST /voyager/api/voyagerRelationshipsDashInvitations/urn:...?action=withdraw`

#### viewProfile

Views a profile (fires the tracking beacon that LinkedIn counts as a profile view).

- **Input**: `profileUrl: string`
- **CDP**: Fires tracking beacon via `POST /li/track` or navigates to profile
- **Events emitted**: `ProfileViewed`
- **Notes**: Respects the account's privacy setting (`DISCLOSE_FULL` / `DISCLOSE_ANONYMOUS` / `HIDE`).

#### beginSignIn

Begins the sign-in process. Used by the auth acquisition script.

- **Input**: `email: string`, `password: string`
- **CDP**: Navigates to login page, fills credentials, submits form
- **Returns**: `{ status: "pending" }`, `{ status: "two_factor_required", challengeType }`, `{ status: "authenticated" }`, or `{ status: "failed", error }`
- **Events emitted**: `AuthObserved` (on success), `TwoFactorChallengeObserved` (on 2FA redirect)
- **Not tested in the automated harness** — tested by the interactive auth script.

#### submitTwoFactorCode

Submits a 2FA code during sign-in. Used by the auth acquisition script.

- **Input**: `code: string`, `rememberDevice?: boolean`
- **CDP**: Fills code into challenge form, submits
- **Returns**: `{ status: "authenticated" }` or `{ status: "failed", error }`
- **Events emitted**: `TwoFactorResultObserved`, `AuthObserved` (on success)
- **Not tested in the automated harness** — tested by the interactive auth script.

---

## Phase 1: Auth Acquisition Script

A standalone interactive script — **not** a `Deno.test`. Lives at
`tests/scripts/linkedin-auth.ts`. Run manually by a developer when cookies
expire.

### Flow

```
1. Read LINKEDIN_TEST_EMAIL / LINKEDIN_TEST_PASSWORD from env (optional)
2. Launch headed Chromium (fresh profile, no --user-data-dir)
3. Navigate to https://www.linkedin.com/login
4. If credentials are in env, pre-fill email and password fields
5. Human completes login + 2FA challenge
6. Script polls for li_at cookie (check every 2s, timeout after 5 min)
7. Once li_at is present:
   a. Extract li_at and JSESSIONID via context.cookies()
   b. Navigate to /feed to confirm auth works
   c. Write cookies to output file
   d. Print success message with cookie expiry info
8. Close browser, exit
```

### Output Format

The script writes a JSON file (default: `.linkedin-cookies.json` in project
root, gitignored):

```json
{
  "li_at": "AQEDAQx...",
  "JSESSIONID": "ajax:123456789",
  "extracted_at": "2026-02-27T12:00:00.000Z",
  "email": "test@example.com"
}
```

### Running It

```bash
# With credentials pre-filled (still requires manual 2FA)
LINKEDIN_TEST_EMAIL=you@example.com LINKEDIN_TEST_PASSWORD=secret \
  deno run -A tests/scripts/linkedin-auth.ts

# Without credentials (type everything manually)
deno run -A tests/scripts/linkedin-auth.ts

# Custom output path
deno run -A tests/scripts/linkedin-auth.ts --output /path/to/cookies.json
```

### What This Script Also Tests

The auth script doubles as a test of `beginSignIn` and `submitTwoFactorCode`.
Once implemented, it should exercise them via CDP actions rather than raw
Playwright calls, emitting `AuthObserved`, `TwoFactorChallengeObserved`, and
`TwoFactorResultObserved` events through injection.

The primary output is always the cookie file. Even if the auth actions fail to
emit events correctly, the script should still capture cookies so that action
testing can proceed independently.

---

## Phase 2: Test Harness

Standard `Deno.test` suite. Lives at `tests/e2e/linkedin_test.ts`. Specifies
and exercises the ideal LinkedIn plugin behavior.

### Structure

```typescript
Deno.test({
  name: "linkedin: e2e plugin tests",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    // ── Setup ──────────────────────────────────────────────────────
    // 1. Load cookies from file or env
    // 2. Launch headless Chromium (fresh profile)
    // 3. Inject li_at + JSESSIONID cookies
    // 4. Navigate to linkedin.com/feed
    // 5. Assert no redirect to /login — skip entire suite if stale
    // 6. Wire up platform layer with in-memory event store

    await t.step("auth: cookies are valid", async () => {
      // Navigate to /feed, assert final URL is not /login or /checkpoint
      // This gates the entire suite — if cookies are stale, skip everything
    });

    // ── Sync Fiber: Auth Observation ───────────────────────────────

    await t.step("sync: emits AuthObserved on startup", async () => {
      // Let sync fiber run one cycle
      // Assert: AuthObserved event in store with authenticated: true
      // Assert: platform.browsers shows authStatus: "authenticated"
    });

    // ── Sync Fiber: Inbox Observation ──────────────────────────────

    await t.step("sync: discovers conversations", async () => {
      // Let sync fiber run (it scrapes inbox via CDP)
      // Assert: AnchorMessageObserved events in store
      // Assert: platform.inbox has threads with messages
      // Assert: ConversationsSynced event in store
    });

    await t.step("sync: populates thread views", async () => {
      // Pick a thread from the inbox
      // Assert: platform.thread(threadId) returns messages
      // Assert: messages have senderId, content, timestamp
      // Assert: unreadCount is computed correctly
    });

    await t.step("sync: builds contact directory", async () => {
      // Pick a participant from a thread
      // Assert: platform.contact(participantId) returns contact info
      // Assert: contact has connectionDegree inferred from DM participation
    });

    // ── Actions: sendMessage ───────────────────────────────────────

    await t.step("action: sendMessage emits MessageSent", async () => {
      // Requires LINKEDIN_TEST_THREAD_ID in env
      // Call platform.actions.sendMessage()(threadId, "test message")
      // Assert: MessageSent event in store with correct threadId and content
      // Assert: message appears in platform.thread(threadId).messages
    });

    // ── Actions: viewProfile ───────────────────────────────────────

    await t.step("action: viewProfile emits ProfileViewed", async () => {
      // Call platform.actions.viewProfile()("https://www.linkedin.com/in/...")
      // Assert: ProfileViewed event in store with targetUserId and viewedAt
      // Assert: platform.contact(targetId) has profileUrl populated
    });

    // ── Actions: sendConnectionRequest ─────────────────────────────

    await t.step("action: sendConnectionRequest emits event", async () => {
      // Requires a 2nd/3rd-degree connection target
      // Call platform.actions.sendConnectionRequest()(targetId, "note")
      // Assert: ConnectionRequestSent event in store
      // Assert: platform.inbox shows pendingInvitations incremented
      // Assert: platform.inbox shows weeklyInvitesRemaining decremented
    });

    // ── Actions: withdrawInvitation ────────────────────────────────

    await t.step("action: withdrawInvitation emits event", async () => {
      // Withdraw the invitation sent in the previous step
      // Call platform.actions.withdrawInvitation()(targetId)
      // Assert: InvitationWithdrawn event in store
      // Assert: platform.inbox shows pendingInvitations decremented
    });

    // ── State Derivation ───────────────────────────────────────────

    await t.step("state: weekly invite tracking", async () => {
      // Assert: weeklyInvitesRemaining reflects ConnectionRequestSent
      //         events from the last 7 days
      // Assert: old timestamps (>7 days) are excluded from the count
    });

    await t.step("state: browser rate limit tracking", async () => {
      // Manually inject a RateLimitObserved event
      // Assert: platform.browsers shows rateLimitedUntil set
      // Assert: after the timestamp passes, rateLimitedUntil clears
    });

    // ── Teardown ───────────────────────────────────────────────────

    await t.step("cleanup", async () => {
      // Close browser, release resources
    });
  },
});
```

### Layer Stack

```typescript
// Fresh in-memory event store — no persistent state
const baseLayers = BrowserPoolLive(stubPool).pipe(
  Layer.provideMerge(EventStoreInMemory),
);

// Sync fiber + actions get a real Playwright page with injected cookies
const sync = makeLinkedInSync(pool, account);
const actions = makeLinkedInActions(pool, account);
const platformLayer = makePlatformLayer(
  LinkedInPlatform, LinkedInInjection, LinkedInProjection,
  { platform: linkedInPlatform, account, actions, sync },
);
const journalLayer = makeJournalLayer(account.id);
```

### Auth Verification

The first test step:

1. Reads cookies (see [Cookie Transport](#cookie-transport) below).
2. Creates a fresh browser context.
3. Injects cookies:
   ```typescript
   await context.addCookies([
     { name: "li_at", value: cookies.li_at, domain: ".www.linkedin.com", path: "/" },
     { name: "JSESSIONID", value: cookies.JSESSIONID, domain: ".www.linkedin.com", path: "/" },
   ]);
   ```
4. Navigates to `https://www.linkedin.com/feed/`.
5. Checks the final URL — if it redirects to `/login` or `/checkpoint`, the
   cookies are stale. The entire suite skips with:
   ```
   LinkedIn cookies expired. Re-run: deno run -A tests/scripts/linkedin-auth.ts
   ```

---

## Cookie Transport

Two mechanisms, checked in order. The harness uses whichever is available first.

### 1. Environment Variables (preferred for CI)

```bash
LINKEDIN_LI_AT=AQEDAQx...
LINKEDIN_JSESSIONID=ajax:123456789
```

Direct, no file dependency. Paste into CI secrets.

### 2. Cookie File (preferred for local dev)

```bash
LINKEDIN_COOKIES_FILE=.linkedin-cookies.json  # default if env vars not set
```

The harness reads the file, parses the JSON, extracts `li_at` and `JSESSIONID`.

### Resolution Logic

```typescript
function loadLinkedInCookies(): { li_at: string; JSESSIONID: string } {
  // 1. Check env vars directly
  const li_at = Deno.env.get("LINKEDIN_LI_AT");
  const jsessionid = Deno.env.get("LINKEDIN_JSESSIONID");
  if (li_at && jsessionid) return { li_at, JSESSIONID: jsessionid };

  // 2. Fall back to cookie file
  const filePath = Deno.env.get("LINKEDIN_COOKIES_FILE") ?? ".linkedin-cookies.json";
  const content = JSON.parse(Deno.readTextFileSync(filePath));
  return { li_at: content.li_at, JSESSIONID: content.JSESSIONID };
}
```

---

## Environment Variables

| Variable                  | Required | Default                    | Used By        |
| ------------------------- | -------- | -------------------------- | -------------- |
| `LINKEDIN_LI_AT`         | No*      | —                          | Test harness   |
| `LINKEDIN_JSESSIONID`    | No*      | —                          | Test harness   |
| `LINKEDIN_COOKIES_FILE`  | No       | `.linkedin-cookies.json`   | Test harness   |
| `LINKEDIN_TEST_EMAIL`    | No       | —                          | Auth script    |
| `LINKEDIN_TEST_PASSWORD` | No       | —                          | Auth script    |
| `LINKEDIN_TEST_THREAD_ID`| No       | —                          | sendMessage test |
| `LINKEDIN_TEST_PROFILE_URL` | No    | —                          | viewProfile test |
| `LINKEDIN_TEST_CONNECT_TARGET` | No | —                          | sendConnectionRequest test |
| `HEADLESS`               | No       | `true`                     | Test harness   |

\* One of `LINKEDIN_LI_AT`+`LINKEDIN_JSESSIONID` or a valid cookie file must be
present for the test harness to run.

---

## File Layout

```
plugins/linkedin/
├── mod.ts                   # Platform definition, injection/projection tags
├── schemas.ts               # Event schemas (Zod)
├── state.ts                 # LinkedInPluginState, emptyState
├── behavior.ts              # applyEvent, materialize* functions
├── views.ts                 # LinkedInInbox, LinkedInThread, etc.
├── browser.ts               # LinkedInBrowser, LinkedInAuthStatus
├── contact.ts               # LinkedInContact
├── account.ts               # LinkedInAccount, account store
├── service.ts               # LinkedInActions, LinkedInPlatform tag, makeLinkedInActions
└── sync.ts                  # makeLinkedInSync — background observation fiber

tests/
├── scripts/
│   └── linkedin-auth.ts     # Phase 1: interactive auth acquisition
├── e2e/
│   ├── messageboard_test.ts # Existing
│   ├── browserbase_test.ts  # Existing
│   └── linkedin_test.ts     # Phase 2: LinkedIn plugin tests
└── lib/
    ├── config.ts            # Test config schemas
    └── linkedin-cookies.ts  # Cookie loading/injection helper

.linkedin-cookies.json       # Auth script output (gitignored)
```

---

## CI Considerations

### Cookie Rotation

LinkedIn `li_at` tokens typically last weeks to months, but can be invalidated
by password change, LinkedIn security review, manual sign-out, or extended
inactivity.

The CI pipeline should:

1. Store `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID` as repository secrets.
2. Run the LinkedIn test suite.
3. If the auth verification step fails (cookies stale), skip the LinkedIn tests
   gracefully rather than failing the build.

### Rate Limiting

LinkedIn rate-limits aggressively. The test suite should:

- Run at most once per CI pipeline (not per-commit).
- Include delays between actions (±20% jitter, per WAALAXY_INTERNALS.md).
- Be gated behind a CI label or manual trigger, not run on every push.
- Skip destructive tests (sendConnectionRequest, withdrawInvitation) unless
  explicitly enabled via env flag, to avoid burning weekly invite quota.
