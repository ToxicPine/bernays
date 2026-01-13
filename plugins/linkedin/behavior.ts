// src/platforms/linkedin/behavior.ts
// LinkedIn platform behavior - derivation and execution

import { Effect } from "effect";
import type {
  AccountId,
  BrowserConfigId,
  ThreadId,
} from "@bernays/server/core";
import type { StorableEvent } from "@bernays/server/store";
import { BrowserPool } from "@bernays/server/backend";
import {
  calculateUnreadCount,
  type MessageView,
  type Participant,
} from "@bernays/server/views";
import {
  type ExecuteError,
  ExecuteErrorCode,
  executeError,
  type PlatformBehavior,
} from "@bernays/server/platforms";
import {
  buildThreadGraphs,
  type GraphMessage,
  graphNodesToMessages,
  type ThreadGraph,
} from "@bernays/server/views";
import { logger } from "$/logger.ts";

// Platform-specific types
import type { LinkedInAnchor, LinkedInEvent } from "./schemas.ts";
import type { LinkedInIntent } from "./schemas.ts";
import type {
  LinkedInInbox,
  LinkedInIndexMeta,
  LinkedInThread,
} from "./views.ts";
import type { LinkedInAccount } from "./account.ts";
import type { LinkedInAuthStatus, LinkedInBrowser } from "./browser.ts";
import { LINKEDIN_SCOPE } from "./schemas.ts";

// Type Alias

type LinkedInScope = typeof LINKEDIN_SCOPE;

// Helper Functions

/**
 * Convert graph nodes to MessageView format
 */
const toMessageViews = (
  graph: ThreadGraph<GraphMessage, LinkedInAnchor>,
): readonly MessageView[] =>
  graphNodesToMessages(graph.nodes).map((m) => ({
    id: m.canonicalId,
    senderId: m.senderId,
    content: m.content,
    timestamp: m.timestamp,
  }));

/**
 * Extract participants from LinkedIn anchor
 */
const extractParticipants = (anchor: LinkedInAnchor): readonly Participant[] =>
  anchor.participants.map((id) => ({ id }));

/**
 * Convert ThreadGraph to LinkedInThread
 */
const toLinkedInThread = (
  graph: ThreadGraph<GraphMessage, LinkedInAnchor>,
  accountId: string,
): LinkedInThread => {
  const messages = toMessageViews(graph);
  const unreadCount = calculateUnreadCount(messages, accountId);

  return {
    threadId: graph.id,
    messages,
    participants: extractParticipants(graph.anchor),
    anchor: graph.anchor,
    unreadCount,
    isSponsored: false,
    lastActivity: graph.lastActivity,
  };
};

// LinkedIn Behavior

export const linkedInBehavior: PlatformBehavior<
  LinkedInScope,
  LinkedInEvent,
  LinkedInIntent,
  LinkedInAnchor,
  LinkedInThread,
  LinkedInInbox,
  LinkedInAccount,
  LinkedInBrowser
