#!/usr/bin/env -S deno run -A
// =============================================================================
// view-inbox.tsx — Platform Inbox Viewer TUI (Ink)
// =============================================================================

import { useState, useEffect, type FC } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { AccountId, Scope, type ThreadId } from "@bernays/server/core";
import type { StorableEvent } from "@bernays/server/store";
import { createPostgresEventStore } from "@bernays/server/store";
import { createPostgresLinkedInAccountStore } from "@bernays/plugins/linkedin";
import { createPostgresXAccountStore } from "@bernays/plugins/x";
import {
  Header,
  StatusBar,
  FullHeightLayout,
  ErrorBanner,
  toAppError,
  type AppError,
  MenuItem,
  relativeTime,
  truncate,
  runApp,
  requireDatabaseUrl,
  runMain,
  useContentHeight,
  useTerminalSize,
} from "./lib/ink.tsx";
import { createBindings, useKeyHandler } from "./lib/keybindings.tsx";
import { useListNavigation, usePagination } from "./lib/hooks.tsx";
import {
  type BaseThread,
  type BaseInbox,
  type BaseThreadSummary,
  type BaseAccount,
  type AnyPlatformProvider,
  platformOptions,
  getProvider,
} from "./lib/providers.tsx";

// =============================================================================
// Types
// =============================================================================

type Platform = "linkedin" | "x";

type View =
  | { type: "platform-select" }
  | { type: "account-select"; platform: Platform }
  | { type: "inbox"; platform: Platform; accountIndex: number }
  | { type: "thread"; platform: Platform; accountIndex: number; threadId: string };

// =============================================================================
// Platform Select
// =============================================================================

const platforms = platformOptions.map((p) => ({
  id: p.key as Platform,
  label: p.name,
  color: p.color,
}));

