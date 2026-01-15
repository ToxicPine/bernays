// =============================================================================
// Providers — Platform provider pattern for extensible TUI views
// =============================================================================

import React, { type ReactNode } from "react";
import { Box, Text } from "ink";
import { type ParticipantId, type ThreadId } from "@bernays/server/core";
import type { StorableEvent } from "@bernays/server/store";
import type { MessageView } from "@bernays/server/views";
import { relativeTime } from "../tui/ink.tsx";

// =============================================================================
// Base Types for TUI
// =============================================================================

/**
 * Base account shape that all platform accounts must satisfy.
 */
export interface BaseAccount {
  readonly id: string;
}

/**
 * Base thread summary metadata for inbox display.
 */
export interface BaseThreadSummary {
  readonly lastActivity: string;
  readonly unreadCount: number;
}

/**
 * Base inbox shape with thread summaries.
 */
export interface BaseInbox<
  TMeta extends BaseThreadSummary = BaseThreadSummary,
> {
  readonly byThreadId: Readonly<Record<string, TMeta>>;
}

/**
 * Base thread shape with messages for TUI display.
 * Extends the server's BaseThreadView with TUI-specific fields.
 */
export interface BaseThread {
  readonly threadId: string;
  readonly messages: readonly MessageView[];
  readonly unreadCount: number;
  readonly lastActivity: string;
}

// =============================================================================
// Platform Provider Interface
// =============================================================================

/**
 * Platform provider interface for extensible platform support.
 * Each platform implements this interface to plug into the inbox viewer.
 */
export interface PlatformProvider<
  TAccount extends BaseAccount,
  TInbox extends BaseInbox<TMeta>,
  TMeta extends BaseThreadSummary,
  TThread extends BaseThread,
> {
  /** Unique platform key */
  readonly key: string;

  /** Display name for the platform */
  readonly name: string;

  /** Color for the platform's UI elements */
  readonly color: string;

  /** Event scope for filtering */
  readonly scope: string;

  /** Format account for display */
  formatAccountName: (account: TAccount) => string;

  /** Derive inbox from events */
  deriveInbox: (
    events: readonly StorableEvent[],
    participantId: ParticipantId,
  ) => TInbox;

  /** Derive thread from events */
  deriveThread: (
    events: readonly StorableEvent[],
    threadId: ThreadId,
  ) => TThread | undefined;

  /** Render inbox header with stats */
  renderInboxHeader: (inbox: TInbox) => ReactNode;

  /** Render thread-specific metadata (optional) */
  renderThreadMeta?: (threadId: string, meta: TMeta) => ReactNode;

  /** Render thread header with stats */
  renderThreadHeader: (thread: TThread) => ReactNode;
}

// =============================================================================
// Provider Registry
// =============================================================================

/**
 * Type alias for a platform provider with base types.
 * Used when working with providers polymorphically at runtime.
 */
export type AnyPlatformProvider = PlatformProvider<
  BaseAccount,
  BaseInbox<BaseThreadSummary>,
  BaseThreadSummary,
  BaseThread
>;

/**
 * Type-safe provider registry.
 * Maps platform keys to their providers.
 */
export type ProviderRegistry = Record<string, AnyPlatformProvider>;

/**
 * Create a provider registry from an array of providers.
 */
export const createProviderRegistry = <T extends ProviderRegistry>(
  providers: AnyPlatformProvider[],
): T => {
  const registry: Record<string, AnyPlatformProvider> = {};
  for (const provider of providers) {
    registry[provider.key] = provider;
  }
  return registry as T;
};

// =============================================================================
// Common Rendering Helpers
// =============================================================================

/**
 * Standard inbox header with thread count, unread, and custom metric.
 */
export const InboxHeaderStats: React.FC<{
  threadCount: number;
  unreadCount?: number;
  extraLabel?: string;
  extraValue?: string | number;
  extraLabel2?: string;
  extraValue2?: string | number;
}> = (
  {
    threadCount,
    unreadCount,
    extraLabel,
    extraValue,
    extraLabel2,
    extraValue2,
  },
) => (
  <Box>
    <Text>
      <Text bold>Threads:</Text> {threadCount}
      {unreadCount !== undefined && (
        <>
          {"  |  "}
          <Text bold>Unread:</Text> <Text color="yellow">{unreadCount}</Text>
        </>
      )}
      {extraLabel && extraValue !== undefined && (
        <>
          {"  |  "}
          <Text bold>{extraLabel}:</Text> {extraValue}
        </>
      )}
      {extraLabel2 && extraValue2 !== undefined && (
        <>
          {"  |  "}
          <Text bold>{extraLabel2}:</Text> {extraValue2}
        </>
      )}
    </Text>
  </Box>
);

