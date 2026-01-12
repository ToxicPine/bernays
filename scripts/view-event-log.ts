#!/usr/bin/env -S deno run -A
// =============================================================================
// view-event-log.ts — Event log viewer TUI
// =============================================================================
//
// Usage:
//   deno run -A scripts/view-event-log.ts
//   just event-logs
//
// Commands:
//   (no args)         Interactive TUI mode
//   list              List recent events
//   view <eventId>    View a specific event
//   export            Export events to CSV/JSON
//
// Environment:
//   DATABASE_URL      Postgres connection string (required)
//
// =============================================================================

import { parseArgs } from "@std/cli";
import { stringify } from "@std/csv";
import {
  createPostgresEventStore,
  type EventStore,
  type EventStoreQuery,
  type StorableEvent,
} from "@bernays/server/store";
import { bold, createLogger, cyan, dim, green, magenta, red, yellow } from "./lib/log.ts";
import { boxHeader, clearScreen, hr, readLine, waitForEnter, write, writeln } from "./lib/tui.ts";

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

type Command =
  | { type: "interactive" }
  | { type: "list"; limit?: number }
  | { type: "view"; eventId: string }
  | { type: "export"; format: "csv" | "json" };

// =============================================================================
// Helpers
// =============================================================================

const getString = (obj: unknown, key: string): string | undefined => {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
};

const formatTimestamp = (ts: string): string => {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
};

const relativeTime = (ts: string): string => {
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return "";
  }
};

// =============================================================================
// Query Execution
// =============================================================================

/**
 * Build query object from state.
 */
const buildQuery = (state: QueryState): EventStoreQuery => {
  if (state.correlationId) {
    return { type: "byCorrelation", correlationId: state.correlationId };
  }
  if (state.since) {
    return { type: "since", timestamp: state.since };
  }
  return { type: "all" };
};

/**
 * Apply in-memory filters to events based on state.
 */
const applyFilters = (events: StorableEvent[], state: QueryState): StorableEvent[] => {
  let filtered = events;

  const { scope, type: typeFilter } = state;

  if (scope) {
    filtered = filtered.filter((e) => e.scope === scope);
  }
  if (typeFilter) {
    const lowerFilter = typeFilter.toLowerCase();
    filtered = filtered.filter((e) => e.type.toLowerCase().includes(lowerFilter));
  }

  return filtered;
};

/**
 * Fetch and filter events from the store.
 * Returns sorted events (most recent first).
 */
const fetchFilteredEvents = async (
  store: EventStore,
  state: QueryState,
): Promise<StorableEvent[]> => {
  const query = buildQuery(state);
  const res = await store.fetch(query);

  if (!res.ok) {
    throw new Error(`Query failed: ${res.error.code}: ${res.error.message}`);
  }

  const filtered = applyFilters([...res.value], state);

  // Sort by timestamp descending (most recent first)
  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return filtered;
};

/**
 * Execute a query with pagination.
 */
const executeQuery = async (
  store: EventStore,
  state: QueryState,
): Promise<StorableEvent[]> => {
  const events = await fetchFilteredEvents(store, state);
  const start = state.offset;
  const end = start + state.limit;
  return events.slice(start, end);
};

/**
 * Count total matching events (ignores pagination).
 */
const countEvents = async (store: EventStore, state: QueryState): Promise<number> => {
  try {
    const events = await fetchFilteredEvents(store, state);
    return events.length;
  } catch {
    return 0;
  }
};

// =============================================================================
// Display Helpers
// =============================================================================

const scopeColor = (scope: string): string => {
  switch (scope) {
    case "linkedin": return cyan(scope);
    case "x": return magenta(scope);
    case "journal": return yellow(scope);
    case "core": return dim(scope);
    default: return scope;
  }
};

const formatEventRow = (event: StorableEvent, index: number): string => {
  const scope = scopeColor(event.scope.padEnd(10));
  const type = event.type.padEnd(25);
  const time = dim(relativeTime(event.timestamp).padEnd(10));
  const id = dim(event.eventId.slice(0, 8));

  return `  ${dim(`[${(index + 1).toString().padStart(2)}]`)} ${scope} ${type} ${time} ${id}`;
};

const formatEventDetail = (event: StorableEvent): string => {
  const lines: string[] = [];

  lines.push(`${bold("Event ID:")}      ${cyan(event.eventId)}`);
  lines.push(`${bold("Scope:")}         ${scopeColor(event.scope)}`);
  lines.push(`${bold("Type:")}          ${event.type}`);
  lines.push(`${bold("Timestamp:")}     ${formatTimestamp(event.timestamp)}`);

  const correlationId = getString(event, "correlationId");
  if (correlationId) {
    lines.push(`${bold("Correlation:")}   ${correlationId}`);
  }

  const intentId = getString(event, "intentId");
  if (intentId) {
    lines.push(`${bold("Intent ID:")}     ${intentId}`);
  }

  lines.push("");
  lines.push(bold("Payload:"));
  lines.push(dim(hr(60)));

  // Pretty print the event payload
  const payload = { ...event };
  const pretty = JSON.stringify(payload, null, 2);
  lines.push(pretty);

  return lines.join("\n");
};