const PlatformSelectView: FC<{ onSelect: (p: Platform) => void }> = ({ onSelect }) => {
  const { exit } = useApp();
  const nav = useListNavigation(platforms);

  const bindings = createBindings({
    navigation: true,
    onUp: nav.up,
    onDown: nav.down,
    onSelect: () => onSelect(platforms[nav.selectedIndex].id),
    onQuit: exit,
  });

  // Number key shortcuts
  useInput((input: string) => {
    const num = parseInt(input, 10);
    if (num >= 1 && num <= platforms.length) {
      onSelect(platforms[num - 1].id);
    }
  });

  useKeyHandler(bindings, [nav.selectedIndex]);

  return (
    <FullHeightLayout
      header={<Header title="Inbox Viewer" />}
      statusBar={<StatusBar>{bindings.hints}</StatusBar>}
    >
      <Text bold>Select a Platform:</Text>
      <Box flexDirection="column" marginY={1}>
        {platforms.map((p, i) => (
          <MenuItem key={p.id} idx={i} label={p.label} selected={nav.selectedIndex === i} color={p.color} />
        ))}
      </Box>
    </FullHeightLayout>
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

const AccountSelectView: FC<AccountSelectProps> = ({ platform, accounts, onSelect, onBack }) => {
  const { exit } = useApp();
  const nav = useListNavigation(accounts);
  const provider = getProvider(platform);
  const color = provider?.color ?? "white";
  const platformName = provider?.name ?? platform;

  const bindings = createBindings({
    navigation: true,
    onUp: nav.up,
    onDown: nav.down,
    onSelect: () => { if (accounts.length > 0) onSelect(nav.selectedIndex); },
    onBack,
    onQuit: exit,
  });

  useKeyHandler(bindings, [nav.selectedIndex]);

  return (
    <FullHeightLayout
      header={<Header title={`${platformName} - Select Account`} />}
      statusBar={<StatusBar>{bindings.hints}</StatusBar>}
    >
      {accounts.length === 0 ? (
        <Text color="yellow">No accounts found.</Text>
      ) : (
        <Box flexDirection="column" marginY={1}>
          {accounts.map((acc, i) => (
            <MenuItem
              key={acc.id}
              idx={i}
              label={`${acc.displayName} (${acc.id.slice(0, 8)}...)`}
              selected={nav.selectedIndex === i}
              color={color}
            />
          ))}
        </Box>
      )}
    </FullHeightLayout>
  );
};

// =============================================================================
// Inbox View
// =============================================================================

interface InboxViewProps {
  provider: AnyPlatformProvider;
  accountName: string;
  inbox: BaseInbox<BaseThreadSummary>;
  onSelectThread: (threadId: string) => void;
  onBack: () => void;
  onRefresh: () => void;
}

const InboxView: FC<InboxViewProps> = ({
  provider,
  accountName,
  inbox,
  onSelectThread,
  onBack,
  onRefresh,
}) => {
  const { exit } = useApp();
  const { columns } = useTerminalSize();

  // Dynamic page size: Chrome: Header (3) + header render (1) + margin (1) + showing line (1) + margin (2) + status bar (3) = 11 lines
  const availableHeight = useContentHeight(11);
  const pageSize = Math.max(5, availableHeight);

  // Sort threads by last activity
  const threadIds = Object.keys(inbox.byThreadId).sort((a, b) => {
    const metaA = inbox.byThreadId[a];
    const metaB = inbox.byThreadId[b];
    return new Date(metaB.lastActivity).getTime() - new Date(metaA.lastActivity).getTime();
  });

  // Pagination and navigation
  const pagination = usePagination(threadIds, pageSize);
  const nav = useListNavigation(pagination.pageItems);

  const bindings = createBindings({
    navigation: true,
    pagination: pagination.totalPages > 1,
    onUp: nav.up,
    onDown: nav.down,
    onPageUp: () => { pagination.prevPage(); nav.reset(); },
    onPageDown: () => { pagination.nextPage(); nav.reset(); },
    onSelect: () => { if (pagination.pageItems.length > 0) onSelectThread(pagination.pageItems[nav.selectedIndex]); },
    onBack,
    onRefresh,
    onQuit: exit,
  });

  useKeyHandler(bindings, [nav.selectedIndex, pagination.page]);

  // Calculate proportional column widths
  // Fixed columns: prefix (7), time (12), unread (6), meta (12) = 37 chars
  const availableWidth = Math.max(30, columns - 37);
  const threadIdWidth = Math.max(20, Math.min(50, availableWidth));

  const statusHints = bindings.hints + (pagination.totalPages > 1 ? ` | ${pagination.page + 1}/${pagination.totalPages}` : "");

  return (
    <FullHeightLayout
      header={<Header title={`${provider.name}: ${accountName}`} />}
      statusBar={<StatusBar>{statusHints}</StatusBar>}
    >
      {provider.renderInboxHeader(inbox)}
      <Box marginY={1} />
      {threadIds.length === 0 ? (
        <Text dimColor>No threads found.</Text>
      ) : (
        <>
          <Text dimColor>
            Showing {pagination.pageStartIndex + 1}-{Math.min(pagination.pageStartIndex + pageSize, threadIds.length)} of {threadIds.length}:
          </Text>
          <Box flexDirection="column" marginY={1}>
            {pagination.pageItems.map((threadId, i) => {
              const meta = inbox.byThreadId[threadId];
              return (
                <Box key={threadId}>
                  <Text color={nav.selectedIndex === i ? "green" : "white"}>
                    {nav.selectedIndex === i ? "> " : "  "}
                    <Text bold>[{String(pagination.pageStartIndex + i + 1).padStart(2)}]</Text>{" "}
                    <Text color={provider.color}>{truncate(threadId, threadIdWidth).padEnd(threadIdWidth)}</Text>{" "}
                    <Text dimColor>{relativeTime(meta.lastActivity).padEnd(10)}</Text>
                    {meta.unreadCount > 0 && <Text color="yellow"> ({meta.unreadCount})</Text>}
                    {provider.renderThreadMeta?.(threadId, meta)}
                  </Text>
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </FullHeightLayout>
  );
}

// =============================================================================
// Thread View
// =============================================================================

interface ThreadViewProps {
  provider: AnyPlatformProvider;
  thread: BaseThread;
  accountId: string;
  onBack: () => void;
}

const ThreadView: FC<ThreadViewProps> = ({ provider, thread, accountId, onBack }) => {
  const { exit } = useApp();
  const [page, setPage] = useState(0);

  // Dynamic page size: Chrome: Header (3) + header render (1) + margin (1) + messages line (1) + border (2) + margin (1) + status bar (3) = 12 lines
  // Each message takes ~3 lines (sender line + content line + gap)
  const availableHeight = useContentHeight(12);
  const pageSize = Math.max(3, Math.floor(availableHeight / 3));

  const messages = [...thread.messages];
  const totalPages = Math.ceil(messages.length / pageSize);
  const start = Math.max(0, messages.length - (page + 1) * pageSize);
  const end = messages.length - page * pageSize;
  const pageMessages = messages.slice(start, end);

  const bindings = createBindings({
    onBack,
    onQuit: exit,
    custom: [
      { key: "o", label: "older", handler: () => { if (page < totalPages - 1) setPage((p) => p + 1); }, enabled: page < totalPages - 1 },
      { key: "n", label: "newer", handler: () => { if (page > 0) setPage((p) => p - 1); }, enabled: page > 0 },
    ],
  });

  useKeyHandler(bindings, [page, totalPages]);

  const statusHints = bindings.hints + (totalPages > 1 ? ` | ${page + 1}/${totalPages}` : "");

  return (
    <FullHeightLayout
      header={<Header title={`Thread: ${truncate(thread.threadId, 30)}`} />}
      statusBar={<StatusBar>{statusHints}</StatusBar>}
    >
      {provider.renderThreadHeader(thread)}
      <Box marginY={1} />
      {messages.length === 0 ? (
        <Text dimColor>No messages.</Text>
      ) : (
        <>
          <Text dimColor>Messages {start + 1}-{end} of {messages.length}:</Text>
          <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="gray" paddingX={1}>
            {pageMessages.map((msg) => {
              const isOwn = msg.senderId === accountId;
              return (
                <Box key={msg.id} flexDirection="column">
                  <Box>
                    <Text color={isOwn ? "green" : provider.color} bold>
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
    </FullHeightLayout>
  );
};

// =============================================================================
// Main App
// =============================================================================

// Account stores keyed by platform
interface AccountStores {
  linkedin: Awaited<ReturnType<typeof createPostgresLinkedInAccountStore>>;
  x: Awaited<ReturnType<typeof createPostgresXAccountStore>>;
}

interface AppProps {
  initialPlatform?: Platform;
  accountStores: AccountStores;
  eventStore: Awaited<ReturnType<typeof createPostgresEventStore>>;
}

// Platform-specific state stored generically
interface PlatformState {
  accounts: readonly BaseAccount[];
  inbox: BaseInbox<BaseThreadSummary> | null;
  events: readonly StorableEvent[];
}

const App: FC<AppProps> = ({ initialPlatform, accountStores, eventStore }) => {
  const [view, setView] = useState<View>(
    initialPlatform ? { type: "account-select", platform: initialPlatform } : { type: "platform-select" }
  );
  // Platform state indexed by platform key
  const [platformState, setPlatformState] = useState<Record<Platform, PlatformState>>({
    linkedin: { accounts: [], inbox: null, events: [] },
    x: { accounts: [], inbox: null, events: [] },
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Load all accounts on mount
  useEffect(() => {
    const load = async () => {
      setAccountsLoading(true);
      setError(null);
      try {
        const { Runtime } = await import("effect");
        const runtime = Runtime.defaultRuntime;
        const [linkedInAccounts, xAccounts] = await Promise.all([
          Runtime.runPromise(runtime)(accountStores.linkedin.list()),
          Runtime.runPromise(runtime)(accountStores.x.list()),
        ]);
        setPlatformState((prev) => ({
          linkedin: { ...prev.linkedin, accounts: linkedInAccounts },
          x: { ...prev.x, accounts: xAccounts },
        }));
      } catch (e) {
        setError(toAppError(e, "Failed to Load Accounts"));
      } finally {
        setAccountsLoading(false);
      }
    };
    load();
  }, []);

  // Load inbox for current platform and account
  const loadInbox = async () => {
    if (view.type !== "inbox" && view.type !== "thread") return;

    const provider = getProvider(view.platform);
    if (!provider) return;

    const state = platformState[view.platform];
    const account = state.accounts[view.accountIndex];
    if (!account) return;

    setLoading(true);
    setError(null);
    try {
      const result = await eventStore.fetch({ type: "byScope", scope: Scope(provider.scope) });
      if (result.ok) {
        const events = result.value.filter((e: StorableEvent) => {
          const ev = e as { accountId?: string };
          return !ev.accountId || ev.accountId === account.id;
        });
        const inbox = provider.deriveInbox(events, AccountId(account.id));
        setPlatformState((prev) => ({
          ...prev,
          [view.platform]: { ...prev[view.platform], events, inbox },
        }));
      } else {
        setError(toAppError(result.error, "Failed to Load Events"));
      }
    } catch (e) {
      setError(toAppError(e, "Failed to Load Inbox"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInbox();
  }, [view.type, view.type === "inbox" || view.type === "thread" ? view.accountIndex : -1, view.type === "inbox" || view.type === "thread" ? view.platform : ""]);

  // Helper to get accounts for display
  const getAccountsForDisplay = (platform: Platform) => {
    const provider = getProvider(platform);
    const state = platformState[platform];
    if (!provider || !state) return [];
    return state.accounts.map((a) => ({
      id: a.id,
      displayName: provider.formatAccountName(a),
    }));
  };

  // Show loading state for accounts
  if (accountsLoading) {
    return (
      <FullHeightLayout
        header={<Header title="Inbox Viewer" />}
        statusBar={<StatusBar>Loading accounts...</StatusBar>}
      >
        <Text color="cyan">Loading accounts...</Text>
      </FullHeightLayout>
    );
  }

  // Show error with option to retry
  if (error && (view.type === "platform-select" || view.type === "account-select")) {
    return (
      <FullHeightLayout
        header={<Header title="Inbox Viewer" />}
        statusBar={<StatusBar>Press any key to dismiss | q quit</StatusBar>}
      >
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
      </FullHeightLayout>
    );
  }

  if (loading) return <Box><Text color="cyan">Loading...</Text></Box>;

  if (view.type === "platform-select") {
    return <PlatformSelectView onSelect={(p: Platform) => setView({ type: "account-select", platform: p })} />;
  }

  if (view.type === "account-select") {
    return (
      <AccountSelectView
        platform={view.platform}
        accounts={getAccountsForDisplay(view.platform)}
        onSelect={(i: number) => setView({ type: "inbox", platform: view.platform, accountIndex: i })}
        onBack={() => setView({ type: "platform-select" })}
      />
    );
  }

  if (view.type === "inbox") {
    const provider = getProvider(view.platform);
    const state = platformState[view.platform];
    const account = state?.accounts[view.accountIndex];

    // Show error if there is one
    if (error) {
      return (
        <FullHeightLayout
          header={<Header title={`${provider?.name ?? view.platform} Inbox`} />}
          statusBar={<StatusBar>r retry | b back | q quit</StatusBar>}
        >
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        </FullHeightLayout>
      );
    }

    if (provider && state?.inbox && account) {
      return (
        <InboxView
          provider={provider}
          accountName={provider.formatAccountName(account)}
          inbox={state.inbox}
          onSelectThread={(id: string) => setView({ ...view, type: "thread", threadId: id })}
          onBack={() => setView({ type: "account-select", platform: view.platform })}
          onRefresh={() => loadInbox()}
        />
      );
    }
    return <Text>Loading inbox...</Text>;
  }

  if (view.type === "thread") {
    const provider = getProvider(view.platform);
    const state = platformState[view.platform];
    const account = state?.accounts[view.accountIndex];

    if (provider && state && account) {
      const thread = provider.deriveThread(state.events, view.threadId as ThreadId);
      if (!thread) return <Text color="red">Thread not found</Text>;
      return (
        <ThreadView
          provider={provider}
          thread={thread}
          accountId={account.id}
          onBack={() => setView({ type: "inbox", platform: view.platform, accountIndex: view.accountIndex })}
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

  await runApp(
    <App
      initialPlatform={initialPlatform}
      accountStores={{ linkedin: linkedInAccountStore, x: xAccountStore }}
      eventStore={eventStore}
    />
  );
};

if (import.meta.main) {
  runMain(main);
}
