#!/usr/bin/env -S deno run -A
// =============================================================================
// view-inbox.tsx — Platform Inbox Viewer TUI (Ink)
// =============================================================================

import React, { useState, useEffect, type FC, type ReactNode } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { ThreadId } from "@bernays/server/core";
import type { StorableEvent } from "@bernays/server/store";
import { createPostgresEventStore } from "@bernays/server/store";
import {
  createPostgresLinkedInAccountStore,
  type LinkedInAccount,
} from "../plugins/linkedin/account.ts";
import { linkedInBehavior } from "../plugins/linkedin/behavior.ts";
import type { LinkedInInbox, LinkedInIndexMeta } from "../plugins/linkedin/views.ts";
import { LINKEDIN_SCOPE } from "../plugins/linkedin/schemas.ts";
import {
  createPostgresXAccountStore,
  type XAccount,
} from "../plugins/x/account.ts";
import { xBehavior } from "../plugins/x/behavior.ts";
import type { XInbox, XIndexMeta } from "../plugins/x/views.ts";
import { X_SCOPE } from "../plugins/x/schemas.ts";
import type { MessageView } from "@bernays/server/views";
import {
  Header,
  StatusBar,
  MenuItem,
  relativeTime,
  truncate,
  renderApp,
  requireDatabaseUrl,
  runMain,
} from "./lib/ink.tsx";

// =============================================================================
// Types
// =============================================================================

type Platform = "linkedin" | "x";

interface BaseThreadSummary {
  readonly lastActivity: string;
  readonly unreadCount: number;
}

interface BaseInbox<T> {
  readonly byThreadId: Readonly<Record<string, T>>;
}

interface BaseThread {
  readonly threadId: string;
  readonly messages: readonly MessageView[];
  readonly unreadCount: number;
  readonly lastActivity: string;
}

type View =
  | { type: "platform-select" }
  | { type: "account-select"; platform: Platform }
  | { type: "inbox"; platform: Platform; accountIndex: number }
  | { type: "thread"; platform: Platform; accountIndex: number; threadId: string };

// =============================================================================
// Platform Select
// =============================================================================

const PlatformSelectView: FC<{ onSelect: (p: Platform) => void }> = (props: {
  onSelect: (p: Platform) => void;
}) => {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);
  const platforms: { id: Platform; label: string; color: string }[] = [
    { id: "linkedin", label: "LinkedIn - Professional Network", color: "cyan" },
    { id: "x", label: "X (Twitter) - Social Media", color: "magenta" },
  ];

  useInput((input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean }) => {
    if (input === "q" || key.escape) exit();
    else if (key.upArrow || input === "k") setSelected((s: number) => Math.max(0, s - 1));
    else if (key.downArrow || input === "j") setSelected((s: number) => Math.min(platforms.length - 1, s + 1));
    else if (key.return || input === " ") props.onSelect(platforms[selected].id);
    else if (input === "1") props.onSelect("linkedin");
    else if (input === "2") props.onSelect("x");
  });

  return (
    <Box flexDirection="column">
      <Header title="Inbox Viewer" />
      <Text bold>Select a Platform:</Text>
      <Box flexDirection="column" marginY={1}>
        {platforms.map((p, i) => (
          <MenuItem key={p.id} idx={i} label={p.label} selected={selected === i} color={p.color} />
        ))}
      </Box>
      <StatusBar>j/k or arrows to navigate | Enter to select | q to quit</StatusBar>
    </Box>
  );
};

// =============================================================================
// Account Select
// =============================================================================

interface AccountSelectProps {
  platform: Platform;
  accounts: readonly { id: string; displayName: string }[];
  onSelect: (index: number) => void;
  onBack: () => void;
}

