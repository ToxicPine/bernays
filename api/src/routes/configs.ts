// api/src/routes/configs.ts
// Browser config routes — CRUD for browser configurations

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Effect, Option } from "effect";
import { BrowserConfigId } from "@bernays/server/core";
import type { ServerContext } from "$/context.ts";
import {
  BrowserConfigBodySchema,
  ConfigListResponseSchema,
  ConfigResponseSchema,
  ErrorSchema,
  OkSchema,
} from "$/schemas.ts";

// =============================================================================
// Route Definitions
// =============================================================================

const IdParam = z.object({
  id: z.string().min(1).openapi({
    param: { name: "id", in: "path" },
    example: "my-browser-config",
  }),
});

const listConfigsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Configs"],
  description: "List all browser configurations.",
  responses: {
    200: {
      content: {
        "application/json": { schema: ConfigListResponseSchema },
      },
      description: "List of browser configs",
    },
  },
});

const getConfigRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Configs"],
  description: "Get a single browser configuration by ID.",
  request: { params: IdParam },
  responses: {
    200: {
      content: {
        "application/json": { schema: ConfigResponseSchema },
      },
      description: "Browser config found",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Config not found",
    },
  },
});

const upsertConfigRoute = createRoute({
  method: "put",
  path: "/{id}",
  tags: ["Configs"],
  description:
    "Create or update a browser configuration. The ID is taken from the URL path.",
  request: {
    params: IdParam,
    body: {
      content: { "application/json": { schema: BrowserConfigBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: ConfigResponseSchema },
      },
      description: "Config created or updated",
    },
    422: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Validation failed",
    },
  },
});

const deleteConfigRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Configs"],
  description: "Remove a browser configuration by ID.",
  request: { params: IdParam },
  responses: {
    200: {
      content: { "application/json": { schema: OkSchema } },
      description: "Config removed",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Config not found",
    },
  },
});

// =============================================================================
// App
// =============================================================================

export const configsRoutes = (ctx: ServerContext) => {
  const app = new OpenAPIHono();

  // GET /configs
  app.openapi(listConfigsRoute, async (c) => {
    const result = await Effect.runPromiseExit(ctx.configStore.list());
    if (result._tag === "Failure") {
      return c.json(ConfigListResponseSchema.parse({ configs: [] }), 200);
    }
    return c.json(
      ConfigListResponseSchema.parse({ configs: result.value }),
      200,
    );
  });

  // GET /configs/:id
  app.openapi(getConfigRoute, async (c) => {
    const { id } = c.req.valid("param");
    const configId = BrowserConfigId(id);
    const result = await Effect.runPromiseExit(ctx.configStore.get(configId));

    if (result._tag === "Failure") {
      return c.json({ error: "Failed To Get Config" }, 404);
    }

    if (Option.isNone(result.value)) {
      return c.json({ error: "Config Not Found" }, 404);
    }

    return c.json(
      ConfigResponseSchema.parse({ config: result.value.value }),
      200,
    );
  });

  // PUT /configs/:id
  app.openapi(upsertConfigRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const config = {
      id: BrowserConfigId(id),
      context: body.context,
      proxy: body.proxy,
    };

    const result = await Effect.runPromiseExit(ctx.configStore.upsert(config));

    if (result._tag === "Failure") {
      return c.json({ error: "Failed To Upsert Config" }, 422);
    }

    return c.json(ConfigResponseSchema.parse({ config }), 200);
  });

  // DELETE /configs/:id
  app.openapi(deleteConfigRoute, async (c) => {
    const { id } = c.req.valid("param");
    const configId = BrowserConfigId(id);
    const result = await Effect.runPromiseExit(
      ctx.configStore.remove(configId),
    );

    if (result._tag === "Failure") {
      return c.json({ error: "Failed To Remove Config" }, 404);
    }

    if (!result.value) {
      return c.json({ error: "Config Not Found" }, 404);
    }

    return c.json({ ok: true as const }, 200);
  });

  return app;
};
