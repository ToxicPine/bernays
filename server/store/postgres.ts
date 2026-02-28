// store/postgres.ts
// Postgres-backed EventStore implementation (Managed Postgres / SaaS Postgres)
//
// Notes:
// - Auto-creates the table + indexes on startup (idempotent)
// - Deduplication is enforced via PRIMARY KEY (event_id) + ON CONFLICT DO NOTHING
// - Stores full event JSON in a jsonb `payload` column, plus common index fields

import postgres from "postgres";
import { Duration, Effect, Layer, PubSub, Schedule, Stream } from "effect";
import type { Scope } from "$/core/branded.ts";
import {
  createEventStoreError,
  type EventStoreError,
  type EventStoreQuery,
  type EventStoreService,
  EventStoreTag,
  type StorableEvent,
  StorableEventSchema,
} from "./types.ts";
import { getCorrelationId, getIntentId } from "./utils.ts";

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

const payloadsFromRows = (rows: unknown): StorableEvent[] => {
  if (!Array.isArray(rows)) return [];
  const out: StorableEvent[] = [];
  for (const row of rows) {
    if (row && typeof row === "object" && "payload" in row) {
      const payload = (row as { payload: unknown }).payload;
      const parsed = StorableEventSchema.safeParse(payload);
      if (parsed.success) {
        out.push(payload as StorableEvent);
      }
    }
  }
  return out;
};

/**
 * Create a Postgres-backed EventStore Layer with reactive subscribe.
 *
 * Subscribe is implemented via internal polling: a background fiber queries
 * for new events on a short interval (default 1s) and publishes them to a
 * PubSub. Subscribers receive scope-filtered chunks.
 *
 * The SQL connection, poll fiber, and PubSub are all scoped to the layer's
 * lifetime.
 */
export const EventStorePostgres = (
  options: PostgresEventStoreOptions & {
    /** Poll interval for subscribe. Default: 1 second. */
    readonly pollInterval?: Duration.DurationInput;
  },
): Layer.Layer<EventStoreTag> =>
  Layer.scoped(
    EventStoreTag,
    Effect.gen(function* () {
      const {
        databaseUrl,
        schema = "public",
        table = "events",
        maxConnections = 5,
      } = options;
      const qt = qualifiedTable(schema, table);
      const interval = options.pollInterval ?? Duration.seconds(1);

      const sql = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const client = postgres(databaseUrl, {
              max: maxConnections,
              onnotice: () => {},
            });
            await ensureSetup(client, schema, table);
            return client;
          },
          catch: (err) =>
            createEventStoreError(
              "ConnectionError",
              "Failed to connect to Postgres",
              err,
            ),
        }).pipe(Effect.orDie),
        (client) =>
          Effect.promise(() => client.end({ timeout: 5 }).catch(() => {})),
      );

      const fetch = (
        query?: EventStoreQuery,
      ): Effect.Effect<readonly StorableEvent[], EventStoreError> =>
        Effect.tryPromise({
          try: async () => {
            const q = query ?? { type: "all" as const };
            switch (q.type) {
              case "all": {
                const rows = await sql.unsafe(
                  `select payload from ${qt} order by ts asc, event_id asc`,
                );
                return payloadsFromRows(rows);
              }
              case "since": {
                const rows = await sql.unsafe(
                  `select payload from ${qt} where ts >= $1 order by ts asc, event_id asc`,
                  [q.timestamp],
                );
                return payloadsFromRows(rows);
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
                return payloadsFromRows(rows);
              }
              case "byCorrelation": {
                const rows = await sql.unsafe(
                  `select payload from ${qt} where correlation_id = $1 order by ts asc, event_id asc`,
                  [q.correlationId],
                );
                return payloadsFromRows(rows);
              }
              case "byIntent": {
                const rows = await sql.unsafe(
                  `select payload from ${qt} where intent_id = $1 order by ts asc, event_id asc`,
                  [q.intentId],
                );
                return payloadsFromRows(rows);
              }
            }
          },
          catch: (err) =>
            createEventStoreError("QueryFailed", "Failed to fetch events", err),
        });

      const appendToStore = (
        events: readonly StorableEvent[],
      ): Effect.Effect<void, EventStoreError> =>
        Effect.tryPromise({
          try: async () => {
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
          },
          catch: (err) =>
            createEventStoreError(
              "AppendFailed",
              "Failed to append events",
              err,
            ),
        });

      const pubsub = yield* PubSub.unbounded<readonly StorableEvent[]>();

      // Track the latest timestamp we've seen across ALL scopes.
      let cursor: string | undefined;

      const initResult = yield* fetch({ type: "all" }).pipe(Effect.orDie);
      if (initResult.length > 0) {
        cursor = initResult[initResult.length - 1].timestamp;
      }

      // Background poll fiber: queries for new events and publishes to PubSub.
      yield* Effect.gen(function* () {
        const result = yield* fetch(
          cursor ? { type: "since", timestamp: cursor } : { type: "all" },
        );

        const newEvents = cursor
          ? result.filter((e) => e.timestamp > cursor!)
          : result;

        if (newEvents.length > 0) {
          cursor = newEvents[newEvents.length - 1].timestamp;
          yield* PubSub.publish(pubsub, newEvents);
        }
      }).pipe(
        Effect.catchAll((err) =>
          Effect.logWarning("EventStore poll failed", { error: err })
        ),
        Effect.repeat(Schedule.spaced(interval)),
        Effect.forkScoped,
      );

      const service: EventStoreService = {
        fetch,

        append: (events) =>
          Effect.gen(function* () {
            yield* appendToStore(events);
            if (events.length > 0) {
              yield* PubSub.publish(pubsub, events);
              // Advance cursor so the poll fiber doesn't re-deliver.
              const last = events[events.length - 1];
              if (!cursor || last.timestamp > cursor) {
                cursor = last.timestamp;
              }
            }
          }),

        subscribe: (scope: Scope, since?: string) =>
          Stream.unwrapScoped(
            Effect.gen(function* () {
              const queue = yield* PubSub.subscribe(pubsub);
              return Stream.fromQueue(queue).pipe(
                Stream.map((chunk) =>
                  chunk.filter((e) => {
                    if (e.scope !== scope) return false;
                    if (since && e.timestamp <= since) return false;
                    return true;
                  })
                ),
                Stream.filter((chunk) => chunk.length > 0),
              );
            }),
          ),
      };

      return service;
    }),
  );
