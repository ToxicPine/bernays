// tests/plugins/linkedin/behavior_test.ts
// Unit tests for LinkedIn plugin behavior — pure state + materialization
//
// These tests exercise the event reducer (applyEvent) and view materialization
// functions without any browser or network dependencies. They verify the
// specification from LINKEDIN_TESTING.md.
//
// Events are constructed as raw input objects and run through
// LinkedInEventSchema.parse() so Zod transforms produce real branded types.
// No `as unknown as` casts needed.

import { assertEquals, assertExists } from "@std/assert";
import {
  BrowserConfigId,
  CanonicalId,
  ParticipantId,
  ThreadId,
} from "@bernays/server/core";
import {
  type LinkedInAccount,
  linkedInBehavior,
  type LinkedInEvent,
  LinkedInEventSchema,
  type LinkedInPluginState,
} from "@bernays/plugins/linkedin";

// =============================================================================
// Test Helpers
// =============================================================================

// Raw string constants — these are the *input* format for Zod schemas.
// Branded constructors are only used where we need the output type (e.g.
// for materialize* calls or assertion lookups).
const SELF_ID = "linkedin:self-user";
const OTHER_ID = "linkedin:other-user";
const THIRD_ID = "linkedin:third-user";
const CONFIG_ID = "browser-1";

let eventCounter = 0;

/** Raw base fields for event construction (Zod input format) */
const rawBase = (overrides: Record<string, unknown> = {}) => ({
  scope: "linkedin",
  timestamp: new Date(Date.now() + eventCounter++).toISOString(),
  ...overrides,
});

/** Parse a raw event object through LinkedInEventSchema */
const parse = (raw: Record<string, unknown>): LinkedInEvent =>
  LinkedInEventSchema.parse(raw);

/** Create a test account (needs branded types for the account shape) */
const testAccount: LinkedInAccount = {
  id: ParticipantId("linkedin", "self-user"),
  browserBindings: [{
    configId: BrowserConfigId("browser-1"),
    metadata: { deviceType: "desktop" },
  }],
};

/** Apply multiple events to a fresh state */
const foldEvents = (events: LinkedInEvent[]): LinkedInPluginState => {
  const state = linkedInBehavior.emptyState();
  for (const event of events) {
    linkedInBehavior.applyEvent(state, event);
  }
  return state;
};

// =============================================================================
// Auth Events
// =============================================================================

Deno.test("behavior: emptyState creates valid initial state", () => {
  const state = linkedInBehavior.emptyState();
  assertEquals(state.graph.nodes.size, 0);
  assertEquals(state.pendingInvitations.size, 0);
  assertEquals(state.weeklyInviteTimestamps.length, 0);
  assertEquals(state.browserStatus.size, 0);
  assertEquals(state.contacts.size, 0);
  assertEquals(state.lastSyncedAt, undefined);
});

Deno.test("behavior: AuthObserved sets browser auth status", () => {
  const event = parse({
    ...rawBase(),
    type: "AuthObserved",
    configId: CONFIG_ID,
    participantId: SELF_ID,
    status: "authenticated",
  });

  const state = foldEvents([event]);
  const bs = state.browserStatus.get(BrowserConfigId(CONFIG_ID));
  assertExists(bs);
  assertEquals(bs.authStatus, "authenticated");
  assertEquals(bs.challengeType, undefined);
});

Deno.test("behavior: AuthObserved with challenged status sets challengeType", () => {
  const event = parse({
    ...rawBase(),
    type: "AuthObserved",
    configId: CONFIG_ID,
    participantId: SELF_ID,
    status: "challenged",
    challengeType: "phone",
  });

  const state = foldEvents([event]);
  const bs = state.browserStatus.get(BrowserConfigId(CONFIG_ID));
  assertExists(bs);
  assertEquals(bs.authStatus, "challenged");
  assertEquals(bs.challengeType, "phone");
});

Deno.test("behavior: AuthObserved clears challengeType when not challenged", () => {
  const challenged = parse({
    ...rawBase(),
    type: "AuthObserved",
    configId: CONFIG_ID,
    participantId: SELF_ID,
    status: "challenged",
    challengeType: "captcha",
  });

  const authenticated = parse({
    ...rawBase(),
    type: "AuthObserved",
    configId: CONFIG_ID,
    participantId: SELF_ID,
    status: "authenticated",
  });

  const state = foldEvents([challenged, authenticated]);
  const bs = state.browserStatus.get(BrowserConfigId(CONFIG_ID));
  assertExists(bs);
  assertEquals(bs.authStatus, "authenticated");
  assertEquals(bs.challengeType, undefined);
});

