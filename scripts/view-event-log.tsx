#!/usr/bin/env -S deno run -A
// =============================================================================
// view-event-log.tsx — Event Log Viewer TUI (Ink)
// =============================================================================

import { useState, useEffect, type FC } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import { parseArgs } from "@std/cli";
import { stringify } from "@std/csv";
import {
  createPostgresEventStore,
  type EventStore,
  type EventStoreQuery,
  type StorableEvent,
} from "@bernays/server/store";
import {
  Header,
  StatusBar,
  FullHeightLayout,
  ErrorBanner,
  toAppError,
  type AppError,
  relativeTime,
  formatTimestamp,
  truncate,
  scopeColor,
  runApp,
  requireDatabaseUrl,
  runMain,
  useContentHeight,
  useTerminalSize,
} from "./lib/ink.tsx";
import {
  createBindings,
  useKeyHandler,
  type KeyBinding,
} from "./lib/keybindings.tsx";
import { useListNavigation } from "./lib/hooks.tsx";
import {
  byScope,
  byType,
  sortByTimestampDesc,
  and,
} from "./lib/filters.ts";

// =============================================================================
// Types
// =============================================================================

interface QueryState {
  scope?: string;
  type?: string;
  since?: string;
  correlationId?: string;
  limit: number;
  offset: number;
}

type View =
  | { type: "list" }
  | { type: "detail"; event: StorableEvent }
  | { type: "filter"; field: "scope" | "type" | "since" | "correlation" }
  | { type: "export" };

// =============================================================================
// Helpers
// =============================================================================

const getString = (obj: unknown, key: string): string | undefined => {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
};

// =============================================================================
// Query Logic
// =============================================================================

const buildQuery = (state: QueryState): EventStoreQuery => {
  if (state.correlationId) return { type: "byCorrelation", correlationId: state.correlationId };
  if (state.since) return { type: "since", timestamp: state.since };
  return { type: "all" };
};

const buildFilters = (state: QueryState): ((e: StorableEvent) => boolean)[] => {
  const filters: ((e: StorableEvent) => boolean)[] = [];
  if (state.scope) filters.push(byScope(state.scope));
  if (state.type) filters.push(byType(state.type));
  return filters;
};

const fetchEvents = async (store: EventStore, state: QueryState): Promise<StorableEvent[]> => {
  const res = await store.fetch(buildQuery(state));
  if (!res.ok) throw new Error(`Query failed: ${res.error.message}`);
  const filters = buildFilters(state);
  const filtered = filters.length > 0
    ? [...res.value].filter(and(...filters))
    : [...res.value];
  return sortByTimestampDesc(filtered);
};

// =============================================================================
// Filter Input Modal
// =============================================================================

