// llm/src/server.ts
// Hono application — mounts routes, middleware, and OpenAPI spec

import { OpenAPIHono } from "@hono/zod-openapi";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import type { ServerContext } from "$/context.ts";
import { conversationsRoutes } from "$/routes/conversations.ts";
import { messagesRoutes } from "$/routes/messages.ts";

// =============================================================================
// App Factory
// =============================================================================

export const createApp = (ctx: ServerContext) => {
  const app = new OpenAPIHono();

  // Middleware
  app.use("*", logger());
  app.use("*", cors());

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Mount routes
  app.route("/conversations", conversationsRoutes(ctx));
  app.route("/conversations", messagesRoutes(ctx));

  // OpenAPI JSON spec
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Bernays LLM API",
      version: "0.1.0",
      description:
        "User-facing API for multi-threaded conversations with bernays agents via the briefing system.",
    },
  });

  return app;
};