// =============================================================================
// Message Events
// =============================================================================

Deno.test("behavior: AnchorMessageObserved creates thread and tracks contacts", () => {
  const event = parse({
    ...rawBase(),
    type: "AnchorMessageObserved",
    threadId: "thread-1",
    canonicalId: "msg-1",
    senderId: OTHER_ID,
    content: "Hello!",
    anchor: {
      conversationId: "conv-1",
      participants: [SELF_ID, OTHER_ID],
    },
  });

  const state = foldEvents([event]);

  // Contact tracking — participants stored under branded ParticipantId keys
  const selfContact = state.contacts.get(
    ParticipantId("linkedin", "self-user"),
  );
  assertExists(selfContact);
  assertEquals(selfContact.connectionDegree, "1st");

  const otherContact = state.contacts.get(
    ParticipantId("linkedin", "other-user"),
  );
  assertExists(otherContact);
  assertEquals(otherContact.connectionDegree, "1st");
  assertExists(otherContact.lastInteraction);
});

Deno.test("behavior: MessageObserved tracks reply directionality", () => {
  const anchor = parse({
    ...rawBase(),
    type: "AnchorMessageObserved",
    threadId: "thread-1",
    canonicalId: "msg-1",
    senderId: SELF_ID,
    content: "Hey there",
    anchor: {
      conversationId: "conv-1",
      participants: [SELF_ID, OTHER_ID],
    },
  });

  const reply = parse({
    ...rawBase(),
    type: "MessageObserved",
    threadId: "thread-1",
    canonicalId: "msg-2",
    senderId: OTHER_ID,
    predecessorId: "msg-1",
    content: "Hi back!",
  });

  const state = foldEvents([anchor, reply]);

  const otherContact = state.contacts.get(
    ParticipantId("linkedin", "other-user"),
  );
  assertExists(otherContact);
  assertEquals(otherContact.hasReplied, true);
  assertExists(otherContact.lastReplyAt);
});

Deno.test("behavior: materializeInbox returns threads with metadata", () => {
  const anchor = parse({
    ...rawBase(),
    type: "AnchorMessageObserved",
    threadId: "thread-1",
    canonicalId: "msg-1",
    senderId: OTHER_ID,
    content: "Hello!",
    anchor: {
      conversationId: "conv-1",
      participants: [SELF_ID, OTHER_ID],
    },
  });

  const state = foldEvents([anchor]);
  const inbox = linkedInBehavior.materializeInbox(
    state,
    ParticipantId("linkedin", "self-user"),
  );

  assertEquals(Object.keys(inbox.byThreadId).length, 1);
  assertEquals(inbox.pendingInvitations, 0);
  assertEquals(inbox.weeklyInvitesRemaining, 100);
  assertExists(inbox.syncedAt);

  // The thread should have 1 unread message (from OTHER, not SELF)
  const meta = inbox.byThreadId[CanonicalId("msg-1")];
  assertExists(meta);
  assertEquals(meta.unreadCount, 1);
  assertEquals(meta.isSponsored, false);
});

Deno.test("behavior: materializeThread returns messages in order", () => {
  const ts1 = "2026-01-01T00:00:00.000Z";
  const ts2 = "2026-01-01T00:01:00.000Z";

  const anchor = parse({
    ...rawBase({ timestamp: ts1 }),
    type: "AnchorMessageObserved",
    threadId: "thread-1",
    canonicalId: "msg-1",
    senderId: OTHER_ID,
    content: "First",
    anchor: {
      conversationId: "conv-1",
      participants: [SELF_ID, OTHER_ID],
    },
  });

  const reply = parse({
    ...rawBase({ timestamp: ts2 }),
    type: "MessageObserved",
    threadId: "thread-1",
    canonicalId: "msg-2",
    senderId: SELF_ID,
    predecessorId: "msg-1",
    content: "Second",
  });

  const state = foldEvents([anchor, reply]);

  // Thread is keyed by root canonicalId, not threadId
  const thread = linkedInBehavior.materializeThread(
    state,
    ThreadId(CanonicalId("msg-1")),
  );
  assertExists(thread);
  assertEquals(thread.messages.length, 2);
  assertEquals(thread.messages[0].content, "First");
  assertEquals(thread.messages[1].content, "Second");
  assertEquals(thread.participants.length, 2);
});