interface FilterInputProps {
  field: "scope" | "type" | "since" | "correlation";
  currentValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const FilterInput: FC<FilterInputProps> = (props: FilterInputProps) => {
  const [value, setValue] = useState(props.currentValue || "");

  useInput((_input: string, key: { escape: boolean }) => {
    if (key.escape) props.onCancel();
  });

  const labels: Record<string, string> = {
    scope: "Filter by scope",
    type: "Filter by type substring",
    since: "Since timestamp (YYYY-MM-DD)",
    correlation: "Correlation ID",
  };

  return (
    <FullHeightLayout
      header={<Header title="Set Filter" />}
      statusBar={<StatusBar>Enter to confirm | Escape to cancel</StatusBar>}
    >
      <Box>
        <Text bold>{labels[props.field]}: </Text>
        <TextInput
          value={value}
          onChange={(v: string) => setValue(v)}
          onSubmit={(v: string) => props.onSubmit(v)}
        />
      </Box>
    </FullHeightLayout>
  );
};

// =============================================================================
// Event Detail View
// =============================================================================

interface DetailViewProps {
  event: StorableEvent;
  onBack: () => void;
}

const DetailView: FC<DetailViewProps> = (props: DetailViewProps) => {
  const { exit } = useApp();
  const [scrollOffset, setScrollOffset] = useState(0);
  const e = props.event;
  const payload = JSON.stringify(e, null, 2).split("\n");

  // Dynamic visible lines: Chrome: Header (3) + metadata lines (5) + payload header (1) + margins (3) + status bar (3) = 15 lines
  const payloadHeight = useContentHeight(15);
  const visibleLines = Math.max(5, payloadHeight);
  const maxScroll = Math.max(0, payload.length - visibleLines);

  const bindings = createBindings({
    navigation: true,
    onUp: () => setScrollOffset((o) => Math.max(0, o - 1)),
    onDown: () => setScrollOffset((o) => Math.min(maxScroll, o + 1)),
    onBack: props.onBack,
    onQuit: exit,
  });

  useKeyHandler(bindings, [maxScroll]);

  const visiblePayload = payload.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <FullHeightLayout
      header={<Header title="Event Detail" />}
      statusBar={<StatusBar>{bindings.hints}</StatusBar>}
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text><Text bold>Event ID:</Text> <Text color="cyan">{e.eventId}</Text></Text>
        <Text><Text bold>Scope:</Text> <Text color={scopeColor(e.scope)}>{e.scope}</Text></Text>
        <Text><Text bold>Type:</Text> {e.type}</Text>
        <Text><Text bold>Timestamp:</Text> {formatTimestamp(e.timestamp)}</Text>
        {getString(e, "correlationId") && (
          <Text><Text bold>Correlation:</Text> {getString(e, "correlationId")}</Text>
        )}
      </Box>
      <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
        <Text bold dimColor>Payload:</Text>
        {visiblePayload.map((line, i) => (
          <Text key={i} dimColor>{line}</Text>
        ))}
        {payload.length > visibleLines && (
          <Text dimColor>... ({payload.length - visibleLines} more lines, j/k to scroll)</Text>
        )}
      </Box>
    </FullHeightLayout>
  );
};

// =============================================================================
// Export View
// =============================================================================

interface ExportViewProps {
  events: StorableEvent[];
  onBack: () => void;
}

const ExportView: FC<ExportViewProps> = (props: ExportViewProps) => {
  const { exit } = useApp();
  const [format, setFormat] = useState<"csv" | "json" | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [exporting, setExporting] = useState(false);

  const canSelectFormat = !format && !exporting && !error;

  const bindings = createBindings({
    onBack: props.onBack,
    onQuit: exit,
    custom: [
      { key: "c", label: "CSV", handler: () => setFormat("csv"), enabled: canSelectFormat },
      { key: "j", label: "JSON", handler: () => setFormat("json"), enabled: canSelectFormat },
    ],
  });

  // Error dismissal
  useInput((_input: string, key: { escape: boolean }) => {
    if (error) {
      setError(null);
      setFormat(null);
    } else if (key.escape) {
      props.onBack();
    }
  });

  useKeyHandler(bindings, [format, exporting, error]);

  useEffect(() => {
    if (!format || exporting) return;
    const doExport = async () => {
      setExporting(true);
      setError(null);
      try {
        const output = format === "json"
          ? JSON.stringify(props.events, null, 2)
          : stringify(
              props.events.map((e) => ({
                timestamp: e.timestamp,
                scope: e.scope,
                type: e.type,
                eventId: e.eventId,
                correlationId: getString(e, "correlationId") ?? "",
                payload: JSON.stringify(e),
              })),
              { columns: ["timestamp", "scope", "type", "eventId", "correlationId", "payload"], headers: true }
            );
        const filename = `events-${Date.now()}.${format}`;
        await Deno.writeTextFile(filename, output);
        setExported(filename);
      } catch (e) {
        setError(toAppError(e, "Export Failed"));
      } finally {
        setExporting(false);
      }
    };
    doExport();
  }, [format]);

  return (
    <FullHeightLayout
      header={<Header title="Export Events" />}
      statusBar={<StatusBar>{bindings.hints}</StatusBar>}
    >
      {error && <ErrorBanner error={error} onDismiss={() => { setError(null); setFormat(null); }} />}
      {!format && !error ? (
        <>
          <Text>Select export format:</Text>
          <Box marginY={1} flexDirection="column">
            <Text><Text bold color="green">[c]</Text> CSV</Text>
            <Text><Text bold color="green">[j]</Text> JSON</Text>
          </Box>
        </>
      ) : exported ? (
        <Text color="green">Exported {props.events.length} events to {exported}</Text>
      ) : exporting ? (
        <Text color="cyan">Exporting...</Text>
      ) : null}
    </FullHeightLayout>
  );
};