const AccountSelectView: FC<AccountSelectProps> = (props: AccountSelectProps) => {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);
  const color = props.platform === "linkedin" ? "cyan" : "magenta";

  useInput((input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean }) => {
    if (input === "q") exit();
    else if (key.escape || input === "b") props.onBack();
    else if (key.upArrow || input === "k") setSelected((s: number) => Math.max(0, s - 1));
    else if (key.downArrow || input === "j") setSelected((s: number) => Math.min(props.accounts.length - 1, s + 1));
    else if (key.return || input === " ") {
      if (props.accounts.length > 0) props.onSelect(selected);
    }
  });

  const platformName = props.platform === "linkedin" ? "LinkedIn" : "X (Twitter)";

  return (
    <Box flexDirection="column">
      <Header title={`${platformName} - Select Account`} />
      {props.accounts.length === 0 ? (
        <Text color="yellow">No accounts found.</Text>
      ) : (
        <Box flexDirection="column" marginY={1}>
          {props.accounts.map((acc, i) => (
            <MenuItem
              key={acc.id}
              idx={i}
              label={`${acc.displayName} (${acc.id.slice(0, 8)}...)`}
              selected={selected === i}
              color={color}
            />
          ))}
        </Box>
      )}
      <StatusBar>j/k navigate | Enter select | b back | q quit</StatusBar>
    </Box>
  );
};

// =============================================================================
// Inbox View
// =============================================================================

interface InboxProps<TInbox extends BaseInbox<TMeta>, TMeta extends BaseThreadSummary> {
  platform: Platform;
  accountName: string;
  inbox: TInbox;
  onSelectThread: (threadId: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  renderHeader: (inbox: TInbox) => ReactNode;
  renderMeta?: (threadId: string, meta: TMeta) => ReactNode;
}

function InboxView<TInbox extends BaseInbox<TMeta>, TMeta extends BaseThreadSummary>(
  props: InboxProps<TInbox, TMeta>
): React.ReactElement {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 10;

  const threadIds = Object.keys(props.inbox.byThreadId).sort((a, b) => {
    const metaA = props.inbox.byThreadId[a];
    const metaB = props.inbox.byThreadId[b];
    return new Date(metaB.lastActivity).getTime() - new Date(metaA.lastActivity).getTime();
  });

  const totalPages = Math.ceil(threadIds.length / pageSize);
  const pageThreadIds = threadIds.slice(page * pageSize, (page + 1) * pageSize);
  const color = props.platform === "linkedin" ? "cyan" : "magenta";

  useInput((input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean }) => {
    if (input === "q") exit();
    else if (key.escape || input === "b") props.onBack();
    else if (input === "r") props.onRefresh();
    else if (key.upArrow || input === "k") setSelected((s: number) => Math.max(0, s - 1));
    else if (key.downArrow || input === "j") setSelected((s: number) => Math.min(pageThreadIds.length - 1, s + 1));
    else if (key.return || input === " ") {
      if (pageThreadIds.length > 0) props.onSelectThread(pageThreadIds[selected]);
    }
    else if (input === "n" && page < totalPages - 1) { setPage((p: number) => p + 1); setSelected(0); }
    else if (input === "p" && page > 0) { setPage((p: number) => p - 1); setSelected(0); }
  });

  return (
    <Box flexDirection="column">
      <Header title={`${props.platform === "linkedin" ? "LinkedIn" : "X"}: ${props.accountName}`} />
      {props.renderHeader(props.inbox)}
      <Box marginY={1} />
      {threadIds.length === 0 ? (
        <Text dimColor>No threads found.</Text>
      ) : (
        <>
          <Text dimColor>
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, threadIds.length)} of {threadIds.length}:
          </Text>
          <Box flexDirection="column" marginY={1}>
            {pageThreadIds.map((threadId, i) => {
              const meta = props.inbox.byThreadId[threadId] as TMeta;
              return (
                <Box key={threadId}>
                  <Text color={selected === i ? "green" : "white"}>
                    {selected === i ? "> " : "  "}
                    <Text bold>[{page * pageSize + i + 1}]</Text>{" "}
                    <Text color={color}>{truncate(threadId, 28)}</Text>{" "}
                    <Text dimColor>{relativeTime(meta.lastActivity).padEnd(10)}</Text>
                    {meta.unreadCount > 0 && <Text color="yellow"> ({meta.unreadCount})</Text>}
                    {props.renderMeta?.(threadId, meta)}
                  </Text>
                </Box>
              );
            })}
          </Box>
        </>
      )}
      <StatusBar>
        j/k nav | Enter view | n/p page | r refresh | b back | q quit
        {totalPages > 1 && ` | ${page + 1}/${totalPages}`}
      </StatusBar>
    </Box>
  );
}