const formatFilters = (state: QueryState): string => {
  const parts: string[] = [];
  if (state.scope) parts.push(`scope=${cyan(state.scope)}`);
  if (state.type) parts.push(`type=${yellow(state.type)}`);
  if (state.since) parts.push(`since=${state.since}`);
  if (state.correlationId) parts.push(`correlation=${state.correlationId.slice(0, 8)}...`);
  return parts.length > 0 ? parts.join(" ") : dim("(none)");
};

// =============================================================================
// Interactive TUI
// =============================================================================

const interactiveMenu = async (store: EventStore): Promise<void> => {
  const state: QueryState = {
    limit: 20,
    offset: 0,
  };

  while (true) {
    clearScreen();
    writeln(boxHeader("Event Log Viewer", 76));
    writeln();

    // Show current filters
    writeln(`  ${bold("Filters:")} ${formatFilters(state)}`);
    writeln();

    // Fetch and display events
    const events = await executeQuery(store, state);
    const total = await countEvents(store, state);

    if (events.length === 0) {
      writeln(dim("  No events found.\n"));
    } else {
      const pageStart = state.offset + 1;
      const pageEnd = state.offset + events.length;
      writeln(dim(`  Showing ${pageStart}-${pageEnd} of ${total} events:\n`));

      for (let i = 0; i < events.length; i++) {
        writeln(formatEventRow(events[i], state.offset + i));
      }
      writeln();
    }

    writeln(dim(hr(76)));
    writeln();
    writeln("  " + bold("[v]") + " View event        " + bold("[f]") + " Filter by scope   " + bold("[t]") + " Filter by type");
    writeln("  " + bold("[s]") + " Since timestamp   " + bold("[c]") + " By correlation    " + bold("[r]") + " Reset filters");
    if (total > state.limit) {
      writeln("  " + bold("[n]") + " Next page         " + bold("[p]") + " Previous page");
    }
    writeln("  " + bold("[e]") + " Export            " + bold("[q]") + " Quit");
    writeln();

    const choice = await readLine(bold("  > "));

    switch (choice.toLowerCase()) {
      case "q":
      case "quit":
      case "exit":
        writeln(dim("\nGoodbye."));
        return;

      case "v":
      case "view": {
        if (events.length === 0) {
          writeln(yellow("\nNo events to view."));
        } else {
          const num = await readLine("  Enter event number: ");
          const idx = parseInt(num) - 1;
          if (idx >= 0 && idx < total) {
            const allEvents = await executeQuery(store, { ...state, offset: 0, limit: total });
            if (allEvents[idx]) {
              clearScreen();
              writeln(bold("\nEvent Details\n"));
              writeln(dim(hr(60)));
              writeln(formatEventDetail(allEvents[idx]));
              writeln(dim(hr(60)));
            }
          } else {
            writeln(red("\nInvalid event number."));
          }
        }
        await waitForEnter();
        break;
      }

      case "f":
      case "scope": {
        const scope = await readLine("  Filter by scope (or empty to clear): ");
        state.scope = scope || undefined;
        state.offset = 0;
        break;
      }

      case "t":
      case "type": {
        const type = await readLine("  Filter by type substring (or empty to clear): ");
        state.type = type || undefined;
        state.offset = 0;
        break;
      }

      case "s":
      case "since": {
        writeln(dim("  Format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS"));
        const since = await readLine("  Since timestamp (or empty to clear): ");
        state.since = since || undefined;
        state.offset = 0;
        break;
      }

      case "c":
      case "correlation": {
        const corr = await readLine("  Correlation ID (or empty to clear): ");
        state.correlationId = corr || undefined;
        state.offset = 0;
        break;
      }

      case "r":
      case "reset":
        state.scope = undefined;
        state.type = undefined;
        state.since = undefined;
        state.correlationId = undefined;
        state.offset = 0;
        writeln(green("\n  Filters reset."));
        await waitForEnter();
        break;

      case "n":
      case "next":
        if (state.offset + state.limit < total) {
          state.offset += state.limit;
        }
        break;

      case "p":
      case "prev":
      case "previous":
        if (state.offset > 0) {
          state.offset = Math.max(0, state.offset - state.limit);
        }
        break;

      case "e":
      case "export": {
        const format = await readLine("  Export format [csv/json]: ");
        if (format === "csv" || format === "json") {
          const allEvents = await executeQuery(store, { ...state, offset: 0, limit: 10000 });
          const output = format === "json"
            ? JSON.stringify(allEvents, null, 2)
            : formatCsv(allEvents);

          const filename = `events-${Date.now()}.${format}`;
          await Deno.writeTextFile(filename, output);
          writeln(green(`\n  Exported ${allEvents.length} events to ${filename}`));
        } else {
          writeln(yellow("\n  Invalid format. Use 'csv' or 'json'."));
        }
        await waitForEnter();
        break;
      }

      default: {
        // Check if it's a number to view directly
        const num = parseInt(choice);
        if (!isNaN(num) && num > 0 && num <= events.length) {
          const idx = state.offset + num - 1;
          const allEvents = await executeQuery(store, { ...state, offset: 0, limit: total });
          if (allEvents[idx]) {
            clearScreen();
            writeln(bold("\nEvent Details\n"));
            writeln(dim(hr(60)));
            writeln(formatEventDetail(allEvents[idx]));
            writeln(dim(hr(60)));
            await waitForEnter();
          }
        }
        break;
      }
    }
  }
};

