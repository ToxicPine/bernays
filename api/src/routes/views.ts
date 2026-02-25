// api/src/routes/views.ts
// View routes — read derived views (inbox, threads, browsers, contacts, accounts)
//
// View payloads are platform-specific and polymorphic. The response schemas
// describe base fields accurately and use .passthrough() for platform extensions.
// Domain→wire conversion uses schema.parse() at the boundary — no casts needed.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Effect, Option } from "effect";
import {
  BrowserConfigId,
  ParticipantId as makeParticipantId,
  Scope as makeScope,
  ThreadId,
} from "@bernays/server/core";
import type { ServerContext } from "$/context.ts";
import {
  AccountListResponseSchema,
  AccountResponseSchema,
  BrowsersResponseSchema,
  ContactResponseSchema,
  ErrorSchema,
  InboxResponseSchema,
  ThreadResponseSchema,
} from "$/schemas.ts";

// =============================================================================
// Serialization — domain → wire via Zod .parse()
//
// Domain types have readonly arrays and branded string IDs.
// Wire-format Zod schemas describe the plain JSON shapes (mutable arrays,
// plain strings). We use schema.parse() at the API boundary to:
//   1. Validate the shape matches what OpenAPI promises
//   2. Strip readonly / brands — the parsed output is the schema's output type
//   3. Pass through platform-specific fields via .passthrough()
//
// No casts, no JSON.parse(JSON.stringify()), no `as any`.
// =============================================================================

// =============================================================================
// Param Schemas
// =============================================================================

const PlatformParam = z.object({
  platform: z.string().min(1).openapi({
    param: { name: "platform", in: "path" },
    example: "linkedin",
  }),
});

const PlatformAccountParam = z.object({
  platform: z.string().min(1).openapi({
    param: { name: "platform", in: "path" },
    example: "linkedin",
  }),
  id: z.string().min(1).openapi({
    param: { name: "id", in: "path" },
    example: "abc123",
  }),
});

const ThreadParam = PlatformAccountParam.extend({
  threadId: z.string().min(1).openapi({
    param: { name: "threadId", in: "path" },
    example: "thread-001",
  }),
});

const ContactParam = PlatformAccountParam.extend({
  participantId: z.string().min(1).openapi({
    param: { name: "participantId", in: "path" },
    example: "contact-456",
  }),
});

const SinceQuery = z.object({
  since: z.string().optional().openapi({ example: "2026-01-01T00:00:00Z" }),
});

// =============================================================================
// Route Definitions
// =============================================================================

const listAccountsRoute = createRoute({
  method: "get",
  path: "/{platform}/accounts",
  tags: ["Views"],
  description: "List all accounts for a platform.",
  request: { params: PlatformParam },
  responses: {
    200: {
      content: {
        "application/json": { schema: AccountListResponseSchema },
      },
      description: "List of accounts",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Unknown platform",
    },
  },
});

const getAccountRoute = createRoute({
  method: "get",
  path: "/{platform}/accounts/{id}",
  tags: ["Views"],
  description: "Get a single account by platform-scoped participant ID.",
  request: { params: PlatformAccountParam },
  responses: {
    200: {
      content: {
        "application/json": { schema: AccountResponseSchema },
      },
      description: "Account found",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Account or platform not found",
    },
  },
});

const getInboxRoute = createRoute({
  method: "get",
  path: "/{platform}/accounts/{id}/inbox",
  tags: ["Views"],
  description: "Derive the inbox view for an account by folding events.",
  request: { params: PlatformAccountParam, query: SinceQuery },
  responses: {
    200: {
      content: {
        "application/json": { schema: InboxResponseSchema },
      },
      description: "Derived inbox",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Platform or projection not found",
    },
  },
});

const getThreadRoute = createRoute({
  method: "get",
  path: "/{platform}/accounts/{id}/threads/{threadId}",
  tags: ["Views"],
  description: "Derive a thread view by folding events for a specific thread.",
  request: { params: ThreadParam, query: SinceQuery },
  responses: {
    200: {
      content: {
        "application/json": { schema: ThreadResponseSchema },
      },
      description: "Derived thread",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Thread not found",
    },
  },
});

const getBrowsersRoute = createRoute({
  method: "get",
  path: "/{platform}/accounts/{id}/browsers",
  tags: ["Views"],
  description:
    "Derive browser status for an account by folding auth/rate-limit events.",
  request: { params: PlatformAccountParam },
  responses: {
    200: {
      content: {
        "application/json": { schema: BrowsersResponseSchema },
      },
      description: "Derived browser status",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Account not found",
    },
  },
});

const getContactRoute = createRoute({
  method: "get",
  path: "/{platform}/accounts/{id}/contacts/{participantId}",
  tags: ["Views"],
  description: "Derive contact info for a participant from observed events.",
  request: { params: ContactParam },
  responses: {
    200: {
      content: {
        "application/json": { schema: ContactResponseSchema },
      },
      description: "Derived contact",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Contact not found",
    },
  },
});

// =============================================================================
// App
// =============================================================================

