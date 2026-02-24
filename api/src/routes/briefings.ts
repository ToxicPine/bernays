// api/src/routes/briefings.ts
// Briefing routes — receive and respond to agent-to-agent briefing requests
//
// These routes are called by remote bernays instances. When a remote agent
// calls POST /briefings/request, this agent records the incoming request
// as a BriefingRequested event and responds with acceptance/rejection.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Effect } from "effect";
import {
  BriefingId,
  BRIEFING_SCOPE,
  CorrelationId,
  EventId,
  Scope,
} from "@bernays/server/core";
import {
  BriefingEventSchema,
  type BriefingEvent,
} from "@bernays/server/events";
import {
  deriveBriefings,
  getActiveBriefings,
  getBriefing,
} from "@bernays/server/briefing";
import type { ServerContext } from "$/context.ts";
import { ErrorSchema } from "$/schemas.ts";

// =============================================================================
// Schemas
// =============================================================================

const BriefingRequestBodySchema = z
  .object({
    briefingId: z.string().min(1),
    fromAgent: z.string().min(1),
    topic: z.string().min(1),
    /** When the briefing is scheduled to occur (ISO 8601). If omitted, immediate. */
    scheduledAt: z.string().datetime().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("BriefingRequestBody");

const BriefingRequestResponseSchema = z
  .object({
    accepted: z.boolean(),
    briefingId: z.string(),
    reason: z.string().optional(),
  })
  .openapi("BriefingRequestResponse");

const BriefingMessageBodySchema = z
  .object({
    sender: z.string().min(1),
    content: z.string().min(1),
  })
  .openapi("BriefingMessageBody");

const BriefingMessageResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("BriefingMessageResponse");

const BriefingEndBodySchema = z
  .object({
    endedBy: z.string().min(1),
    reason: z.string().optional(),
    summary: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("BriefingEndBody");

const BriefingEndResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("BriefingEndResponse");

const BriefingMessageSchema = z
  .object({
    sender: z.string(),
    content: z.string(),
    timestamp: z.string(),
  })
  .openapi("BriefingMessage");

// Serialized as a flat object for OpenAPI; the TypeScript type is a
// discriminated union on `status` (see server/src/briefing/view.ts).
const BriefingViewSchema = z
  .object({
    briefingId: z.string(),
    fromAgent: z.string(),
    toAgent: z.string(),
    topic: z.string(),
    status: z.enum(["requested", "declined", "active", "ended"]),
    messages: z.array(BriefingMessageSchema),
    context: z.record(z.string(), z.unknown()).optional(),
    requestedAt: z.string(),
    scheduledAt: z.string().optional(),
    // Present when status is "active" or "ended"
    acceptedAt: z.string().optional(),
    // Present when status is "ended"
    endedBy: z.string().optional(),
    endedAt: z.string().optional(),
    // Present when status is "declined" or "ended"
    endReason: z.string().optional(),
    // Present when status is "ended"
    summary: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("BriefingView");

const BriefingListResponseSchema = z
  .object({
    briefings: z.array(BriefingViewSchema),
  })
  .openapi("BriefingListResponse");

const BriefingResponseSchema = z
  .object({
    briefing: BriefingViewSchema,
  })
  .openapi("BriefingResponse");

// =============================================================================
// Route Definitions
// =============================================================================

const requestBriefingRoute = createRoute({
  method: "post",
  path: "/request",
  tags: ["Briefings"],
  description:
    "Receive a briefing request from a remote agent. Records a BriefingRequested event and accepts by default.",
  request: {
    body: {
      content: { "application/json": { schema: BriefingRequestBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: BriefingRequestResponseSchema },
      },
      description: "Briefing accepted or declined",
    },
    422: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Validation failed",
    },
  },
});

const sendMessageRoute = createRoute({
  method: "post",
  path: "/{briefingId}/message",
  tags: ["Briefings"],
  description:
    "Receive a message within an active briefing from a remote agent.",
  request: {
    params: z.object({
      briefingId: z.string().min(1).openapi({
        param: { name: "briefingId", in: "path" },
      }),
    }),
    body: {
      content: { "application/json": { schema: BriefingMessageBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: BriefingMessageResponseSchema },
      },
      description: "Message recorded",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Briefing not found or not active",
    },
  },
});

const endBriefingRoute = createRoute({
  method: "post",
  path: "/{briefingId}/end",
  tags: ["Briefings"],
  description: "End an active briefing. Either agent can end it.",
  request: {
    params: z.object({
      briefingId: z.string().min(1).openapi({
        param: { name: "briefingId", in: "path" },
      }),
    }),
    body: {
      content: { "application/json": { schema: BriefingEndBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: BriefingEndResponseSchema } },
      description: "Briefing ended",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Briefing not found",
    },
  },
});

const listBriefingsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Briefings"],
  description: "List all briefings. Optionally filter by status.",
  request: {
    query: z.object({
      status: z
        .enum(["requested", "declined", "active", "ended"])
        .optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: BriefingListResponseSchema },
      },
      description: "List of briefings",
    },
  },
});

const getBriefingRoute = createRoute({
  method: "get",
  path: "/{briefingId}",
  tags: ["Briefings"],
  description: "Get a specific briefing by ID.",
  request: {
    params: z.object({
      briefingId: z.string().min(1).openapi({
        param: { name: "briefingId", in: "path" },
      }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: BriefingResponseSchema } },
      description: "Briefing found",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Briefing not found",
    },
  },
});

// =============================================================================
// Helpers
// =============================================================================

const makeEventBase = () => ({
  scope: "briefing" as const,
  eventId: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  correlationId: crypto.randomUUID(),
});

const queryBriefingEvents = async (
  ctx: ServerContext,
): Promise<readonly BriefingEvent[]> => {
  const projection = ctx.projections.get(BRIEFING_SCOPE);
  if (!projection) return [];
  return (await Effect.runPromise(projection.query())) as readonly BriefingEvent[];
};

// =============================================================================
// App
// =============================================================================

export const briefingsRoutes = (ctx: ServerContext) => {
  const app = new OpenAPIHono();

  // POST /briefings/request
  app.openapi(requestBriefingRoute, async (c) => {
    const body = c.req.valid("json");

    const injector = ctx.injectors.get(BRIEFING_SCOPE);
    if (!injector) {
      return c.json({ error: "Briefing Scope Not Configured" }, 422);
    }

    // Derive this agent's identity from the Host header
    const toAgent = c.req.header("host") ?? "unknown";

    // Record BriefingRequested event
    const requestedEvent = {
      ...makeEventBase(),
      type: "BriefingRequested" as const,
      briefingId: body.briefingId,
      fromAgent: body.fromAgent,
      toAgent,
      topic: body.topic,
      scheduledAt: body.scheduledAt,
      context: body.context,
    };

    const result = await Effect.runPromiseExit(injector.append(requestedEvent));
    if (result._tag === "Failure") {
      return c.json({ error: "Failed To Record Briefing Request" }, 422);
    }

    // Leave the briefing in "requested" state for the sockpuppet to
    // accept or decline via the Briefing service.
    return c.json(
      BriefingRequestResponseSchema.parse({
        accepted: true,
        briefingId: body.briefingId,
      }),
      200,
    );
  });

  // POST /briefings/:briefingId/message
  app.openapi(sendMessageRoute, async (c) => {
    const { briefingId } = c.req.valid("param");
    const body = c.req.valid("json");

    const injector = ctx.injectors.get(BRIEFING_SCOPE);
    if (!injector) {
      return c.json({ error: "Briefing Scope Not Configured" }, 404);
    }

    // Verify briefing exists and is active
    const events = await queryBriefingEvents(ctx);
    const briefing = getBriefing(events, briefingId);
    if (!briefing || (briefing.status !== "active" && briefing.status !== "requested")) {
      return c.json({ error: "Briefing Not Found Or Not Active" }, 404);
    }

    // Record message event
    const messageEvent = {
      ...makeEventBase(),
      type: "BriefingMessageSent" as const,
      briefingId,
      sender: body.sender,
      content: body.content,
    };

    const result = await Effect.runPromiseExit(injector.append(messageEvent));
    if (result._tag === "Failure") {
      return c.json({ error: "Failed To Record Message" }, 404);
    }

    return c.json(BriefingMessageResponseSchema.parse({ ok: true as const }), 200);
  });

  // POST /briefings/:briefingId/end
  app.openapi(endBriefingRoute, async (c) => {
    const { briefingId } = c.req.valid("param");
    const body = c.req.valid("json");

    const injector = ctx.injectors.get(BRIEFING_SCOPE);
    if (!injector) {
      return c.json({ error: "Briefing Scope Not Configured" }, 404);
    }

    // Verify briefing exists
    const events = await queryBriefingEvents(ctx);
    const briefing = getBriefing(events, briefingId);
    if (!briefing) {
      return c.json({ error: "Briefing Not Found" }, 404);
    }

    // Record end event
    const endEvent = {
      ...makeEventBase(),
      type: "BriefingEnded" as const,
      briefingId,
      endedBy: body.endedBy,
      reason: body.reason,
      summary: body.summary,
    };

    const result = await Effect.runPromiseExit(injector.append(endEvent));
    if (result._tag === "Failure") {
      return c.json({ error: "Failed To Record Briefing End" }, 404);
    }

    return c.json(BriefingEndResponseSchema.parse({ ok: true as const }), 200);
  });

  // GET /briefings
  app.openapi(listBriefingsRoute, async (c) => {
    const { status } = c.req.valid("query");
    const events = await queryBriefingEvents(ctx);
    const all = deriveBriefings(events);
    let briefings = [...all.values()];

    if (status) {
      briefings = briefings.filter((b) => b.status === status);
    }

    return c.json(
      BriefingListResponseSchema.parse({ briefings }),
      200,
    );
  });

  // GET /briefings/:briefingId
  app.openapi(getBriefingRoute, async (c) => {
    const { briefingId } = c.req.valid("param");
    const events = await queryBriefingEvents(ctx);
    const briefing = getBriefing(events, briefingId);

    if (!briefing) {
      return c.json({ error: "Briefing Not Found" }, 404);
    }

    return c.json(
      BriefingResponseSchema.parse({ briefing }),
      200,
    );
  });

  return app;
};
