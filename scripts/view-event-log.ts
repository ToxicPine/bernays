#!/usr/bin/env -S deno run -A

import { parseArgs } from "@std/cli";
import { stringify } from "@std/csv";
import {
  createPostgresEventStore,
  type EventStore,
  type EventStoreQuery,
  type StorableEvent,
} from "@bernays/server/store";
import { bold, createLogger } from "./lib/log.ts";

// =============================================================================
// Interactive Viewer
// =============================================================================

const isInteractive = (): boolean =>
  Deno.stdout.isTerminal() && Deno.stdin.isTerminal();

const hasCsvlens = async (): Promise<boolean> => {
  try {
    const cmd = new Deno.Command("which", { args: ["csvlens"], stderr: "null", stdout: "null" });
    const { success } = await cmd.output();
    return success;
  } catch {
    return false;
  }
};

const pipeToViewer = async (output: string): Promise<void> => {
  const cmd = new Deno.Command("csvlens", {
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(output));
  await writer.close();
  await child.status;
};

// =============================================================================
// Types
// =============================================================================

type Format = "csv" | "json";

type Row = {
  timestamp: string;
  type: string;
  eventId: string;
  correlationId: string | undefined;
  intentId: string | undefined;
  payload: string;
  [key: string]: string | undefined;
};

interface QueryOptions {
  query: EventStoreQuery;
  typeFilter?: string;
  limit?: number;
  format: Format;
}

interface StoreProvider {
  create: () => Promise<EventStore>;
}

interface Config {
  storeProvider: StoreProvider;
  silent: boolean;
}

// =============================================================================
// Store Providers
// =============================================================================

export const postgresProvider = (databaseUrl: string): StoreProvider => ({
  create: () => createPostgresEventStore({ databaseUrl }),
});

// =============================================================================
// Query Execution
// =============================================================================

const getString = (obj: unknown, key: string): string | undefined => {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
};

const executeQuery = async (
  store: EventStore,
  options: QueryOptions,
): Promise<StorableEvent[]> => {
  const res = await store.fetch(options.query);
  if (!res.ok) {
    throw new Error(`Query failed: ${res.error.code}: ${res.error.message}`);
  }

  let events = [...res.value];

  if (options.typeFilter) {
    events = events.filter((e) => e.type.includes(options.typeFilter!));
  }

  if (options.limit && options.limit > 0) {
    events = events.slice(0, options.limit);
  }

  return events;
};

// =============================================================================
// Output Formatting
// =============================================================================

const formatJson = (events: StorableEvent[]): string => {
  return JSON.stringify(events, null, 2);
};

const formatCsv = (events: StorableEvent[]): string => {
  const rows: Row[] = events.map((e) => ({
    timestamp: e.timestamp,
    type: e.type,
    eventId: e.eventId,
    correlationId: getString(e, "correlationId"),
    intentId: getString(e, "intentId"),
    payload: JSON.stringify(e),
  }));

  return stringify(rows, {
    columns: [
      "timestamp",
      "type",
      "eventId",
      "correlationId",
      "intentId",
      "payload",
    ],
    headers: true,
  });
};

const formatOutput = (events: StorableEvent[], format: Format): string => {
  return format === "json" ? formatJson(events) : formatCsv(events);
};

// =============================================================================
// CLI
// =============================================================================

const HELP = `
${bold("events.ts")} — Query the Postgres-backed event log

${bold("USAGE")}
  deno run -A scripts/events.ts [OPTIONS]
  just events [OPTIONS]

${bold("OPTIONS")}
  --database-url <url>   Postgres URL (default: DATABASE_URL env)
  --since <iso>          Events since timestamp
  --correlation <uuid>   Events by correlationId
  --intent <uuid>        Events by intentId
  --type <str>           Filter by type substring
  --limit <n>            Limit number of results
  --format csv|json      Output format (default: csv)
  --silent               Suppress non-error output
  --help                 Show this help

${bold("EXAMPLES")}
  just events --since 2026-01-09
  just events --type linkedin --limit 100
  just events --correlation abc123 --format json

${bold("NOTES")}
  Query precedence: correlation > intent > since > all
  CSV output is piped to csvlens automatically when running interactively.
`.trim();

interface CliArgs {
  help: boolean;
  silent: boolean;
  databaseUrl?: string;
  correlation?: string;
  intent?: string;
  since?: string;
  type?: string;
  limit?: string;
  format: string;
}

const parseCliArgs = (argv: string[]): CliArgs => {
  const args = parseArgs(argv, {
    string: [
      "database-url",
      "since",
      "correlation",
      "intent",
      "format",
      "type",
      "limit",
    ],
    boolean: ["help", "silent"],
    default: { format: "csv" },
  });

  return {
    help: args.help,
    silent: args.silent,
    databaseUrl: args["database-url"],
    correlation: args.correlation,
    intent: args.intent,
    since: args.since,
    type: args.type,
    limit: args.limit,
    format: args.format,
  };
};

const buildQueryOptions = (args: CliArgs): QueryOptions => {
  const query: EventStoreQuery = args.correlation
    ? { type: "byCorrelation", correlationId: args.correlation }
    : args.intent
    ? { type: "byIntent", intentId: args.intent }
    : args.since
    ? { type: "since", timestamp: args.since }
    : { type: "all" };

  const format = args.format as Format;
  if (format !== "csv" && format !== "json") {
    throw new Error(`Invalid --format '${args.format}'. Use 'csv' or 'json'.`);
  }

  let limit: number | undefined;
  if (args.limit) {
    limit = Number(args.limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error(
        `Invalid --limit '${args.limit}'. Must be a positive number.`,
      );
    }
  }

  return { query, typeFilter: args.type, limit, format };
};

// =============================================================================
// Main
// =============================================================================

export const run = async (config: Config): Promise<void> => {
  const store = await config.storeProvider.create();
  const argv = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
  const args = parseCliArgs(argv);
  const log = createLogger(config.silent || args.silent);

  if (args.help) {
    console.log(HELP);
    return;
  }

  const options = buildQueryOptions(args);
  log.info(`Querying events (${options.query.type})...`);

  const events = await executeQuery(store, options);
  log.info(`Found ${events.length} events`);

  const output = formatOutput(events, options.format);

  if (options.format === "csv" && isInteractive() && await hasCsvlens()) {
    await pipeToViewer(output);
  } else {
    Deno.stdout.writeSync(new TextEncoder().encode(output));
  }
};

// =============================================================================
// Entry
// =============================================================================

if (import.meta.main) {
  const log = createLogger(false);

  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    log.error(`DATABASE_URL is not set.

To set up the database, run:

    ${bold("bernays deploy")}

This will create a managed Postgres database and write DATABASE_URL to .env.
Alternatively, pass --database-url <url> directly.
`);
    Deno.exit(1);
  }

  try {
    await run({
      storeProvider: postgresProvider(databaseUrl),
      silent: false,
    });
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
