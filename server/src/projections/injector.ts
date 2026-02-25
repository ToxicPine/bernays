// src/projections/injector.ts
// Type-safe, validated writes to the event store (write-side mirror of Projection)

import { Context, Effect, Layer } from "effect";
import type { z } from "@zod/zod";
import type { Scope } from "$/core/branded.ts";
import { EventStoreTag, type StorableEvent } from "$/store/mod.ts";

// =============================================================================
// Error
// =============================================================================

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

// =============================================================================
// Injector Interface
// =============================================================================

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

  /** Append a single event after validation. */
  readonly append: (event: TEvent) => Effect.Effect<void, InjectorError>;
}

// =============================================================================
// Tag Factory
// =============================================================================

/**
 * Creates an Effect service tag for a specific Injector type.
 *
 * @example
 * ```typescript
 * const LinkedInInjection = makeInjectorTag<LinkedInEvent>("linkedin/Injection");
 * ```
 */
export const makeInjectorTag = <TEvent extends StorableEvent>(name: string) =>
  Context.GenericTag<Injector<TEvent>>(name);

// =============================================================================
// Layer Factory
// =============================================================================

/**
 * Creates a Layer that provides an Injector for a specific scope.
 * Resolves EventStoreTag from context.
 *
 * @param tag - The scope-specific Injector tag
 * @param scope - The event scope
 * @param schema - Zod schema to validate events before append
 *
 * @example
 * ```typescript
 * const LinkedInInjection = makeInjectorTag<LinkedInEvent>("linkedin/Injection");
 * const layer = makeInjectionLayer(LinkedInInjection, LINKEDIN_SCOPE, LinkedInEventSchema);
 * ```
 */
export const makeInjectionLayer = <TEvent extends StorableEvent>(
  tag: Context.Tag<any, Injector<TEvent>>,
  scope: Scope,
  schema: z.ZodType<TEvent>,
): Layer.Layer<Context.Tag.Identifier<typeof tag>, never, EventStoreTag> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      const store = yield* EventStoreTag;

      const injector: Injector<TEvent> = {
        scope,
        append: (event) =>
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
    }),
  );
