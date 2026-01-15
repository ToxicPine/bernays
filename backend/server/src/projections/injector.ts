// src/projections/injector.ts
// Type-safe, validated writes to the event store (write-side mirror of Projection)

import { Context, Effect } from "effect";
import type { z } from "@zod/zod";
import type { Scope } from "$/core/branded.ts";
import type { EventStore, StorableEvent } from "$/store/mod.ts";

// Injector Error

export type InjectorErrorCode = "ValidationFailed" | "AppendFailed";

export interface InjectorError {
  readonly code: InjectorErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const createInjectorError = (
  code: InjectorErrorCode,
  message: string,
  cause?: unknown,
): InjectorError => ({ code, message, cause });

// Injector Interface

/**
 * Injector provides type-safe, validated writes to the event store.
 *
 * Guarantees:
 * 1. Zod validation against the scope's schema before append
 * 2. Type safety for the scope's event union
 * 3. Atomic append to the underlying store
 *
 * This is the write-side mirror of Projection:
 * - Projection validates on read
 * - Injector validates on write
 */
export interface Injector<TEvent extends StorableEvent> {
  readonly scope: Scope;

  /**
   * Append a single event after validation.
   * @param event - The event to validate and append
   */
  readonly append: (event: TEvent) => Effect.Effect<void, InjectorError>;
}

// Injector Factory

/**
 * Creates an injector for a specific scope.
 *
 * @param scope - The scope for events (must match event.scope)
 * @param schema - Zod schema to validate events before append
 * @param store - The event store to write to
 */
export const makeInjector = <TEvent extends StorableEvent>(
  scope: Scope,
  schema: z.ZodType<TEvent>,
  store: EventStore,
): Injector<TEvent> => ({
  scope,

  append: (event) =>
    Effect.gen(function* () {
      // Validate event against schema
      const parseResult = schema.safeParse(event);
      if (!parseResult.success) {
        return yield* Effect.fail(
          createInjectorError(
            "ValidationFailed",
            `Event validation failed: ${parseResult.error.message}`,
            parseResult.error,
          ),
        );
      }

      // Append validated event
      const result = yield* Effect.tryPromise({
        try: () => store.append([parseResult.data]),
        catch: (err) =>
          createInjectorError(
            "AppendFailed",
            err instanceof Error ? err.message : String(err),
            err,
          ),
      });

      if (!result.ok) {
        return yield* Effect.fail(
          createInjectorError(
            "AppendFailed",
            result.error.message,
            result.error,
          ),
        );
      }
    }),
});

// Effect-based Injector Factory

import { EventStoreEffect } from "./projection.ts";

/**
 * Creates an injector using the EventStore Effect service.
 */
export const makeInjectorEffect = <TEvent extends StorableEvent>(
  scope: Scope,
  schema: z.ZodType<TEvent>,
): Effect.Effect<Injector<TEvent>, never, EventStoreEffect> =>
  Effect.gen(function* () {
    const store = yield* EventStoreEffect;

    const injector: Injector<TEvent> = {
      scope,

      append: (event: TEvent) =>
        Effect.gen(function* () {
          const parseResult = schema.safeParse(event);
          if (!parseResult.success) {
            return yield* Effect.fail(
              createInjectorError(
                "ValidationFailed",
                `Event validation failed: ${parseResult.error.message}`,
                parseResult.error,
              ),
            );
          }

          yield* store.append([parseResult.data]).pipe(
            Effect.mapError((err) =>
              createInjectorError("AppendFailed", err.message, err)
            ),
          );
        }),
    };

    return injector;
  });

// Injector Effect Service Tag Factory

/**
 * Creates an Effect service tag for a specific event type.
 * Use when you need to inject an Injector as a dependency.
 *
 * @example
 * ```typescript
 * const LinkedInInjector = makeInjectorTag<LinkedInEvent>("LinkedInInjector")
 * ```
 */
export const makeInjectorTag = <TEvent extends StorableEvent>(name: string) =>
  Context.GenericTag<Injector<TEvent>>(name);
