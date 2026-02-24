// brief/routes/messages.ts
// Message routes — send messages and list messages in a conversation

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Effect, Option } from "effect";
import type { ServerContext } from "../context.ts";
import {
  ErrorSchema,
  MessageListResponseSchema,
  SendMessageBodySchema,
  SendMessageResponseSchema,
} from "../schemas.ts";

// =============================================================================
// Route Definitions
// =============================================================================

const ConversationIdParam = z.object({
  id: z.string().min(1).openapi({
    param: { name: "id", in: "path" },
    description: "Briefing ID (conversation ID)",
  }),
});

const sendMessageRoute = createRoute({
  method: "post",
  path: "/{id}/messages",
  tags: ["Messages"],
  description: "Send a message in a conversation.",
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
    "List messages in a conversation, ordered by timestamp ascending.",
  request: {
    params: ConversationIdParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: MessageListResponseSchema },
      },
      description: "Message list",
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

export const messagesRoutes = (ctx: ServerContext) => {
  const app = new OpenAPIHono();

  // POST /conversations/:id/messages
  app.openapi(sendMessageRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await Effect.runPromiseExit(
      ctx.briefing.send(id, body.content),
    );

    if (result._tag === "Failure") {
      // Check if it's a not-found or invalid-state
      const briefing = await Effect.runPromise(ctx.briefing.get(id));
      if (Option.isNone(briefing)) {
        return c.json({ error: "Conversation not found" }, 404);
      }
      return c.json({ error: "Cannot send message in current state" }, 422);
    }

    return c.json(
      SendMessageResponseSchema.parse({ ok: true as const }),
      201,
    );
  });

  // GET /conversations/:id/messages
  app.openapi(listMessagesRoute, async (c) => {
    const { id } = c.req.valid("param");

    const briefing = await Effect.runPromise(ctx.briefing.get(id));

    if (Option.isNone(briefing)) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    return c.json(
      MessageListResponseSchema.parse({ messages: briefing.value.messages }),
      200,
    );
  });

  return app;
};