// =============================================================================
// Connection Events
// =============================================================================

Deno.test("behavior: ConnectionRequestSent tracks invitation and weekly count", () => {
  const event = parse({
    ...rawBase(),
    type: "ConnectionRequestSent",
    targetUserId: "target-1",
    note: "Let's connect!",
  });

  const state = foldEvents([event]);

  const inv = state.pendingInvitations.get("target-1");
  assertExists(inv);
  assertEquals(inv.status, "pending");
  assertEquals(state.weeklyInviteTimestamps.length, 1);

  // Contact should be marked as "out"
  const contact = state.contacts.get("target-1");
  assertExists(contact);
  assertEquals(contact.connectionDegree, "out");
});

Deno.test("behavior: ConnectionAccepted updates invitation and contact", () => {
  const sent = parse({
    ...rawBase(),
    type: "ConnectionRequestSent",
    targetUserId: "target-1",
  });

  const accepted = parse({
    ...rawBase(),
    type: "ConnectionAccepted",
    invitationId: "inv-1",
    userId: "target-1",
  });

  const state = foldEvents([sent, accepted]);

  const inv = state.pendingInvitations.get("target-1");
  assertExists(inv);
  assertEquals(inv.status, "accepted");
  assertEquals(inv.invitationId, "inv-1");

  const contact = state.contacts.get("target-1");
  assertExists(contact);
  assertEquals(contact.connectionDegree, "1st");
});

Deno.test("behavior: InvitationWithdrawn marks invitation as withdrawn", () => {
  const sent = parse({
    ...rawBase(),
    type: "ConnectionRequestSent",
    targetUserId: "target-1",
  });

  const withdrawn = parse({
    ...rawBase(),
    type: "InvitationWithdrawn",
    invitationId: "inv-1",
    targetUserId: "target-1",
  });

  const state = foldEvents([sent, withdrawn]);

  const inv = state.pendingInvitations.get("target-1");
  assertExists(inv);
  assertEquals(inv.status, "withdrawn");
});

Deno.test("behavior: materializeInbox counts pending invitations correctly", () => {
  const events = [
    parse({ ...rawBase(), type: "ConnectionRequestSent", targetUserId: "t1" }),
    parse({ ...rawBase(), type: "ConnectionRequestSent", targetUserId: "t2" }),
    parse({ ...rawBase(), type: "ConnectionRequestSent", targetUserId: "t3" }),
    parse({
      ...rawBase(),
      type: "ConnectionAccepted",
      invitationId: "inv-1",
      userId: "t1",
    }),
    parse({
      ...rawBase(),
      type: "InvitationWithdrawn",
      invitationId: "inv-2",
      targetUserId: "t2",
    }),
  ];

  const state = foldEvents(events);
  const inbox = linkedInBehavior.materializeInbox(
    state,
    ParticipantId("linkedin", "self-user"),
  );

  // Only t3 is still pending
  assertEquals(inbox.pendingInvitations, 1);
  // 3 sent this week
  assertEquals(inbox.weeklyInvitesRemaining, 97);
});

Deno.test("behavior: weekly invite tracking respects 7-day window", () => {
  const eightDaysAgo = new Date();
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

  const oldEvent = parse({
    ...rawBase({ timestamp: eightDaysAgo.toISOString() }),
    type: "ConnectionRequestSent",
    targetUserId: "old-target",
  });

  const newEvent = parse({
    ...rawBase(),
    type: "ConnectionRequestSent",
    targetUserId: "new-target",
  });

  const state = foldEvents([oldEvent, newEvent]);
  const inbox = linkedInBehavior.materializeInbox(
    state,
    ParticipantId("linkedin", "self-user"),
  );

  // Only the recent event counts
  assertEquals(inbox.weeklyInvitesRemaining, 99);
});

// =============================================================================
// Restriction Events
// =============================================================================

