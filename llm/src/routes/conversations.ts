// llm/src/routes/conversations.ts
// Conversation CRUD routes — create, list, get, end conversations with agents

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { ServerContext } from "$/context.ts";
import {
  ConversationListResponseSchema,
  ConversationResponseSchema,
  CreateConversationBodySchema,
  ErrorSchema,
} from "$/schemas.ts";

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
    "Create a new conversation with an agent. Initiates a briefing on the target agent.",
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
  description:
    "List conversations. Filter by agent or status. Paginated.",
  request: {
    query: z.object({
      agentId: z.string().optional(),
      status: z.enum(["active", "ended", "failed"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50).openapi({
        example: 50,
      }),
      offset: z.coerce.number().int().min(0).default(0).openapi({
        example: 0,
      }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: ConversationListResponseSchema },
      },
      description: "Paginated conversation list",
    },
  },
});

const getConversationRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Conversations"],
  description: "Get a single conversation by ID.",
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
  description:
    "End a conversation. Notifies the agent and marks the conversation as ended.",
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

    try {
      const conversation = await ctx.conversations.create(body.agentId, {
        title: body.title,
        context: body.context,
      });

      return c.json(
        ConversationResponseSchema.parse({ conversation }),
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 422);
    }
  });

  // GET /conversations
  app.openapi(listConversationsRoute, (c) => {
    const { agentId, status, limit, offset } = c.req.valid("query");

    const result = ctx.conversations.list({ agentId, status, limit, offset });

    return c.json(
      ConversationListResponseSchema.parse({
        conversations: result.items,
        pagination: {
          total: result.total,
          offset: result.offset,
          limit: result.limit,
          hasMore: result.hasMore,
        },
      }),
      200,
    );
  });

  // GET /conversations/:id
  app.openapi(getConversationRoute, (c) => {
    const { id } = c.req.valid("param");
    const conversation = ctx.conversations.get(id);

    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    return c.json(
      ConversationResponseSchema.parse({ conversation }),
      200,
    );
  });

  // DELETE /conversations/:id
  app.openapi(endConversationRoute, async (c) => {
    const { id } = c.req.valid("param");

    const conversation = await ctx.conversations.end(id);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    return c.json(
      ConversationResponseSchema.parse({ conversation }),
      200,
    );
  });

  return app;
};
