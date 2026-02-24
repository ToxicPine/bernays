// llm/src/routes/messages.ts
// Message routes — send messages in a conversation + paginated listing
// Also includes the agent webhook endpoint for receiving agent responses.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { ServerContext } from "$/context.ts";
import { createMessage as dbCreateMessage } from "$/db/messages.ts";
import {
  AgentMessageBodySchema,
  AgentMessageResponseSchema,
  ErrorSchema,
  MessageListResponseSchema,
  SendMessageBodySchema,
  SendMessageResponseSchema,
} from "$/schemas.ts";

// =============================================================================
// Route Definitions
// =============================================================================

const ConversationIdParam = z.object({
  id: z.string().min(1).openapi({
    param: { name: "id", in: "path" },
    description: "Conversation ID",
  }),
});

const sendMessageRoute = createRoute({
  method: "post",
  path: "/{id}/messages",
  tags: ["Messages"],
  description:
    "Send a message in a conversation. The message is recorded locally and forwarded to the agent via the briefing system.",
  request: {
    params: ConversationIdParam,
    body: {
      content: { "application/json": { schema: SendMessageBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: SendMessageResponseSchema },
      },
      description: "Message sent",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Conversation not found",
    },
    422: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Cannot send message",
    },
  },
});

const listMessagesRoute = createRoute({
  method: "get",
  path: "/{id}/messages",
  tags: ["Messages"],
  description:
    "List messages in a conversation. Paginated, ordered by creation time ascending.",
  request: {
    params: ConversationIdParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50).openapi({
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
        "application/json": { schema: MessageListResponseSchema },
      },
      description: "Paginated message list",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Conversation not found",
    },
  },
});

const agentMessageRoute = createRoute({
  method: "post",
  path: "/webhook/message",
  tags: ["Webhook"],
  description:
    "Webhook endpoint for agents to push messages back. The agent calls this when it has a response ready.",
  request: {
    body: {
      content: { "application/json": { schema: AgentMessageBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": { schema: AgentMessageResponseSchema },
      },
      description: "Agent message recorded",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Conversation not found for briefing ID",
    },
  },
});

// =============================================================================
// App
// =============================================================================

export const messagesRoutes = (ctx: ServerContext) => {
  const app = new OpenAPIHono();

  // POST /conversations/:id/messages
  app.openapi(sendMessageRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Verify conversation exists
    const conversation = ctx.conversations.get(id);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    try {
      const result = await ctx.conversations.sendMessage(id, body.content);

      return c.json(
        SendMessageResponseSchema.parse({
          userMessage: result.userMessage,
          assistantMessage: result.assistantMessage,
        }),
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 422);
    }
  });

  // GET /conversations/:id/messages
  app.openapi(listMessagesRoute, (c) => {
    const { id } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");

    // Verify conversation exists
    const conversation = ctx.conversations.get(id);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    const result = ctx.conversations.listMessages({
      conversationId: id,
      limit,
      offset,
    });

    return c.json(
      MessageListResponseSchema.parse({
        messages: result.items,
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

  // POST /webhook/message — agent pushes a response back
  app.openapi(agentMessageRoute, (c) => {
    const body = c.req.valid("json");

    // Find conversation by briefing ID
    // We need to search through conversations — for now use a simple scan.
    // In production, add an index or lookup table.
    const conversations = ctx.conversations.list({
      limit: 1000,
      offset: 0,
    });

    const conversation = conversations.items.find(
      (conv) => conv.briefingId === body.briefingId,
    );

    if (!conversation) {
      return c.json(
        { error: `No conversation found for briefing: ${body.briefingId}` },
        404,
      );
    }

    // Record the agent's message as an assistant message
    const message = dbCreateMessage(ctx.db, {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      content: body.content,
      metadata: { sender: body.sender },
    });

    return c.json(
      AgentMessageResponseSchema.parse({ ok: true as const, message }),
      201,
    );
  });

  return app;
};