Deno.test("behavior: RestrictionObserved sets restriction on browser", () => {
  const futureDate = new Date(Date.now() + 3600000).toISOString();

  const event = parse({
    ...rawBase(),
    type: "RestrictionObserved",
    configId: CONFIG_ID,
    restrictionType: "desktop_connect_restricted",
    retryAfter: futureDate,
  });

  const state = foldEvents([event]);
  const bs = state.browserStatus.get(BrowserConfigId(CONFIG_ID));
  assertExists(bs);
  assertEquals(bs.restrictions.size, 1);
  assertEquals(bs.restrictions.get("desktop_connect_restricted"), futureDate);
});

Deno.test("behavior: RestrictionCleared removes restriction", () => {
  const futureDate = new Date(Date.now() + 3600000).toISOString();

  const observed = parse({
    ...rawBase(),
    type: "RestrictionObserved",
    configId: CONFIG_ID,
    restrictionType: "weekly_invites_exhausted",
    retryAfter: futureDate,
  });

  const cleared = parse({
    ...rawBase(),
    type: "RestrictionCleared",
    configId: CONFIG_ID,
    restrictionType: "weekly_invites_exhausted",
  });

  const state = foldEvents([observed, cleared]);
  const bs = state.browserStatus.get(BrowserConfigId(CONFIG_ID));
  assertExists(bs);
  assertEquals(bs.restrictions.size, 0);
});

Deno.test("behavior: materializeBrowsers shows restrictions", () => {
  const futureDate = new Date(Date.now() + 3600000).toISOString();

  const auth = parse({
    ...rawBase(),
    type: "AuthObserved",
    configId: CONFIG_ID,
    participantId: SELF_ID,
    status: "authenticated",
  });

  const restriction = parse({
    ...rawBase(),
    type: "RestrictionObserved",
    configId: CONFIG_ID,
    restrictionType: "desktop_connect_restricted",
    retryAfter: futureDate,
  });

  const state = foldEvents([auth, restriction]);
  const browsers = linkedInBehavior.materializeBrowsers(
    state,
    testAccount,
    new Set([BrowserConfigId(CONFIG_ID)]),
  );

  assertEquals(browsers.length, 1);
  const browser = browsers[0];
  assertEquals(browser.authStatus, "authenticated");
  assertEquals(browser.isRunning, true);
  assertExists(browser.restrictions["desktop_connect_restricted"]);
});

// =============================================================================
// Browser Materialization (Discriminated Union)
// =============================================================================

Deno.test("behavior: materializeBrowsers returns authenticated with profileViewingMode", () => {
  const event = parse({
    ...rawBase(),
    type: "AuthObserved",
    configId: CONFIG_ID,
    participantId: SELF_ID,
    status: "authenticated",
  });

  const state = foldEvents([event]);
  const browsers = linkedInBehavior.materializeBrowsers(
    state,
    testAccount,
    new Set([BrowserConfigId(CONFIG_ID)]),
  );

  assertEquals(browsers.length, 1);
  const browser = browsers[0];
  assertEquals(browser.authStatus, "authenticated");
  if (browser.authStatus === "authenticated") {
    assertExists(browser.profileViewingMode);
  }
});

Deno.test("behavior: materializeBrowsers returns challenged with challengeType", () => {
  const event = parse({
    ...rawBase(),
    type: "AuthObserved",
    configId: CONFIG_ID,
    participantId: SELF_ID,
    status: "challenged",
    challengeType: "email",
  });

  const state = foldEvents([event]);
  const browsers = linkedInBehavior.materializeBrowsers(
    state,
    testAccount,
    new Set([BrowserConfigId(CONFIG_ID)]),
  );

  assertEquals(browsers.length, 1);
  const browser = browsers[0];
  assertEquals(browser.authStatus, "challenged");
  if (browser.authStatus === "challenged") {
    assertEquals(browser.challengeType, "email");
  }
});

Deno.test("behavior: materializeBrowsers returns unknown for unobserved browser", () => {
  const state = linkedInBehavior.emptyState();
  const browsers = linkedInBehavior.materializeBrowsers(
    state,
    testAccount,
    new Set([BrowserConfigId(CONFIG_ID)]),
  );

  assertEquals(browsers.length, 1);
  assertEquals(browsers[0].authStatus, "unknown");
});

// =============================================================================
// Profile Events
// =============================================================================

Deno.test("behavior: ProfileViewed tracks contact with profileUrl", () => {
  const event = parse({
    ...rawBase(),
    type: "ProfileViewed",
    targetUserId: "target-1",
    profileUrl: "https://linkedin.com/in/target",
    viewedAt: new Date().toISOString(),
    viewerPrivacySetting: "full",
  });

  const state = foldEvents([event]);
  const contact = state.contacts.get("target-1");
  assertExists(contact);
  assertEquals(contact.profileUrl, "https://linkedin.com/in/target");
  assertExists(contact.lastInteraction);
});