> = {
  scope: LINKEDIN_SCOPE,

  // ─────────────────────────────────────────────────────────────────────────
  // Derivation
  // ─────────────────────────────────────────────────────────────────────────

  deriveInbox: (
    events: readonly LinkedInEvent[],
    accountId: AccountId,
  ): LinkedInInbox => {
    const allThreads = buildThreadGraphs<GraphMessage, LinkedInAnchor>(
      events as readonly StorableEvent[],
    );

    const linkedInThreads = [...allThreads.values()].filter(
      (t) => t.scope === LINKEDIN_SCOPE,
    );

    const byThreadId: Record<string, LinkedInIndexMeta> = {};
    for (const thread of linkedInThreads) {
      const messages = toMessageViews(thread);
      const unreadCount = calculateUnreadCount(messages, accountId);
      byThreadId[thread.id] = {
        lastActivity: thread.lastActivity,
        unreadCount,
        isSponsored: false,
      };
    }

    // Calculate pendingInvitations from events
    // Count sent invitations minus accepted/rejected/withdrawn
    let sentInvitations = 0;
    let resolvedInvitations = 0;

    for (const event of events) {
      if (event.type === "ConnectionRequestSent") {
        sentInvitations++;
      } else if (
        event.type === "ConnectionAccepted" ||
        event.type === "ConnectionRejected" ||
        event.type === "InvitationWithdrawn"
      ) {
        resolvedInvitations++;
      }
    }

    const pendingInvitations = Math.max(0, sentInvitations - resolvedInvitations);

    // Calculate weeklyInvitesRemaining from events
    // LinkedIn allows ~100 invites per week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoIso = oneWeekAgo.toISOString();

    let weeklyInvitesSent = 0;
    for (const event of events) {
      if (
        event.type === "ConnectionRequestSent" &&
        event.timestamp > oneWeekAgoIso
      ) {
        weeklyInvitesSent++;
      }
    }

    const weeklyInvitesRemaining = Math.max(0, 100 - weeklyInvitesSent);

    return {
      byThreadId,
      syncedAt: new Date().toISOString(),
      pendingInvitations,
      weeklyInvitesRemaining,
    };
  },

  deriveThread: (
    events: readonly LinkedInEvent[],
    threadId: ThreadId,
  ): LinkedInThread | undefined => {
    const allThreads = buildThreadGraphs<GraphMessage, LinkedInAnchor>(
      events as readonly StorableEvent[],
    );
    const thread = allThreads.get(threadId);

    if (!thread || thread.scope !== LINKEDIN_SCOPE) {
      return undefined;
    }

    const authEvent = events.find((e) => e.type === "AuthObserved");
    const accountId = authEvent
      ? (authEvent as { accountId: string }).accountId
      : "";

    return toLinkedInThread(thread, accountId);
  },

  deriveBrowsers: (
    events: readonly LinkedInEvent[],
    account: LinkedInAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly LinkedInBrowser[] => {
    // Build browser status from events
    const browserStatus = new Map<
      string,
      {
        authStatus: LinkedInAuthStatus;
        rateLimitedUntil?: string;
        weeklyInvitesSent: number;
      }
    >();

    // Calculate weekly invites sent per browser
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoIso = oneWeekAgo.toISOString();

    // Process events (latest wins for auth, accumulate for rate limits)
    for (const event of events) {
      if (event.type === "AuthObserved") {
        const authEvent = event as {
          configId?: string;
          browserId?: string;
          authenticated: boolean;
        };
        const configId = authEvent.configId ?? authEvent.browserId;
        if (configId) {
          const existing = browserStatus.get(configId);
          browserStatus.set(configId, {
            authStatus: authEvent.authenticated ? "authenticated" : "expired",
            rateLimitedUntil: existing?.rateLimitedUntil,
            weeklyInvitesSent: existing?.weeklyInvitesSent ?? 0,
          });
        }
      } else if (event.type === "RateLimitObserved") {
        const rateLimitEvent = event as {
          configId: string;
          retryAfter?: string;
        };
        const configId = rateLimitEvent.configId;
        if (configId) {
          const existing = browserStatus.get(configId);
          // Only set rateLimitedUntil if retryAfter is in the future
          const retryAfter = rateLimitEvent.retryAfter;
          const isActive = retryAfter && retryAfter > new Date().toISOString();
          browserStatus.set(configId, {
            authStatus: existing?.authStatus ?? "unknown",
            rateLimitedUntil: isActive ? retryAfter : undefined,
            weeklyInvitesSent: existing?.weeklyInvitesSent ?? 0,
          });
        }
      } else if (
        event.type === "ConnectionRequestSent" &&
        event.timestamp > oneWeekAgoIso
      ) {
        // Track weekly invites per browser using correlationId to identify browser
        // For now, we track globally since events don't have configId
        // In a full implementation, we'd track per-browser
      }
    }

    // Count total weekly invites sent (global for now)
    let totalWeeklyInvitesSent = 0;
    for (const event of events) {
      if (
        event.type === "ConnectionRequestSent" &&
        event.timestamp > oneWeekAgoIso
      ) {
        totalWeeklyInvitesSent++;
      }
    }

    const weeklyInvitesRemaining = Math.max(0, 100 - totalWeeklyInvitesSent);

    // Map account's browser bindings to LinkedInBrowser
    return account.browserBindings.map((binding) => {
      const status = browserStatus.get(binding.configId) ?? {
        authStatus: "unknown" as LinkedInAuthStatus,
        weeklyInvitesSent: 0,
      };

      return {
        configId: binding.configId,
        isRunning: runningConfigIds.has(binding.configId),
        metadata: binding.metadata,
        authStatus: status.authStatus,
        rateLimitedUntil: status.rateLimitedUntil,
        weeklyInvitesRemaining,
      };
    });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Execution
  // ─────────────────────────────────────────────────────────────────────────

  execute: (
    intent: LinkedInIntent,
    browsers: readonly LinkedInBrowser[],
    preferConfigId?: BrowserConfigId,
  ): Effect.Effect<
    { usedConfigId: BrowserConfigId },
    ExecuteError,
    BrowserPool
  > =>
    Effect.gen(function* () {
      const pool = yield* BrowserPool;

      // Select browser: prefer specified, then running+authenticated, then any running
      let selected: LinkedInBrowser | undefined;

      if (preferConfigId) {
        selected = browsers.find(
          (b) =>
            b.configId === preferConfigId &&
            b.isRunning &&
            b.authStatus === "authenticated",
        );
      }

      if (!selected) {
        selected = browsers.find(
          (b) => b.isRunning && b.authStatus === "authenticated",
        );
      }

      if (!selected) {
        selected = browsers.find((b) => b.isRunning);
      }

      if (!selected) {
        return yield* Effect.fail(
          executeError(ExecuteErrorCode("NoBrowserAvailable"), "No running browser available"),
        );
      }

      const configId = selected.configId;

      logger.info(`[LinkedIn] Executing intent: ${intent.type}`, { configId });

      // Map intent type to bridge command
      const command = (() => {
        switch (intent.type) {
          case "SendMessage":
            return { type: "linkedin:sendMessage", payload: intent };
          case "Connect":
            return { type: "linkedin:connect", payload: intent };
          case "Follow":
            return { type: "linkedin:follow", payload: intent };
          case "SyncConversations":
            return { type: "linkedin:syncConversations", payload: intent };
          case "PeopleSearch":
            return { type: "linkedin:peopleSearch", payload: intent };
          case "RecallMessage":
            return { type: "linkedin:recallMessage", payload: intent };
          case "WithdrawInvitation":
            return { type: "linkedin:withdrawInvitation", payload: intent };
          case "ViewProfile":
            return { type: "linkedin:viewProfile", payload: intent };
          case "AcceptInvitation":
            return { type: "linkedin:acceptInvitation", payload: intent };
          case "RejectInvitation":
            return { type: "linkedin:rejectInvitation", payload: intent };
          case "SearchCompanies":
            return { type: "linkedin:searchCompanies", payload: intent };
        }
      })();

      yield* pool.send(configId, command).pipe(
        Effect.mapError((err) =>
          executeError(
            ExecuteErrorCode("CommandFailed"),
            `Bridge command failed: ${err.message}`,
            err,
          )
        ),
      );

      return { usedConfigId: configId };
    }),
};
