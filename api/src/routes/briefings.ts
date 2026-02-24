// api/src/routes/briefings.ts
// Briefing routes — read-only views into the shared briefing event log
//
// With the centralized event store model, agents write directly to the
// store via BriefingService. The API only exposes read endpoints for
// dashboards and tooling. An agentId query parameter selects whose
// perspective to view from.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Effect } from "effect";
import {
  AgentId,
  BRIEFING_SCOPE,
} from "@bernays/server/core";
import {
  BriefingEventSchema,
  type BriefingEvent,
} from "@bernays/server/events";
import {
  deriveBriefings,
  getBriefing,
} from "@bernays/server/briefing";
import type { ServerContext } from "$/context.ts";
import { ErrorSchema } from "$/schemas.ts";

// =============================================================================
// Schemas
// =============================================================================

const BriefingMessageSchema = z
  .object({
    sender: z.string(),
    content: z.string(),
    timestamp: z.string(),
  })
  .openapi("BriefingMessage");

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
    acceptedAt: z.string().optional(),
    endedBy: z.string().optional(),
    endedAt: z.string().optional(),
    reason: z.string().optional(),
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

const listBriefingsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Briefings"],
  description:
    "List briefings for a given agent. Requires agentId query parameter. Optionally filter by status.",
  request: {
    query: z.object({
      agentId: z.string().min(1),
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
  description:
    "Get a specific briefing by ID. Requires agentId query parameter to verify participation.",
  request: {
    params: z.object({
      briefingId: z.string().min(1).openapi({
        param: { name: "briefingId", in: "path" },
      }),
    }),
    query: z.object({
      agentId: z.string().min(1),
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

  // GET /briefings
  app.openapi(listBriefingsRoute, async (c) => {
    const { agentId, status } = c.req.valid("query");
    const self = AgentId(agentId);
    const events = await queryBriefingEvents(ctx);
    const all = deriveBriefings(events, self);
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
    const { agentId } = c.req.valid("query");
    const self = AgentId(agentId);
    const events = await queryBriefingEvents(ctx);
    const briefing = getBriefing(events, self, briefingId);

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