// =============================================================================
// Thread View
// =============================================================================

interface ThreadProps {
  platform: Platform;
  thread: BaseThread;
  accountId: string;
  onBack: () => void;
  renderHeader: () => ReactNode;
}

const ThreadView: FC<ThreadProps> = (props: ThreadProps) => {
  const { exit } = useApp();
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const messages = [...props.thread.messages];
  const totalPages = Math.ceil(messages.length / pageSize);
  const start = Math.max(0, messages.length - (page + 1) * pageSize);
  const end = messages.length - page * pageSize;
  const pageMessages = messages.slice(start, end);
  const color = props.platform === "linkedin" ? "cyan" : "magenta";

  useInput((input: string, key: { escape: boolean }) => {
    if (input === "q") exit();
    else if (key.escape || input === "b") props.onBack();
    else if (input === "o" && page < totalPages - 1) setPage((p: number) => p + 1);
    else if (input === "n" && page > 0) setPage((p: number) => p - 1);
  });

  return (
    <Box flexDirection="column">
      <Header title={`Thread: ${truncate(props.thread.threadId, 30)}`} />
      {props.renderHeader()}
      <Box marginY={1} />
      {messages.length === 0 ? (
        <Text dimColor>No messages.</Text>
      ) : (
        <>
          <Text dimColor>Messages {start + 1}-{end} of {messages.length}:</Text>
          <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="gray" paddingX={1}>
            {pageMessages.map((msg) => {
              const isOwn = msg.senderId === props.accountId;
              return (
                <Box key={msg.id} flexDirection="column">
                  <Box>
                    <Text color={isOwn ? "green" : color} bold>
                      [{isOwn ? "You" : truncate(msg.senderId, 20)}]
                    </Text>
                    <Text dimColor> {relativeTime(msg.timestamp)}</Text>
                  </Box>
                  <Text>  {msg.content || "(no content)"}</Text>
                </Box>
              );
            })}
          </Box>
        </>
      )}
      <StatusBar>
        o older | n newer | b back | q quit
        {totalPages > 1 && ` | ${page + 1}/${totalPages}`}
      </StatusBar>
    </Box>
  );
};

// =============================================================================
// Main App
// =============================================================================

interface AppProps {
  initialPlatform?: Platform;
  linkedInAccountStore: Awaited<ReturnType<typeof createPostgresLinkedInAccountStore>>;
  xAccountStore: Awaited<ReturnType<typeof createPostgresXAccountStore>>;
  eventStore: Awaited<ReturnType<typeof createPostgresEventStore>>;
}