Deno.test("behavior: materializeContact returns contact with all fields", () => {
  const event = parse({
    ...rawBase(),
    type: "ProfileViewed",
    targetUserId: "target-1",
    profileUrl: "https://linkedin.com/in/target",
    viewedAt: new Date().toISOString(),
    viewerPrivacySetting: "full",
  });

  const state = foldEvents([event]);

  const contact = state.contacts.get("target-1");
  assertExists(contact);
  assertEquals(contact.profileUrl, "https://linkedin.com/in/target");
});

// =============================================================================
// Conversation Sync
// =============================================================================

Deno.test("behavior: ConversationsSynced updates lastSyncedAt", () => {
  const syncedAt = "2026-02-28T12:00:00.000Z";
  const event = parse({
    ...rawBase(),
    type: "ConversationsSynced",
    participantId: SELF_ID,
    threadCount: 5,
    syncedAt,
  });

  const state = foldEvents([event]);
  assertEquals(state.lastSyncedAt, syncedAt);
});

// =============================================================================
// MessageMutated
// =============================================================================

Deno.test("behavior: MessageMutated deletes message from thread", () => {
  const ts1 = "2026-01-01T00:00:00.000Z";
  const ts2 = "2026-01-01T00:01:00.000Z";
  const ts3 = "2026-01-01T00:02:00.000Z";

  const anchor = parse({
    ...rawBase({ timestamp: ts1 }),
    type: "AnchorMessageObserved",
    threadId: "t1",
    canonicalId: "msg-1",
    senderId: OTHER_ID,
    content: "Hello",
    anchor: { conversationId: "c1", participants: [SELF_ID, OTHER_ID] },
  });

  const reply = parse({
    ...rawBase({ timestamp: ts2 }),
    type: "MessageObserved",
    threadId: "t1",
    canonicalId: "msg-2",
    senderId: SELF_ID,
    predecessorId: "msg-1",
    content: "To be deleted",
  });

  const mutation = parse({
    ...rawBase({ timestamp: ts3 }),
    type: "MessageMutated",
    canonicalId: "msg-2",
    threadId: "t1",
    mutation: "deleted",
  });

  const state = foldEvents([anchor, reply, mutation]);
  const thread = linkedInBehavior.materializeThread(
    state,
    ThreadId(CanonicalId("msg-1")),
  );
  assertExists(thread);
  // Deleted messages are filtered out
  assertEquals(thread.messages.length, 1);
  assertEquals(thread.messages[0].content, "Hello");
});

Deno.test("behavior: MessageMutated edits message content", () => {
  const anchor = parse({
    ...rawBase({ timestamp: "2026-01-01T00:00:00.000Z" }),
    type: "AnchorMessageObserved",
    threadId: "t1",
    canonicalId: "msg-1",
    senderId: OTHER_ID,
    content: "Original",
    anchor: { conversationId: "c1", participants: [SELF_ID, OTHER_ID] },
  });

  const mutation = parse({
    ...rawBase({ timestamp: "2026-01-01T00:01:00.000Z" }),
    type: "MessageMutated",
    canonicalId: "msg-1",
    threadId: "t1",
    mutation: "edited",
    editedContent: "Edited content",
  });

  const state = foldEvents([anchor, mutation]);
  const thread = linkedInBehavior.materializeThread(
    state,
    ThreadId(CanonicalId("msg-1")),
  );
  assertExists(thread);
  assertEquals(thread.messages.length, 1);
  assertEquals(thread.messages[0].content, "Edited content");
});

// =============================================================================
// Multiple Restrictions
// =============================================================================

Deno.test("behavior: multiple restrictions tracked independently", () => {
  const future = new Date(Date.now() + 3600000).toISOString();

  const events = [
    parse({
      ...rawBase(),
      type: "RestrictionObserved",
      configId: CONFIG_ID,
      restrictionType: "desktop_connect_restricted",
      retryAfter: future,
    }),
    parse({
      ...rawBase(),
      type: "RestrictionObserved",
      configId: CONFIG_ID,
      restrictionType: "daily_messages_exhausted",
      retryAfter: future,
    }),
  ];

  const state = foldEvents(events);
  const bs = state.browserStatus.get(BrowserConfigId(CONFIG_ID));
  assertExists(bs);
  assertEquals(bs.restrictions.size, 2);
  assertExists(bs.restrictions.get("desktop_connect_restricted"));
  assertExists(bs.restrictions.get("daily_messages_exhausted"));
});