// =============================================================================
// Main List View
// =============================================================================

interface ListViewProps {
  store: EventStore;
  state: QueryState;
  onUpdateState: (updates: Partial<QueryState>) => void;
  onViewEvent: (event: StorableEvent) => void;
  onFilter: (field: "scope" | "type" | "since" | "correlation") => void;
  onExport: () => void;
}

const ListView: FC<ListViewProps> = (props: ListViewProps) => {
  const { exit } = useApp();
  const [events, setEvents] = useState<StorableEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const { columns } = useTerminalSize();

  // Dynamic page size based on terminal height
  // Chrome: Header (3) + filters line (1) + showing line (1) + margins (2) + status bar (3) + error banner (4) = 14 lines
  const availableHeight = useContentHeight(error ? 14 : 10);
  const pageSize = Math.max(5, availableHeight);
  const page = Math.floor(props.state.offset / pageSize);
  const totalPages = Math.ceil(total / pageSize);

  const loadEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchEvents(props.store, { ...props.state, offset: 0, limit: 10000 });
      setTotal(all.length);
      setEvents(all.slice(props.state.offset, props.state.offset + pageSize));
    } catch (e) {
      setError(toAppError(e, "Failed to Load Events"));
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [props.state, pageSize]);

  // Navigation within current page
  const nav = useListNavigation(events);

  // Filter action bindings
  const filterBindings: KeyBinding[] = [
    { key: "f", label: "scope", handler: () => props.onFilter("scope") },
    { key: "t", label: "type", handler: () => props.onFilter("type") },
    { key: "s", label: "since", handler: () => props.onFilter("since") },
    { key: "c", label: "corr", handler: () => props.onFilter("correlation") },
    { key: "R", label: "reset", handler: () => props.onUpdateState({ scope: undefined, type: undefined, since: undefined, correlationId: undefined, offset: 0 }) },
    { key: "e", label: "export", handler: () => props.onExport() },
    ...(error ? [{ key: "r", label: "retry", handler: loadEvents }] : []),
  ];

  const bindings = createBindings({
    navigation: true,
    pagination: totalPages > 1,
    onUp: nav.up,
    onDown: nav.down,
    onPageUp: () => { props.onUpdateState({ offset: Math.max(0, props.state.offset - pageSize) }); nav.reset(); },
    onPageDown: () => { if (props.state.offset + pageSize < total) { props.onUpdateState({ offset: props.state.offset + pageSize }); nav.reset(); } },
    onSelect: () => { if (events[nav.selectedIndex]) props.onViewEvent(events[nav.selectedIndex]); },
    onQuit: exit,
    custom: filterBindings,
  });

  // Error dismissal
  useInput((_input: string, _key: { escape: boolean }) => {
    if (error && error.recoverable) {
      setError(null);
    }
  });

  useKeyHandler(bindings, [nav.selectedIndex, props.state.offset, total, error]);

  const filters: string[] = [];
  if (props.state.scope) filters.push(`scope=${props.state.scope}`);
  if (props.state.type) filters.push(`type=${props.state.type}`);
  if (props.state.since) filters.push(`since=${props.state.since}`);
  if (props.state.correlationId) filters.push(`corr=${props.state.correlationId.slice(0, 8)}...`);

  // Calculate proportional column widths
  // Fixed columns: prefix (7), scope (12), time (12), eventId (10) = 41 chars
  const availableWidth = Math.max(40, columns - 41);
  const typeWidth = Math.max(15, Math.min(40, availableWidth));

  const statusHints = bindings.hints + (totalPages > 1 ? ` | ${page + 1}/${totalPages}` : "");

  return (
    <FullHeightLayout
      header={<Header title="Event Log Viewer" />}
      statusBar={<StatusBar>{statusHints}</StatusBar>}
    >
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      <Box marginBottom={1}>
        <Text bold>Filters: </Text>
        {filters.length > 0 ? (
          filters.map((f, i) => <Text key={i} color="cyan">{f} </Text>)
        ) : (
          <Text dimColor>(none)</Text>
        )}
      </Box>

      {loading ? (
        <Text color="cyan">Loading...</Text>
      ) : events.length === 0 && !error ? (
        <Text dimColor>No events found.</Text>
      ) : events.length > 0 ? (
        <>
          <Text dimColor>
            Showing {props.state.offset + 1}-{props.state.offset + events.length} of {total}:
          </Text>
          <Box flexDirection="column" marginY={1}>
            {events.map((e, i) => (
              <Box key={e.eventId}>
                <Text color={nav.selectedIndex === i ? "green" : "white"}>
                  {nav.selectedIndex === i ? "> " : "  "}
                  <Text bold>[{(props.state.offset + i + 1).toString().padStart(2)}]</Text>{" "}
                  <Text color={scopeColor(e.scope)}>{e.scope.padEnd(10)}</Text>{" "}
                  {truncate(e.type, typeWidth).padEnd(typeWidth)}{" "}
                  <Text dimColor>{relativeTime(e.timestamp).padEnd(10)}</Text>{" "}
                  <Text dimColor>{e.eventId.slice(0, 8)}</Text>
                </Text>
              </Box>
            ))}
          </Box>
        </>
      ) : null}
    </FullHeightLayout>
  );
};

