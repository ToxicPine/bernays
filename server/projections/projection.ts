// src/projections/projection.ts
// Type-safe, filtered access to the event store (read-side mirror of Injection)

import { Context, Effect, Layer, Stream } from "effect";
import type { z } from "@zod/zod";
import type { Scope } from "$/core/branded.ts";
import {
  type EventStoreError,
  EventStoreTag,
  type StorableEvent,
} from "$/store/mod.ts";

// =============================================================================
// Projection Interface
// =============================================================================

/**
 * Projection provides type-safe, filtered, reactive access to the event store.
 *
 * Guarantees:
 * 1. Filtering by scope at the store level
 * 2. Zod validation against the scope's schema
 * 3. Type narrowing to the scope's event union
 *
 * Events that fail validation are filtered out with a warning.
 */
export interface Projection<TEvent extends StorableEvent> {
  readonly scope: Scope;

  /** One-shot query (for startup hydration and API reads). */
  readonly query: (
    since?: string,
  ) => Effect.Effect<readonly TEvent[], EventStoreError>;

  /** Reactive stream of validated events (for background state fiber). */
  readonly subscribe: (
    since?: string,
  ) => Stream.Stream<readonly TEvent[], EventStoreError>;
}

// =============================================================================
// Zod validation helper (shared by query and subscribe)
// =============================================================================

const validateChunk = <TEvent extends StorableEvent>(
  events: readonly StorableEvent[],
  schema: z.ZodType<TEvent>,
  scope: Scope,
): Effect.Effect<readonly TEvent[]> => {
  const validated: TEvent[] = [];
  const warnings: Effect.Effect<void>[] = [];

  for (const event of events) {
    const parseResult = schema.safeParse(event);
    if (parseResult.success) {
      validated.push(parseResult.data);
    } else {
      warnings.push(
        Effect.logWarning("Event validation failed in projection", {
          scope,
          eventId: event.eventId,
          type: event.type,
        }),
      );
    }
  }

  if (warnings.length === 0) return Effect.succeed(validated);

  return Effect.gen(function* () {
    yield* Effect.all(warnings, { discard: true });
    return validated;
  });
};

// =============================================================================
// Tag Factory
// =============================================================================

/**
 * Creates an Effect service tag for a specific Projection type.
 *
 * @example
 * ```typescript
 * const LinkedInProjection = makeProjectionTag<LinkedInEvent>("linkedin/Projection");
 * ```
 */
export const makeProjectionTag = <TEvent extends StorableEvent>(
  name: string,
) => Context.GenericTag<Projection<TEvent>>(name);

// =============================================================================
// Layer Factory
// =============================================================================

/**
 * Creates a Layer that provides a Projection for a specific scope.
 * Resolves EventStoreTag from context.
 *
 * @param tag - The scope-specific Projection tag
 * @param scope - The event scope
 * @param schema - Zod schema to validate events on read
 *
 * @example
 * ```typescript
 * const LinkedInProjection = makeProjectionTag<LinkedInEvent>("linkedin/Projection");
 * const layer = makeProjectionLayer(LinkedInProjection, LINKEDIN_SCOPE, LinkedInEventSchema);
 * ```
 */
export const makeProjectionLayer = <TEvent extends StorableEvent>(
  tag: Context.Tag<any, Projection<TEvent>>,
  scope: Scope,
  schema: z.ZodType<TEvent>,
): Layer.Layer<Context.Tag.Identifier<typeof tag>, never, EventStoreTag> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      const store = yield* EventStoreTag;

      const projection: Projection<TEvent> = {
        scope,

        query: (since) =>
          Effect.gen(function* () {
            const events = yield* store.fetch(
              since
                ? { type: "byScope", scope, since }
                : { type: "byScope", scope },
            );
            return yield* validateChunk(events, schema, scope);
          }),

        subscribe: (since) =>
          store.subscribe(scope, since).pipe(
            Stream.mapEffect((chunk) => validateChunk(chunk, schema, scope)),
            Stream.filter((chunk) => chunk.length > 0),
          ),
      };

      return projection;
    }),
  );
