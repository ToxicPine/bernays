// store/postgres.ts
// Postgres-backed EventStore implementation (Managed Postgres / SaaS Postgres)
//
// Notes:
// - Auto-creates the table + indexes on startup (idempotent)
// - Deduplication is enforced via PRIMARY KEY (event_id) + ON CONFLICT DO NOTHING
// - Stores full event JSON in a jsonb `payload` column, plus common index fields

import postgres from "postgres";
import { Err, Ok } from "$/core/result.ts";
import {
  createEventStoreError,
  type EventStore,
  type EventStoreQuery,
  type StorableEvent,
  StorableEventSchema,
} from "./mod.ts";
import { getCorrelationId, getIntentId } from "./utils.ts";
import { Effect } from "effect";

export interface PostgresEventStoreOptions {
  readonly databaseUrl: string;
  readonly schema?: string;
  readonly table?: string;
  readonly maxConnections?: number;
}

const Identifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const assertIdentifier = (value: string, label: string): void => {
  if (!Identifier.test(value)) {
    throw new Error(
      `Invalid ${label} '${value}'. Only letters, digits, and '_' are allowed, and it cannot start with a digit.`,
    );
  }
};

const qualifiedTable = (schema: string, table: string): string => {
  assertIdentifier(schema, "schema");
  assertIdentifier(table, "table");
  return `"${schema}"."${table}"`;
};

const ensureSchema = async (
  sql: postgres.Sql,
  schema: string,
): Promise<void> => {
  // public always exists
  if (schema === "public") return;
  assertIdentifier(schema, "schema");
  await sql.unsafe(`create schema if not exists "${schema}"`);
};

const ensureSetup = async (
  sql: postgres.Sql,
  schema: string,
  table: string,
): Promise<void> => {
  await ensureSchema(sql, schema);

  const qt = qualifiedTable(schema, table);

  // Main table
  await sql.unsafe(`
    create table if not exists ${qt} (
      event_id uuid primary key,
      ts timestamptz not null,
      scope text not null,
      type text not null,
      correlation_id uuid null,
      intent_id uuid null,
      payload jsonb not null
    )
  `);

  // Indexes for common queries
  await sql.unsafe(`create index if not exists ${table}_ts_idx on ${qt} (ts)`);
  await sql.unsafe(
    `create index if not exists ${table}_scope_ts_idx on ${qt} (scope, ts)`,
  );
  await sql.unsafe(
    `create index if not exists ${table}_type_ts_idx on ${qt} (type, ts)`,
  );
  await sql.unsafe(
    `create index if not exists ${table}_corr_ts_idx on ${qt} (correlation_id, ts)`,
  );
  await sql.unsafe(
    `create index if not exists ${table}_intent_ts_idx on ${qt} (intent_id, ts)`,
  );
};

/**
 * Create a Postgres-backed event store.
 *
 * This function is async because it auto-creates the schema/table/indexes.
 */
export const createPostgresEventStore = async <
  TEvent extends StorableEvent = StorableEvent,
>(
  options: PostgresEventStoreOptions,
): Promise<EventStore<TEvent>> => {
  const {
    databaseUrl,
    schema = "public",
    table = "events",
    maxConnections = 5,
  } = options;

  const sql = postgres(databaseUrl, { max: maxConnections });

  try {
    await ensureSetup(sql, schema, table);
  } catch (cause) {
    // Close immediately if setup failed
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // ignore
    }
    throw cause;
  }

  const qt = qualifiedTable(schema, table);

  return {
    async append(events: readonly TEvent[]) {
      try {
        await sql.begin(async (tx) => {
          for (const event of events) {
            const correlationId = getCorrelationId(event);
            const intentId = getIntentId(event);

            await tx.unsafe(
              `insert into ${qt}
                (event_id, ts, scope, type, correlation_id, intent_id, payload)
              values
                ($1, $2, $3, $4, $5, $6, $7)
              on conflict (event_id) do nothing`,
              [
                event.eventId,
                event.timestamp,
                event.scope,
                event.type,
                correlationId ?? null,
                intentId ?? null,
                event,
              ],
            );
          }
        });
        return Ok(undefined);
      } catch (cause) {
        return Err(
          createEventStoreError(
            "AppendFailed",
            "Failed to append events",
            cause,
          ),
        );
      }
    },

    async fetch(query?: EventStoreQuery) {
      const q = query ?? { type: "all" as const };

      try {
        const payloadsFromRows = (rows: unknown): TEvent[] => {
          if (!Array.isArray(rows)) return [];
          const out: TEvent[] = [];
          for (const row of rows) {
            if (row && typeof row === "object" && "payload" in row) {
              const payload = (row as { payload: unknown }).payload;
              // Validate base event structure
              const baseResult = StorableEventSchema.safeParse(payload);
              if (baseResult.success) {
                // Trust extended fields (full validation at ingestion)
                out.push(payload as TEvent);
              }
            }
          }
          return out;
        };

        switch (q.type) {
          case "all": {
            const rows = await sql.unsafe(
              `select payload from ${qt} order by ts asc, event_id asc`,
            );
            return Ok(payloadsFromRows(rows));
          }
          case "since": {
            const rows = await sql.unsafe(
              `select payload from ${qt} where ts >= $1 order by ts asc, event_id asc`,
              [q.timestamp],
            );
            return Ok(payloadsFromRows(rows));
          }
          case "byScope": {
            const sinceCond = "since" in q && q.since ? "and ts >= $2" : "";
            const params = "since" in q && q.since
              ? [q.scope, q.since]
              : [q.scope];
            const rows = await sql.unsafe(
              `select payload from ${qt} where scope = $1 ${sinceCond} order by ts asc, event_id asc`,
              params,
            );
            return Ok(payloadsFromRows(rows));
          }
          case "byCorrelation": {
            const rows = await sql.unsafe(
              `select payload from ${qt} where correlation_id = $1 order by ts asc, event_id asc`,
              [q.correlationId],
            );
            return Ok(payloadsFromRows(rows));
          }
          case "byIntent": {
            const rows = await sql.unsafe(
              `select payload from ${qt} where intent_id = $1 order by ts asc, event_id asc`,
              [q.intentId],
            );
            return Ok(payloadsFromRows(rows));
          }
        }
      } catch (cause) {
        return Err(
          createEventStoreError("QueryFailed", "Failed to fetch events", cause),
        );
      }
    },
  };
};

export const configurePostgresEventStore = (
  options: PostgresEventStoreOptions,
): Effect.Effect<EventStore<StorableEvent>> => {
  return Effect.promise(() => createPostgresEventStore(options));
};
