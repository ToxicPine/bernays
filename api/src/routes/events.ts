// api/src/routes/events.ts
// Event routes — submit events and read the event log

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Effect, Either } from "effect";
import { Scope as makeScope } from "@bernays/server/core";
import type { ServerContext } from "$/context.ts";
import { submitEvent } from "$/bus.ts";
import {
  BatchSubmitResponseSchema,
  ErrorSchema,
  EventPayloadSchema,
  EventsListResponseSchema,
  SubmitEventResponseSchema,
} from "$/schemas.ts";

// =============================================================================
// Route Definitions
// =============================================================================

const submitEventRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Events"],
  description:
    "Submit a single event to the event bus. Validates against the platform schema for the event's scope, then injects into the store.",
  request: {
    body: {
      content: { "application/json": { schema: EventPayloadSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: SubmitEventResponseSchema } },
      description: "Event accepted",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Unknown scope",
    },
    422: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Validation failed",
    },
  },
});

const batchSubmitRoute = createRoute({
  method: "post",
  path: "/batch",
  tags: ["Events"],
  description:
    "Submit multiple events. Each is validated independently. Returns 201 if all succeed, 207 if partial.",
  request: {
    body: {
      content: {
        "application/json": { schema: z.array(EventPayloadSchema) },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: BatchSubmitResponseSchema } },
      description: "All events accepted",
    },
    207: {
      content: { "application/json": { schema: BatchSubmitResponseSchema } },
      description: "Partial success",
    },
  },
});

const listEventsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Events"],
  description:
    "Read events with optional filters. Supports scope, since, correlation, intent. Paginated.",
  request: {
    query: z.object({
      scope: z.string().optional(),
      since: z.string().optional(),
      correlation: z.string().optional(),
      intent: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(100).openapi({
        example: 100,
      }),
      offset: z.coerce.number().int().min(0).default(0).openapi({
        example: 0,
      }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: EventsListResponseSchema } },
      description: "Paginated event list",
    },
  },
});

// =============================================================================
// App
// =============================================================================

export const eventsRoutes = (ctx: ServerContext) => {
  const app = new OpenAPIHono();

  // POST /events
  app.openapi(submitEventRoute, async (c) => {
    const body = c.req.valid("json");

    const result = await Effect.runPromiseExit(submitEvent(ctx, body));

    if (result._tag === "Failure") {
      const cause = result.cause;
      if (cause._tag === "Fail") {
        const err = cause.error;
        if (err.code === "UnknownScope") {
          return c.json({ error: err.message, code: err.code }, 404);
        }
        return c.json({ error: err.message, code: err.code }, 422);
      }
      return c.json({ error: "Internal Error" }, 422);
    }

    return c.json(
      SubmitEventResponseSchema.parse({ ok: true, event: result.value }),
      201,
    );
  });

  // POST /events/batch
  app.openapi(batchSubmitRoute, async (c) => {
    const payloads = c.req.valid("json");

    const results: Array<{ ok: boolean; eventId?: string; error?: string }> =
      [];

    for (const payload of payloads) {
      const result = await Effect.runPromiseExit(submitEvent(ctx, payload));
      if (result._tag === "Failure") {
        const cause = result.cause;
        const message = cause._tag === "Fail"
          ? cause.error.message
          : "Internal Error";
        results.push({ ok: false, error: message });
      } else {
        results.push({ ok: true, eventId: result.value.eventId });
      }
    }

    const allOk = results.every((r) => r.ok);
    return c.json(
      BatchSubmitResponseSchema.parse({ results }),
      allOk ? 201 : 207,
    );
  });

  // GET /events
  app.openapi(listEventsRoute, async (c) => {
    const { scope, since, correlation, intent, limit, offset } = c.req.valid(
      "query",
    );

    type StoreQuery =
      | { type: "all" }
      | { type: "since"; timestamp: string }
      | { type: "byScope"; scope: ReturnType<typeof makeScope> }
      | {
        type: "byScope";
        scope: ReturnType<typeof makeScope>;
        since: string;
      }
      | { type: "byCorrelation"; correlationId: string }
      | { type: "byIntent"; intentId: string };

    let query: StoreQuery;

    if (correlation) {
      query = { type: "byCorrelation", correlationId: correlation };
    } else if (intent) {
      query = { type: "byIntent", intentId: intent };
    } else if (scope && since) {
      query = { type: "byScope", scope: makeScope(scope), since };
    } else if (scope) {
      query = { type: "byScope", scope: makeScope(scope) };
    } else if (since) {
      query = { type: "since", timestamp: since };
    } else {
      query = { type: "all" };
    }

    const fetchResult = await Effect.runPromise(
      Effect.either(ctx.eventStore.fetch(query)),
    );

    if (Either.isLeft(fetchResult)) {
      return c.json(
        EventsListResponseSchema.parse({
          events: [],
          pagination: { total: 0, offset, limit, hasMore: false },
        }),
        200,
      );
    }

    const total = fetchResult.right.length;
    const page = fetchResult.right.slice(offset, offset + limit);

    return c.json(
      EventsListResponseSchema.parse({
        events: page,
        pagination: { total, offset, limit, hasMore: offset + limit < total },
      }),
      200,
    );
  });

  return app;
};