/**
 * Standard thread header with message count and unread.
 */
export const ThreadHeaderStats: React.FC<{
  messageCount: number;
  unreadCount: number;
}> = ({ messageCount, unreadCount }) => (
  <Text>
    <Text bold>Messages:</Text> {messageCount}
    {"  |  "}
    <Text bold>Unread:</Text> <Text color="yellow">{unreadCount}</Text>
  </Text>
);

// =============================================================================
// LinkedIn Provider
// =============================================================================

import {
  LINKEDIN_SCOPE,
  type LinkedInEvent,
} from "../../../plugins/linkedin/schemas.ts";
import { linkedInBehavior } from "../../../plugins/linkedin/behavior.ts";
import type {
  LinkedInInbox,
  LinkedInIndexMeta,
  LinkedInThread,
} from "../../../plugins/linkedin/views.ts";
import type { LinkedInAccount } from "../../../plugins/linkedin/account.ts";

export const linkedInProvider: PlatformProvider<
  LinkedInAccount,
  LinkedInInbox,
  LinkedInIndexMeta,
  LinkedInThread
> = {
  key: "linkedin",
  name: "LinkedIn",
  color: "cyan",
  scope: LINKEDIN_SCOPE,

  formatAccountName: (account) => account.id,

  deriveInbox: (events, accountId) =>
    linkedInBehavior.deriveInbox(
      events as readonly LinkedInEvent[],
      accountId as ParticipantId<"linkedin">,
    ),

  deriveThread: (events, threadId) =>
    linkedInBehavior.deriveThread(events as readonly LinkedInEvent[], threadId),

  renderInboxHeader: (inbox) => (
    <InboxHeaderStats
      threadCount={Object.keys(inbox.byThreadId).length}
      extraLabel="Pending"
      extraValue={inbox.pendingInvitations}
      extraLabel2="Weekly"
      extraValue2={`${inbox.weeklyInvitesRemaining}/100`}
    />
  ),

  renderThreadMeta: (_, meta) =>
    meta.isSponsored ? <Text dimColor>[Sponsored]</Text> : null,

  renderThreadHeader: (thread) => (
    <ThreadHeaderStats
      messageCount={thread.messages.length}
      unreadCount={thread.unreadCount}
    />
  ),
};

// =============================================================================
// X Provider
// =============================================================================

import { X_SCOPE, type XEvent } from "../../../plugins/x/schemas.ts";
import { xBehavior } from "../../../plugins/x/behavior.ts";
import type { XInbox, XIndexMeta, XThread } from "../../../plugins/x/views.ts";
import type { XAccount } from "../../../plugins/x/account.ts";

export const xProvider: PlatformProvider<
  XAccount,
  XInbox,
  XIndexMeta,
  XThread
> = {
  key: "x",
  name: "X (Twitter)",
  color: "magenta",
  scope: X_SCOPE,

  formatAccountName: (account) => account.id,

  deriveInbox: (events, accountId) =>
    xBehavior.deriveInbox(
      events as readonly XEvent[],
      accountId as ParticipantId<"x">,
    ),

  deriveThread: (events, threadId) =>
    xBehavior.deriveThread(events as readonly XEvent[], threadId),

  renderInboxHeader: (inbox) => (
    <InboxHeaderStats
      threadCount={Object.keys(inbox.byThreadId).length}
      unreadCount={inbox.totalUnread}
      extraLabel="Synced"
      extraValue={relativeTime(inbox.syncedAt)}
    />
  ),

  renderThreadMeta: (_, meta) => <Text dimColor>{meta.participantCount}p</Text>,

  renderThreadHeader: (thread) => (
    <ThreadHeaderStats
      messageCount={thread.messages.length}
      unreadCount={thread.unreadCount}
    />
  ),
};

// =============================================================================
// Default Registry
// =============================================================================

/**
 * All available platform providers.
 */
export const platformProviders = [linkedInProvider, xProvider] as const;

/**
 * Platform keys.
 */
export type PlatformKey = (typeof platformProviders)[number]["key"];

/**
 * Get provider by key.
 * Returns undefined if the key doesn't match any provider.
 */
export const getProvider = (key: string): AnyPlatformProvider | undefined =>
  platformProviders.find((p) => p.key === key) as
    | AnyPlatformProvider
    | undefined;

/**
 * Platform selector options for UI.
 */
export const platformOptions = platformProviders.map((p) => ({
  key: p.key,
  name: p.name,
  color: p.color,
}));
