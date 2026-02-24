// api/src/bus.ts
// Event bus — validate, enrich, and inject events into the store

import { Effect } from "effect";
import { type Scope, Scope as makeScope } from "@bernays/server/core";
import type { StorableEvent } from "@bernays/server/store";
import type { ServerContext } from "$/context.ts";

// =============================================================================
// Types
// =============================================================================

export type BusErrorCode =
  | "UnknownScope"
  | "ValidationFailed"
  | "InjectionFailed";

export interface BusError {
  readonly code: BusErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const busError = (
  code: BusErrorCode,
  message: string,
  cause?: unknown,
): BusError => ({ code, message, cause });

// =============================================================================
// Submit
// =============================================================================

/**
 * Submit a raw event payload to the bus.
 *
 * 1. Resolves scope from the payload
 * 2. Validates against the platform's event schema
 * 3. Injects into the event store via the scope's Injector
 */
export const submitEvent = (
  ctx: ServerContext,
  payload: unknown,
): Effect.Effect<StorableEvent, BusError> =>
  Effect.gen(function* () {
    // Payload must be an object with a scope field
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("scope" in payload)
    ) {
      return yield* Effect.fail(
        busError(
          "ValidationFailed",
          "Payload Must Be An Object With A 'scope' Field",
        ),
      );
    }

    const rawScope = payload.scope;
    if (typeof rawScope !== "string" || rawScope.length === 0) {
      return yield* Effect.fail(
        busError("ValidationFailed", "Scope Must Be A Non-Empty String"),
      );
    }

    const scope: Scope = makeScope(rawScope);

    // Look up schema from registry
    const schema = ctx.registry.getEventSchema(scope);
    if (!schema) {
      return yield* Effect.fail(
        busError(
          "UnknownScope",
          `No Platform Registered For Scope '${rawScope}'`,
        ),
      );
    }

    // Validate against platform schema
    const parseResult = schema.safeParse(payload);
    if (!parseResult.success) {
      return yield* Effect.fail(
        busError(
          "ValidationFailed",
          `Event Validation Failed: ${parseResult.error.message}`,
        ),
      );
    }

    const event = parseResult.data;

    // Inject into the event store
    const injector = ctx.injectors.get(scope);
    if (!injector) {
      return yield* Effect.fail(
        busError(
          "UnknownScope",
          `No Injector Registered For Scope '${rawScope}'`,
        ),
      );
    }

    const injectResult = yield* injector.append(event).pipe(
      Effect.mapError((err) =>
        busError("InjectionFailed", err.message, err.cause)
      ),
    );

    // injectResult is void on success
    void injectResult;

    return event;
  });