// =============================================================================
// Main App
// =============================================================================

interface AppProps {
  store: EventStore;
}

const App: FC<AppProps> = (props: AppProps) => {
  const [view, setView] = useState<View>({ type: "list" });
  const [state, setState] = useState<QueryState>({ limit: 20, offset: 0 });
  const [allEvents, setAllEvents] = useState<StorableEvent[]>([]);

  useEffect(() => {
    const load = async () => {
      const events = await fetchEvents(props.store, { ...state, offset: 0, limit: 10000 });
      setAllEvents(events);
    };
    load();
  }, [state]);

  if (view.type === "filter") {
    const currentValue = view.field === "scope" ? state.scope
      : view.field === "type" ? state.type
      : view.field === "since" ? state.since
      : state.correlationId;
    return (
      <FilterInput
        field={view.field}
        currentValue={currentValue}
        onSubmit={(value: string) => {
          const updates: Partial<QueryState> = { offset: 0 };
          if (view.field === "scope") updates.scope = value || undefined;
          else if (view.field === "type") updates.type = value || undefined;
          else if (view.field === "since") updates.since = value || undefined;
          else updates.correlationId = value || undefined;
          setState((s) => ({ ...s, ...updates }));
          setView({ type: "list" });
        }}
        onCancel={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "detail") {
    return <DetailView event={view.event} onBack={() => setView({ type: "list" })} />;
  }

  if (view.type === "export") {
    return <ExportView events={allEvents} onBack={() => setView({ type: "list" })} />;
  }

  return (
    <ListView
      store={props.store}
      state={state}
      onUpdateState={(updates: Partial<QueryState>) => setState((s) => ({ ...s, ...updates }))}
      onViewEvent={(event: StorableEvent) => setView({ type: "detail", event })}
      onFilter={(field: "scope" | "type" | "since" | "correlation") => setView({ type: "filter", field })}
      onExport={() => setView({ type: "export" })}
    />
  );
};

// =============================================================================
// CLI (non-interactive modes)
// =============================================================================

const cliList = async (store: EventStore, limit: number): Promise<void> => {
  try {
    const events = await fetchEvents(store, { limit, offset: 0 });
    if (events.length === 0) {
      console.log("No events found.");
      return;
    }
    console.log("\nRecent Events\n" + "─".repeat(76));
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      console.log(`  [${(i + 1).toString().padStart(2)}] ${e.scope.padEnd(10)} ${e.type.padEnd(25)} ${relativeTime(e.timestamp).padEnd(10)} ${e.eventId.slice(0, 8)}`);
    }
    console.log("─".repeat(76) + `\nShowing ${events.length} most recent events`);
  } catch (e) {
    const error = toAppError(e, "Failed to list events");
    console.error(`Error: ${error.title} - ${error.message}`);
    Deno.exit(1);
  }
};

const cliView = async (store: EventStore, eventId: string): Promise<void> => {
  try {
    const res = await store.fetch({ type: "all" });
    if (!res.ok) {
      console.error(`Query failed: ${res.error.message}`);
      Deno.exit(1);
    }
    const event = res.value.find((e) => e.eventId === eventId || e.eventId.startsWith(eventId));
    if (!event) {
      console.error(`Event not found: ${eventId}`);
      return;
    }
    console.log("\nEvent Details\n" + "─".repeat(60));
    console.log(`Event ID:    ${event.eventId}`);
    console.log(`Scope:       ${event.scope}`);
    console.log(`Type:        ${event.type}`);
    console.log(`Timestamp:   ${formatTimestamp(event.timestamp)}`);
    console.log("\nPayload:");
    console.log(JSON.stringify(event, null, 2));
  } catch (e) {
    const error = toAppError(e, "Failed to get event");
    console.error(`Error: ${error.title} - ${error.message}`);
    Deno.exit(1);
  }
};

const cliExport = async (store: EventStore, format: "csv" | "json"): Promise<void> => {
  try {
    const events = await fetchEvents(store, { limit: 10000, offset: 0 });
    const output = format === "json"
      ? JSON.stringify(events, null, 2)
      : stringify(
          events.map((e) => ({
            timestamp: e.timestamp,
            scope: e.scope,
            type: e.type,
            eventId: e.eventId,
            correlationId: getString(e, "correlationId") ?? "",
            payload: JSON.stringify(e),
          })),
          { columns: ["timestamp", "scope", "type", "eventId", "correlationId", "payload"], headers: true }
        );
    console.log(output);
  } catch (e) {
    const error = toAppError(e, "Failed to export events");
    console.error(`Error: ${error.title} - ${error.message}`);
    Deno.exit(1);
  }
};

// =============================================================================
// Main
// =============================================================================

const main = async (): Promise<void> => {
  const args = parseArgs(Deno.args, {
    string: ["limit"],
    boolean: ["help"],
    alias: { h: "help", l: "limit" },
  });

  if (args.help) {
    console.log(`view-event-log.tsx — Event Log Viewer

USAGE
  just event-logs [COMMAND]

COMMANDS
  (none)              Interactive TUI mode
  list [--limit N]    List recent events
  view <eventId>      View specific event
  export <csv|json>   Export to stdout`);
    return;
  }

  const databaseUrl = requireDatabaseUrl();
  const store = await createPostgresEventStore({ databaseUrl });
  const [cmd, ...rest] = args._;

  if (cmd === "list") {
    await cliList(store, args.limit ? parseInt(args.limit) : 20);
  } else if (cmd === "view") {
    if (!rest[0]) {
      console.error("Error: 'view' requires an event ID");
      Deno.exit(1);
    }
    await cliView(store, String(rest[0]));
  } else if (cmd === "export") {
    const format = rest[0];
    if (format !== "csv" && format !== "json") {
      console.error("Error: 'export' requires format (csv or json)");
      Deno.exit(1);
    }
    await cliExport(store, format);
  } else {
    await runApp(<App store={store} />);
  }
};

if (import.meta.main) {
  runMain(main);
}