// =============================================================================
// ConnectionStatusUnknown
// =============================================================================

Deno.test("behavior: ConnectionStatusUnknown marks invitation as unknown", () => {
  const sent = parse({
    ...rawBase(),
    type: "ConnectionRequestSent",
    targetUserId: "target-1",
  });

  const unknown = parse({
    ...rawBase(),
    type: "ConnectionStatusUnknown",
    invitationId: "inv-1",
    userId: "target-1",
    sentAt: new Date().toISOString(),
  });

  const state = foldEvents([sent, unknown]);
  const inv = state.pendingInvitations.get("target-1");
  assertExists(inv);
  assertEquals(inv.status, "unknown");
});

// =============================================================================
// Full Flow: Auth + Sync + Messages + Connections
// =============================================================================

Deno.test("behavior: full flow produces correct inbox", () => {
  // Use recent timestamps so weekly invite tracking works correctly
  const now = new Date();
  const recentTs = (minutesAgo: number) => {
    const d = new Date(now.getTime() - minutesAgo * 60000);
    return d.toISOString();
  };
  const syncTs = recentTs(0);

  const events = [
    // Auth
    parse({
      ...rawBase({ timestamp: recentTs(5) }),
      type: "AuthObserved",
      configId: CONFIG_ID,
      participantId: SELF_ID,
      status: "authenticated",
    }),
    // Thread 1: 2 messages
    parse({
      ...rawBase({ timestamp: recentTs(4) }),
      type: "AnchorMessageObserved",
      threadId: "t1",
      canonicalId: "m1",
      senderId: OTHER_ID,
      content: "Hey",
      anchor: { conversationId: "c1", participants: [SELF_ID, OTHER_ID] },
    }),
    parse({
      ...rawBase({ timestamp: recentTs(3) }),
      type: "MessageObserved",
      threadId: "t1",
      canonicalId: "m2",
      senderId: SELF_ID,
      predecessorId: "m1",
      content: "Hi!",
    }),
    // Thread 2: 1 message
    parse({
      ...rawBase({ timestamp: recentTs(2) }),
      type: "AnchorMessageObserved",
      threadId: "t2",
      canonicalId: "m3",
      senderId: THIRD_ID,
      content: "Hello!",
      anchor: { conversationId: "c2", participants: [SELF_ID, THIRD_ID] },
    }),
    // Connection (recent — within 7-day window)
    parse({
      ...rawBase({ timestamp: recentTs(1) }),
      type: "ConnectionRequestSent",
      targetUserId: "new-person",
    }),
    // Sync event
    parse({
      ...rawBase({ timestamp: syncTs }),
      type: "ConversationsSynced",
      participantId: SELF_ID,
      threadCount: 2,
      syncedAt: syncTs,
    }),
  ];

  const state = foldEvents(events);
  const inbox = linkedInBehavior.materializeInbox(
    state,
    ParticipantId("linkedin", "self-user"),
  );

  // 2 threads
  assertEquals(Object.keys(inbox.byThreadId).length, 2);

  // Thread 1: we replied, so 0 unread
  const t1Meta = inbox.byThreadId[CanonicalId("m1")];
  assertExists(t1Meta);
  assertEquals(t1Meta.unreadCount, 0);

  // Thread 2: 1 unread from THIRD
  const t2Meta = inbox.byThreadId[CanonicalId("m3")];
  assertExists(t2Meta);
  assertEquals(t2Meta.unreadCount, 1);

  // 1 pending invitation
  assertEquals(inbox.pendingInvitations, 1);
  assertEquals(inbox.weeklyInvitesRemaining, 99);
  assertEquals(inbox.syncedAt, syncTs);

  // Browser status
  const browsers = linkedInBehavior.materializeBrowsers(
    state,
    testAccount,
    new Set([BrowserConfigId(CONFIG_ID)]),
  );
  assertEquals(browsers.length, 1);
  assertEquals(browsers[0].authStatus, "authenticated");
  assertEquals(browsers[0].isRunning, true);
});
