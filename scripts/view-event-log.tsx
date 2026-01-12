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
  relativeTime,
  formatTimestamp,
  truncate,
  scopeColor,
  renderApp,
  requireDatabaseUrl,
  runMain,
} from "./lib/ink.tsx";

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

const applyFilters = (events: StorableEvent[], state: QueryState): StorableEvent[] => {
  let filtered = events;
  if (state.scope) filtered = filtered.filter((e) => e.scope === state.scope);
  if (state.type) {
    const lower = state.type.toLowerCase();
    filtered = filtered.filter((e) => e.type.toLowerCase().includes(lower));
  }
  return filtered;
};

const fetchEvents = async (store: EventStore, state: QueryState): Promise<StorableEvent[]> => {
  const res = await store.fetch(buildQuery(state));
  if (!res.ok) throw new Error(`Query failed: ${res.error.message}`);
  const filtered = applyFilters([...res.value], state);
  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return filtered;
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
    <Box flexDirection="column">
      <Header title="Set Filter" />
      <Box>
        <Text bold>{labels[props.field]}: </Text>
        <TextInput
          value={value}
          onChange={(v: string) => setValue(v)}
          onSubmit={(v: string) => props.onSubmit(v)}
        />
      </Box>
      <StatusBar>Enter to confirm | Escape to cancel</StatusBar>
    </Box>
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

  useInput((input: string, key: { escape: boolean; upArrow: boolean; downArrow: boolean }) => {
    if (input === "q") exit();
    else if (key.escape || input === "b") props.onBack();
    else if (key.upArrow || input === "k") setScrollOffset((o: number) => Math.max(0, o - 1));
    else if (key.downArrow || input === "j") setScrollOffset((o: number) => Math.min(payload.length - 10, o + 1));
  });

  const visiblePayload = payload.slice(scrollOffset, scrollOffset + 15);

  return (
    <Box flexDirection="column">
      <Header title="Event Detail" />
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
        {payload.length > 15 && (
          <Text dimColor>... ({payload.length - 15} more lines, j/k to scroll)</Text>
        )}
      </Box>
      <StatusBar>j/k scroll | b back | q quit</StatusBar>
    </Box>
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

  useInput((input: string, key: { escape: boolean }) => {
    if (input === "q") exit();
    else if (key.escape || input === "b") props.onBack();
    else if (input === "c" && !format) setFormat("csv");
    else if (input === "j" && !format) setFormat("json");
  });

  useEffect(() => {
    if (!format) return;
    const doExport = async () => {
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
    };
    doExport();
  }, [format]);

  return (
    <Box flexDirection="column">
      <Header title="Export Events" />
      {!format ? (
        <>
          <Text>Select export format:</Text>
          <Box marginY={1} flexDirection="column">
            <Text><Text bold color="green">[c]</Text> CSV</Text>
            <Text><Text bold color="green">[j]</Text> JSON</Text>
          </Box>
        </>
      ) : exported ? (
        <Text color="green">Exported {props.events.length} events to {exported}</Text>
      ) : (
        <Text color="cyan">Exporting...</Text>
      )}
      <StatusBar>b back | q quit</StatusBar>
    </Box>
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
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);

  const pageSize = props.state.limit;
  const page = Math.floor(props.state.offset / pageSize);
  const totalPages = Math.ceil(total / pageSize);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const all = await fetchEvents(props.store, { ...props.state, offset: 0, limit: 10000 });
        setTotal(all.length);
        setEvents(all.slice(props.state.offset, props.state.offset + pageSize));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [props.state]);

  useInput((input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean }) => {
    if (input === "q" || key.escape) exit();
    else if (key.upArrow || input === "k") setSelected((s: number) => Math.max(0, s - 1));
    else if (key.downArrow || input === "j") setSelected((s: number) => Math.min(events.length - 1, s + 1));
    else if (key.return || input === " ") {
      if (events[selected]) props.onViewEvent(events[selected]);
    }
    else if (input === "f") props.onFilter("scope");
    else if (input === "t") props.onFilter("type");
    else if (input === "s") props.onFilter("since");
    else if (input === "c") props.onFilter("correlation");
    else if (input === "r") props.onUpdateState({ scope: undefined, type: undefined, since: undefined, correlationId: undefined, offset: 0 });
    else if (input === "n" && props.state.offset + pageSize < total) props.onUpdateState({ offset: props.state.offset + pageSize });
    else if (input === "p" && props.state.offset > 0) props.onUpdateState({ offset: Math.max(0, props.state.offset - pageSize) });
    else if (input === "e") props.onExport();
  });

  const filters: string[] = [];
  if (props.state.scope) filters.push(`scope=${props.state.scope}`);
  if (props.state.type) filters.push(`type=${props.state.type}`);
  if (props.state.since) filters.push(`since=${props.state.since}`);
  if (props.state.correlationId) filters.push(`corr=${props.state.correlationId.slice(0, 8)}...`);

  return (
    <Box flexDirection="column">
      <Header title="Event Log Viewer" />
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
      ) : events.length === 0 ? (
        <Text dimColor>No events found.</Text>
      ) : (
        <>
          <Text dimColor>
            Showing {props.state.offset + 1}-{props.state.offset + events.length} of {total}:
          </Text>
          <Box flexDirection="column" marginY={1}>
            {events.map((e, i) => (
              <Box key={e.eventId}>
                <Text color={selected === i ? "green" : "white"}>
                  {selected === i ? "> " : "  "}
                  <Text bold>[{(props.state.offset + i + 1).toString().padStart(2)}]</Text>{" "}
                  <Text color={scopeColor(e.scope)}>{e.scope.padEnd(10)}</Text>{" "}
                  {truncate(e.type, 25).padEnd(25)}{" "}
                  <Text dimColor>{relativeTime(e.timestamp).padEnd(10)}</Text>{" "}
                  <Text dimColor>{e.eventId.slice(0, 8)}</Text>
                </Text>
              </Box>
            ))}
          </Box>
        </>
      )}

      <StatusBar>
        j/k nav | Enter view | f scope | t type | s since | c corr | r reset | n/p page | e export | q quit
        {totalPages > 1 && ` | ${page + 1}/${totalPages}`}
      </StatusBar>
    </Box>
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
};

const cliView = async (store: EventStore, eventId: string): Promise<void> => {
  const res = await store.fetch({ type: "all" });
  if (!res.ok) {
    console.error(`Query failed: ${res.error.message}`);
    return;
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
};

const cliExport = async (store: EventStore, format: "csv" | "json"): Promise<void> => {
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
    renderApp(<App store={store} />);
  }
};

if (import.meta.main) {
  runMain(main);
}