// =============================================================================
// CSV Formatting
// =============================================================================

const formatCsv = (events: StorableEvent[]): string => {
  const rows = events.map((e) => ({
    timestamp: e.timestamp,
    scope: e.scope,
    type: e.type,
    eventId: e.eventId,
    correlationId: getString(e, "correlationId") ?? "",
    intentId: getString(e, "intentId") ?? "",
    payload: JSON.stringify(e),
  }));

  return stringify(rows, {
    columns: ["timestamp", "scope", "type", "eventId", "correlationId", "intentId", "payload"],
    headers: true,
  });
};

// =============================================================================
// CLI Commands
// =============================================================================

const listEvents = async (store: EventStore, limit: number): Promise<void> => {
  const events = await executeQuery(store, { limit, offset: 0 });

  if (events.length === 0) {
    writeln(yellow("No events found."));
    return;
  }

  writeln(bold("\nRecent Events\n"));
  writeln(dim(hr(76)));

  for (let i = 0; i < events.length; i++) {
    writeln(formatEventRow(events[i], i));
  }

  writeln(dim(hr(76)));
  writeln(dim(`\nShowing ${events.length} most recent events`));
};

const viewEvent = async (store: EventStore, eventId: string): Promise<void> => {
  const res = await store.fetch({ type: "all" });
  if (!res.ok) {
    writeln(red(`Query failed: ${res.error.message}`));
    return;
  }

  const event = res.value.find((e) => e.eventId === eventId || e.eventId.startsWith(eventId));
  if (!event) {
    writeln(red(`Event not found: ${eventId}`));
    return;
  }

  writeln(bold("\nEvent Details\n"));
  writeln(dim(hr(60)));
  writeln(formatEventDetail(event));
  writeln(dim(hr(60)));
};

const exportEvents = async (store: EventStore, format: "csv" | "json"): Promise<void> => {
  const events = await executeQuery(store, { limit: 10000, offset: 0 });

  const output = format === "json"
    ? JSON.stringify(events, null, 2)
    : formatCsv(events);

  write(output);
};

// =============================================================================
// CLI
// =============================================================================

const HELP = `
${bold("view-event-log.ts")} — Event log viewer TUI

${bold("USAGE")}
  deno run -A scripts/view-event-log.ts [COMMAND]
  just event-logs [COMMAND]

${bold("COMMANDS")}
  (none)              Interactive TUI mode
  list [--limit N]    List recent events (default: 20)
  view <eventId>      View a specific event (supports partial ID)
  export <csv|json>   Export all events to stdout

${bold("EXAMPLES")}
  just event-logs                    # Interactive mode
  just event-logs list --limit 50    # List 50 recent events
  just event-logs view abc123        # View event by ID prefix
  just event-logs export json > events.json
`.trim();

const parseCommand = (argv: string[]): Command => {
  const args = parseArgs(argv, {
    string: ["limit"],
    boolean: ["help"],
    alias: { h: "help", l: "limit" },
  });

  if (args.help) {
    console.log(HELP);
    Deno.exit(0);
  }

  const [cmd, ...rest] = args._;

  switch (cmd) {
    case "list":
      return { type: "list", limit: args.limit ? parseInt(args.limit) : 20 };
    case "view":
      if (!rest[0]) {
        console.error(red("Error: 'view' requires an event ID"));
        Deno.exit(1);
      }
      return { type: "view", eventId: String(rest[0]) };
    case "export": {
      const format = rest[0];
      if (format !== "csv" && format !== "json") {
        console.error(red("Error: 'export' requires format (csv or json)"));
        Deno.exit(1);
      }
      return { type: "export", format };
    }
    default:
      return { type: "interactive" };
  }
};

// =============================================================================
// Main
// =============================================================================

const main = async (): Promise<void> => {
  const log = createLogger(false);

  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    log.error(`DATABASE_URL is not set.

To set up the database, run:

    ${bold("just deploy")}

This will create a managed Postgres database and write DATABASE_URL to .env.
`);
    Deno.exit(1);
  }

  const store = await createPostgresEventStore({ databaseUrl });
  const command = parseCommand(Deno.args);

  switch (command.type) {
    case "interactive":
      await interactiveMenu(store);
      break;
    case "list":
      await listEvents(store, command.limit ?? 20);
      break;
    case "view":
      await viewEvent(store, command.eventId);
      break;
    case "export":
      await exportEvents(store, command.format);
      break;
  }
};

// =============================================================================
// Entry
// =============================================================================

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const log = createLogger(false);
    log.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
