// brief/routes/conversations.ts
// Conversation CRUD routes — thin wrappers over BriefingService

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Effect, Option } from "effect";
import type { ServerContext } from "../context.ts";
import {
  ConversationListResponseSchema,
  ConversationResponseSchema,
  CreateConversationBodySchema,
  ErrorSchema,
} from "../schemas.ts";

// =============================================================================
// Route Definitions
// =============================================================================

const IdParam = z.object({
  id: z.string().min(1).openapi({
    param: { name: "id", in: "path" },
  }),
});

const createConversationRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Conversations"],
  description:
    "Create a new conversation with an agent by initiating a briefing.",
  request: {
    body: {
      content: {
        "application/json": { schema: CreateConversationBodySchema },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: ConversationResponseSchema },
      },
      description: "Conversation created",
    },
    422: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Failed to create conversation",
    },
  },
});

const listConversationsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Conversations"],
  description: "List all conversations. Optionally filter by status.",
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
        "application/json": { schema: ConversationListResponseSchema },
      },
      description: "List of conversations",
    },
  },
});

const getConversationRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Conversations"],
  description: "Get a single conversation by briefing ID.",
  request: { params: IdParam },
  responses: {
    200: {
      content: {
        "application/json": { schema: ConversationResponseSchema },
      },
      description: "Conversation found",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Conversation not found",
    },
  },
});

const endConversationRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Conversations"],
  description: "End a conversation.",
  request: { params: IdParam },
  responses: {
    200: {
      content: {
        "application/json": { schema: ConversationResponseSchema },
      },
      description: "Conversation ended",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Conversation not found",
    },
    422: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Cannot end conversation in current state",
    },
  },
});

// =============================================================================
// App
// =============================================================================

export const conversationsRoutes = (ctx: ServerContext) => {
  const app = new OpenAPIHono();

  // POST /conversations
  app.openapi(createConversationRoute, async (c) => {
    const body = c.req.valid("json");

    const result = await Effect.runPromiseExit(
      ctx.briefing.request(body.agentId, body.topic, {
        context: body.context,
      }),
    );

    if (result._tag === "Failure") {
      return c.json({ error: "Failed to create conversation" }, 422);
    }

    return c.json(
      ConversationResponseSchema.parse({ briefing: result.value }),
      201,
    );
  });

  // GET /conversations
  app.openapi(listConversationsRoute, async (c) => {
    const { status } = c.req.valid("query");

    let briefings = await Effect.runPromise(ctx.briefing.all);

    if (status) {
      briefings = briefings.filter((b) => b.status === status);
    }

    return c.json(
      ConversationListResponseSchema.parse({ briefings }),
      200,
    );
  });

  // GET /conversations/:id
  app.openapi(getConversationRoute, async (c) => {
    const { id } = c.req.valid("param");

    const briefing = await Effect.runPromise(ctx.briefing.get(id));

    if (Option.isNone(briefing)) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    return c.json(
      ConversationResponseSchema.parse({ briefing: briefing.value }),
      200,
    );
  });

  // DELETE /conversations/:id
  app.openapi(endConversationRoute, async (c) => {
    const { id } = c.req.valid("param");

    const result = await Effect.runPromiseExit(ctx.briefing.end(id));

    if (result._tag === "Failure") {
      // Distinguish not-found from invalid-state
      const briefing = await Effect.runPromise(ctx.briefing.get(id));
      if (Option.isNone(briefing)) {
        return c.json({ error: "Conversation not found" }, 404);
      }
      return c.json({ error: "Cannot end conversation in current state" }, 422);
    }

    return c.json(
      ConversationResponseSchema.parse({ briefing: result.value }),
      200,
    );
  });

  return app;
};