const App: FC<AppProps> = (props: AppProps) => {
  const [view, setView] = useState<View>(
    props.initialPlatform ? { type: "account-select", platform: props.initialPlatform } : { type: "platform-select" }
  );
  const [linkedInAccounts, setLinkedInAccounts] = useState<readonly LinkedInAccount[]>([]);
  const [xAccounts, setXAccounts] = useState<readonly XAccount[]>([]);
  const [linkedInInbox, setLinkedInInbox] = useState<LinkedInInbox | null>(null);
  const [xInbox, setXInbox] = useState<XInbox | null>(null);
  const [linkedInEvents, setLinkedInEvents] = useState<readonly StorableEvent[]>([]);
  const [xEvents, setXEvents] = useState<readonly StorableEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { Runtime } = await import("effect");
      const runtime = Runtime.defaultRuntime;
      const [li, x] = await Promise.all([
        Runtime.runPromise(runtime)(props.linkedInAccountStore.list()),
        Runtime.runPromise(runtime)(props.xAccountStore.list()),
      ]);
      setLinkedInAccounts(li);
      setXAccounts(x);
    };
    load();
  }, []);

  useEffect(() => {
    if (view.type !== "inbox" && view.type !== "thread") return;
    const loadInbox = async () => {
      setLoading(true);
      try {
        if (view.platform === "linkedin" && linkedInAccounts[view.accountIndex]) {
          const account = linkedInAccounts[view.accountIndex];
          const result = await props.eventStore.fetch({ type: "byScope", scope: LINKEDIN_SCOPE });
          if (result.ok) {
            const events = result.value.filter((e: StorableEvent) => {
              const ev = e as { accountId?: string };
              return !ev.accountId || ev.accountId === account.id;
            });
            setLinkedInEvents(events);
            setLinkedInInbox(linkedInBehavior.deriveInbox(events as never, account.id));
          }
        } else if (view.platform === "x" && xAccounts[view.accountIndex]) {
          const account = xAccounts[view.accountIndex];
          const result = await props.eventStore.fetch({ type: "byScope", scope: X_SCOPE });
          if (result.ok) {
            const events = result.value.filter((e: StorableEvent) => {
              const ev = e as { accountId?: string };
              return !ev.accountId || ev.accountId === account.id;
            });
            setXEvents(events);
            setXInbox(xBehavior.deriveInbox(events as never, account.id));
          }
        }
      } finally {
        setLoading(false);
      }
    };
    loadInbox();
  }, [view.type, view.type === "inbox" || view.type === "thread" ? view.accountIndex : -1]);

  if (loading) return <Box><Text color="cyan">Loading...</Text></Box>;

  if (view.type === "platform-select") {
    return <PlatformSelectView onSelect={(p: Platform) => setView({ type: "account-select", platform: p })} />;
  }

  if (view.type === "account-select") {
    const accounts = view.platform === "linkedin"
      ? linkedInAccounts.map((a: LinkedInAccount) => ({ id: a.id, displayName: a.displayName }))
      : xAccounts.map((a: XAccount) => ({ id: a.id, displayName: `@${a.handle}` }));
    return (
      <AccountSelectView
        platform={view.platform}
        accounts={accounts}
        onSelect={(i: number) => setView({ type: "inbox", platform: view.platform, accountIndex: i })}
        onBack={() => setView({ type: "platform-select" })}
      />
    );
  }

  if (view.type === "inbox") {
    if (view.platform === "linkedin" && linkedInInbox) {
      const account = linkedInAccounts[view.accountIndex];
      return (
        <InboxView<LinkedInInbox, LinkedInIndexMeta>
          platform="linkedin"
          accountName={account.displayName}
          inbox={linkedInInbox}
          onSelectThread={(id: string) => setView({ ...view, type: "thread", threadId: id })}
          onBack={() => setView({ type: "account-select", platform: "linkedin" })}
          onRefresh={() => setView({ ...view })}
          renderHeader={(inbox: LinkedInInbox) => (
            <Box>
              <Text>
                <Text bold>Threads:</Text> {Object.keys(inbox.byThreadId).length}
                {"  |  "}
                <Text bold>Pending:</Text> <Text color="yellow">{inbox.pendingInvitations}</Text>
                {"  |  "}
                <Text bold>Weekly:</Text> {inbox.weeklyInvitesRemaining}/100
              </Text>
            </Box>
          )}
          renderMeta={(_: string, meta: LinkedInIndexMeta) =>
            meta.isSponsored ? <Text dimColor> [Sponsored]</Text> : null
          }
        />
      );
    }
    if (view.platform === "x" && xInbox) {
      const account = xAccounts[view.accountIndex];
      return (
        <InboxView<XInbox, XIndexMeta>
          platform="x"
          accountName={`@${account.handle}`}
          inbox={xInbox}
          onSelectThread={(id: string) => setView({ ...view, type: "thread", threadId: id })}
          onBack={() => setView({ type: "account-select", platform: "x" })}
          onRefresh={() => setView({ ...view })}
          renderHeader={(inbox: XInbox) => (
            <Box>
              <Text>
                <Text bold>Conversations:</Text> {Object.keys(inbox.byThreadId).length}
                {"  |  "}
                <Text bold>Unread:</Text> <Text color="yellow">{inbox.totalUnread}</Text>
                {"  |  "}
                <Text bold>Synced:</Text> {relativeTime(inbox.syncedAt)}
              </Text>
            </Box>
          )}
          renderMeta={(_: string, meta: XIndexMeta) => <Text dimColor> {meta.participantCount}p</Text>}
        />
      );
    }
    return <Text>Loading inbox...</Text>;
  }

  if (view.type === "thread") {
    if (view.platform === "linkedin") {
      const account = linkedInAccounts[view.accountIndex];
      const thread = linkedInBehavior.deriveThread(linkedInEvents as never, view.threadId as ThreadId);
      if (!thread) return <Text color="red">Thread not found</Text>;
      return (
        <ThreadView
          platform="linkedin"
          thread={thread}
          accountId={account.id}
          onBack={() => setView({ type: "inbox", platform: "linkedin", accountIndex: view.accountIndex })}
          renderHeader={() => (
            <Text>
              <Text bold>Messages:</Text> {thread.messages.length}
              {"  |  "}
              <Text bold>Unread:</Text> <Text color="yellow">{thread.unreadCount}</Text>
            </Text>
          )}
        />
      );
    }
    if (view.platform === "x") {
      const account = xAccounts[view.accountIndex];
      const thread = xBehavior.deriveThread(xEvents as never, view.threadId as ThreadId);
      if (!thread) return <Text color="red">Thread not found</Text>;
      return (
        <ThreadView
          platform="x"
          thread={thread}
          accountId={account.id}
          onBack={() => setView({ type: "inbox", platform: "x", accountIndex: view.accountIndex })}
          renderHeader={() => (
            <Text>
              <Text bold>Messages:</Text> {thread.messages.length}
              {"  |  "}
              <Text bold>Unread:</Text> <Text color="yellow">{thread.unreadCount}</Text>
            </Text>
          )}
        />
      );
    }
  }

  return <Text>Unknown view</Text>;
};

// =============================================================================
// Main
// =============================================================================

const main = async (): Promise<void> => {
  if (Deno.args.includes("-h") || Deno.args.includes("--help")) {
    console.log(`view-inbox.tsx — Inbox Viewer\n\nUsage: just inbox [linkedin|x]`);
    return;
  }

  const databaseUrl = requireDatabaseUrl();

  let initialPlatform: Platform | undefined;
  const arg = Deno.args[0]?.toLowerCase();
  if (arg === "linkedin") initialPlatform = "linkedin";
  else if (arg === "x" || arg === "twitter") initialPlatform = "x";
  else if (arg) {
    console.error(`Unknown platform: ${arg}`);
    Deno.exit(1);
  }

  const [linkedInAccountStore, xAccountStore, eventStore] = await Promise.all([
    createPostgresLinkedInAccountStore({ connectionString: databaseUrl }),
    createPostgresXAccountStore({ connectionString: databaseUrl }),
    createPostgresEventStore({ databaseUrl }),
  ]);

  renderApp(
    <App
      initialPlatform={initialPlatform}
      linkedInAccountStore={linkedInAccountStore}
      xAccountStore={xAccountStore}
      eventStore={eventStore}
    />
  );
};

if (import.meta.main) {
  runMain(main);
}
