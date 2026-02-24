// api/src/schemas.ts
// Wire-format Zod schemas for API request/response validation and OpenAPI generation.
//
// These describe the JSON shapes that go over the wire. Domain types use readonly
// arrays and branded strings, but JSON serialization strips both. These schemas
// reflect the actual wire format: plain strings, mutable arrays.

import { z } from "@hono/zod-openapi";

// =============================================================================
// Common
// =============================================================================

export const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi("Error");

export const OkSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("Ok");

export const PaginationSchema = z
  .object({
    total: z.number().int(),
    offset: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
  })
  .openapi("Pagination");

// =============================================================================
// Events
// =============================================================================

export const EventPayloadSchema = z
  .object({
    scope: z.string().min(1),
    type: z.string().min(1),
    eventId: z.string(),
    timestamp: z.string(),
  })
  .passthrough()
  .openapi("EventPayload");

export const SubmitEventResponseSchema = z
  .object({
    ok: z.literal(true),
    event: EventPayloadSchema,
  })
  .openapi("SubmitEventResponse");

export const BatchResultItemSchema = z
  .object({
    ok: z.boolean(),
    eventId: z.string().optional(),
    error: z.string().optional(),
  })
  .openapi("BatchResultItem");

export const BatchSubmitResponseSchema = z
  .object({
    results: z.array(BatchResultItemSchema),
  })
  .openapi("BatchSubmitResponse");

export const EventsListResponseSchema = z
  .object({
    events: z.array(EventPayloadSchema),
    pagination: PaginationSchema,
  })
  .openapi("EventsListResponse");

// =============================================================================
// Configs — wire format for BrowserConfig / ProxyConfig
// =============================================================================

export const ProxyConfigSchema = z
  .object({
    server: z.string(),
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .openapi("ProxyConfig");

export const BrowserConfigSchema = z
  .object({
    id: z.string(),
    context: z.string(),
    proxy: ProxyConfigSchema.optional(),
  })
  .openapi("BrowserConfig");

export const BrowserConfigBodySchema = z
  .object({
    context: z.string().min(1),
    proxy: ProxyConfigSchema.optional(),
  })
  .openapi("BrowserConfigBody");

export const ConfigListResponseSchema = z
  .object({
    configs: z.array(BrowserConfigSchema),
  })
  .openapi("ConfigListResponse");

export const ConfigResponseSchema = z
  .object({
    config: BrowserConfigSchema,
  })
  .openapi("ConfigResponse");

// =============================================================================
// Views — wire format for derived view types
//
// View payloads are platform-specific and polymorphic. Platforms extend the base
// shapes with extra fields. We use .passthrough() on base schemas so platform-
// specific fields survive validation and appear in OpenAPI as "additional
// properties allowed". The base fields are documented accurately.
// =============================================================================

// Browser binding: { configId: string, metadata: Record<string, unknown> }
export const BrowserBindingSchema = z
  .object({
    configId: z.string(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .openapi("BrowserBinding");

// Account: at minimum { id, browserBindings }, platforms add more
export const AccountSchema = z
  .object({
    id: z.string(),
    browserBindings: z.array(BrowserBindingSchema),
  })
  .passthrough()
  .openapi("Account");

export const AccountListResponseSchema = z
  .object({
    accounts: z.array(AccountSchema),
  })
  .openapi("AccountListResponse");

export const AccountResponseSchema = z
  .object({
    account: AccountSchema,
  })
  .openapi("AccountResponse");

// Participant in a thread
export const ParticipantSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
  })
  .openapi("Participant");

// Message in a thread
export const MessageSchema = z
  .object({
    id: z.string(),
    senderId: z.string(),
    content: z.string().optional(),
    timestamp: z.string(),
  })
  .openapi("Message");

// Thread view: base fields + platform-specific via passthrough
export const ThreadSchema = z
  .object({
    threadId: z.string(),
    messages: z.array(MessageSchema),
    participants: z.array(ParticipantSchema),
    anchor: z.unknown(),
  })
  .passthrough()
  .openapi("Thread");

export const ThreadResponseSchema = z
  .object({
    thread: ThreadSchema,
  })
  .openapi("ThreadResponse");

// Inbox view: byThreadId map + platform-specific via passthrough
export const InboxSchema = z
  .object({
    byThreadId: z.record(z.string(), z.unknown()),
  })
  .passthrough()
  .openapi("Inbox");

export const InboxResponseSchema = z
  .object({
    inbox: InboxSchema,
  })
  .openapi("InboxResponse");

// Bound browser view: base fields + platform-specific via passthrough
export const BoundBrowserSchema = z
  .object({
    configId: z.string(),
    isRunning: z.boolean(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .passthrough()
  .openapi("BoundBrowser");

export const BrowsersResponseSchema = z
  .object({
    browsers: z.array(BoundBrowserSchema),
  })
  .openapi("BrowsersResponse");

// Contact: base fields + platform-specific via passthrough
export const ContactSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
  })
  .passthrough()
  .openapi("Contact");

export const ContactResponseSchema = z
  .object({
    contact: ContactSchema,
  })
  .openapi("ContactResponse");
