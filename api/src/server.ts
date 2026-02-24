// api/src/server.ts
// Hono application — mounts routes, middleware, and OpenAPI spec

import { OpenAPIHono } from "@hono/zod-openapi";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import type { ServerContext } from "$/context.ts";
import { eventsRoutes } from "$/routes/events.ts";
import { viewsRoutes } from "$/routes/views.ts";
import { configsRoutes } from "$/routes/configs.ts";
import { briefingsRoutes } from "$/routes/briefings.ts";

// =============================================================================
// App Factory
// =============================================================================

export const createApp = (ctx: ServerContext) => {
  const app = new OpenAPIHono();

  // Middleware
  app.use("*", logger());
  app.use("*", cors());

  // Health check
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      platforms: ctx.registry.platforms.map((p) => p.scope),
    }),
  );

  // Mount routes
  app.route("/events", eventsRoutes(ctx));
  app.route("/views", viewsRoutes(ctx));
  app.route("/configs", configsRoutes(ctx));
  app.route("/briefings", briefingsRoutes(ctx));

  // OpenAPI JSON spec
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Bernays API",
      version: "0.1.0",
      description:
        "Event bus and control plane for the bernays sockpuppet runtime.",
    },
  });

  return app;
};
