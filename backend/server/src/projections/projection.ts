// src/projections/projection.ts
// Type-safe, filtered access to the event store

import { Effect } from "effect";
import { z } from "@zod/zod";
import type { Scope } from "$/core/branded.ts";
import type {
  EventStore,
  EventStoreError,
  StorableEvent,
} from "$/store/mod.ts";

// ============================================================================
// Projection Interface
// ============================================================================

/**
 * Projection provides type-safe, filtered access to the event store.
 *
 * Guarantees:
 * 1. Filtering by scope at the database level
 * 2. Zod validation against the scope's schema
 * 3. Type narrowing to the scope's event union
 *
 * Events that fail validation are filtered out with a warning.
 */
export interface Projection<TEvent extends StorableEvent> {
  readonly scope: Scope;

  /**
   * Query events for this scope.
   * @param since - Optional timestamp to filter events since
   */
  readonly query: (
    since?: string,
  ) => Effect.Effect<readonly TEvent[], EventStoreError>;
}

// ============================================================================
// Projection Factory
// ============================================================================

/**
 * Creates a projection for a specific scope.
 *
 * @param scope - The scope to filter events by
 * @param schema - Zod schema to validate and type events
 * @param store - The event store to read from
 */
export const makeProjection = <TEvent extends StorableEvent>(
  scope: Scope,
  schema: z.ZodType<TEvent>,
  store: EventStore,
): Projection<TEvent> => ({
  scope,

  query: (since) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () =>
          store.fetch(
            since
              ? { type: "byScope", scope, since }
              : { type: "byScope", scope },
          ),
        catch: (err) => ({
          code: "QueryFailed" as const,
          message: err instanceof Error ? err.message : String(err),
        }),
      });

      if (!result.ok) {
        return yield* Effect.fail(result.error);
      }

      // Validate each event against schema, filter out invalid
      const validated: TEvent[] = [];
      for (const event of result.value) {
        const parseResult = schema.safeParse(event);
        if (parseResult.success) {
          validated.push(parseResult.data);
        } else {
          yield* Effect.logWarning("Event validation failed in projection", {
            scope,
            eventId: event.eventId,
            type: event.type,
          });
        }
      }

      return validated;
    }),
});

// ============================================================================
// Effect-based Projection Factory
// ============================================================================

/**
 * Creates a projection using the EventStore Effect service.
 */
export const makeProjectionEffect = <TEvent extends StorableEvent>(
  scope: Scope,
  schema: z.ZodType<TEvent>,
): Effect.Effect<Projection<TEvent>, never, EventStoreEffect> =>
  Effect.gen(function* () {
    const store = yield* EventStoreEffect;

    return {
      scope,

      query: (since) =>
        Effect.gen(function* () {
          const events = yield* store.query(
            since
              ? { type: "byScope", scope, since }
              : { type: "byScope", scope },
          ).pipe(
            Effect.mapError((err) => ({
              code: "QueryFailed" as const,
              message: err.message,
            })),
          );

          const validated: TEvent[] = [];
          for (const event of events) {
            const parseResult = schema.safeParse(event);
            if (parseResult.success) {
              validated.push(parseResult.data);
            } else {
              yield* Effect.logWarning(
                "Event validation failed in projection",
                {
                  scope,
                  eventId: event.eventId,
                  type: event.type,
                },
              );
            }
          }

          return validated;
        }),
    };
  });

// ============================================================================
// EventStore Effect Service (re-export from ingestion)
// ============================================================================

import { Context } from "effect";
import type { EventStoreQuery } from "$/store/mod.ts";

interface EventStoreEffectService {
  readonly append: (
    events: readonly StorableEvent[],
  ) => Effect.Effect<void, { readonly message: string }>;
  readonly query: (
    query?: EventStoreQuery,
  ) => Effect.Effect<readonly StorableEvent[], { readonly message: string }>;
}

export class EventStoreEffect extends Context.Tag("EventStoreEffect")<
  EventStoreEffect,
  EventStoreEffectService
>() {}