export const viewsRoutes = (ctx: ServerContext) => {
  const app = new OpenAPIHono();

  const resolvePlatform = (platform: string) => {
    const scope = makeScope(platform);
    const def = ctx.registry.get(scope);
    if (!def) return undefined;
    const projection = ctx.projections.get(scope);
    const accountStore = ctx.accountStores.get(platform);
    return { def, projection, accountStore };
  };

  // GET /:platform/accounts
  app.openapi(listAccountsRoute, async (c) => {
    const { platform } = c.req.valid("param");
    const resolved = resolvePlatform(platform);
    if (!resolved?.accountStore) {
      return c.json({ error: "Unknown Platform" }, 404);
    }
    const accounts = await Effect.runPromise(resolved.accountStore.list());
    return c.json(
      AccountListResponseSchema.parse({ accounts }),
      200,
    );
  });

  // GET /:platform/accounts/:id
  app.openapi(getAccountRoute, async (c) => {
    const { platform, id } = c.req.valid("param");
    const resolved = resolvePlatform(platform);
    if (!resolved?.accountStore) {
      return c.json({ error: "Unknown Platform" }, 404);
    }
    const participantId = makeParticipantId(platform, id);
    const result = await Effect.runPromise(
      resolved.accountStore.get(participantId),
    );
    if (Option.isNone(result)) {
      return c.json({ error: "Account Not Found" }, 404);
    }
    return c.json(
      AccountResponseSchema.parse({ account: result.value }),
      200,
    );
  });

  // GET /:platform/accounts/:id/inbox
  app.openapi(getInboxRoute, async (c) => {
    const { platform, id } = c.req.valid("param");
    const { since } = c.req.valid("query");
    const resolved = resolvePlatform(platform);
    if (!resolved?.projection) {
      return c.json({ error: "Unknown Platform Or No Projection" }, 404);
    }
    const participantId = makeParticipantId(platform, id);
    const events = await Effect.runPromise(resolved.projection.query(since));
    const { behavior } = resolved.def;
    const state = behavior.emptyState();
    for (const event of events) behavior.applyEvent(state, event);
    const inbox = behavior.materializeInbox(state, participantId);
    return c.json(
      InboxResponseSchema.parse({ inbox }),
      200,
    );
  });

  // GET /:platform/accounts/:id/threads/:threadId
  app.openapi(getThreadRoute, async (c) => {
    const { platform, threadId: rawThreadId } = c.req.valid("param");
    const { since } = c.req.valid("query");
    const resolved = resolvePlatform(platform);
    if (!resolved?.projection) {
      return c.json({ error: "Unknown Platform Or No Projection" }, 404);
    }
    const threadId = ThreadId(rawThreadId);
    const events = await Effect.runPromise(resolved.projection.query(since));
    const { behavior } = resolved.def;
    const state = behavior.emptyState();
    for (const event of events) behavior.applyEvent(state, event);
    const thread = behavior.materializeThread(state, threadId);
    if (!thread) {
      return c.json({ error: "Thread Not Found" }, 404);
    }
    return c.json(
      ThreadResponseSchema.parse({ thread }),
      200,
    );
  });

  // GET /:platform/accounts/:id/browsers
  app.openapi(getBrowsersRoute, async (c) => {
    const { platform, id } = c.req.valid("param");
    const resolved = resolvePlatform(platform);
    if (!resolved?.projection || !resolved.accountStore) {
      return c.json({ error: "Unknown Platform Or Missing Stores" }, 404);
    }
    const participantId = makeParticipantId(platform, id);
    const accountOpt = await Effect.runPromise(
      resolved.accountStore.get(participantId),
    );
    if (Option.isNone(accountOpt)) {
      return c.json({ error: "Account Not Found" }, 404);
    }
    const account = accountOpt.value;
    const events = await Effect.runPromise(resolved.projection.query());
    const { behavior } = resolved.def;
    const state = behavior.emptyState();
    for (const event of events) behavior.applyEvent(state, event);
    // TODO: wire in BrowserPool for live running status
    const runningConfigIds = new Set<ReturnType<typeof BrowserConfigId>>();
    const browsers = behavior.materializeBrowsers(
      state,
      account,
      runningConfigIds,
    );
    return c.json(
      BrowsersResponseSchema.parse({ browsers }),
      200,
    );
  });

  // GET /:platform/accounts/:id/contacts/:participantId
  app.openapi(getContactRoute, async (c) => {
    const { platform, participantId: rawParticipantId } = c.req.valid("param");
    const resolved = resolvePlatform(platform);
    if (!resolved?.projection) {
      return c.json({ error: "Unknown Platform Or No Projection" }, 404);
    }
    const { behavior } = resolved.def;
    if (!behavior.materializeContact) {
      return c.json(
        { error: "Platform Does Not Support Contact Derivation" },
        404,
      );
    }
    const contactId = makeParticipantId(platform, rawParticipantId);
    const events = await Effect.runPromise(resolved.projection.query());
    const state = behavior.emptyState();
    for (const event of events) behavior.applyEvent(state, event);
    const contact = behavior.materializeContact(state, contactId);
    if (!contact) {
      return c.json({ error: "Contact Not Found" }, 404);
    }
    return c.json(
      ContactResponseSchema.parse({ contact }),
      200,
    );
  });

  return app;
};
