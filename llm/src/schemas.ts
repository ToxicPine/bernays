// llm/src/schemas.ts
// Wire-format Zod schemas for API request/response validation and OpenAPI generation.

import { z } from "@hono/zod-openapi";

// =============================================================================
// Common
// =============================================================================

export const ErrorSchema = z
  .object({
    error: z.string(),
  })
  .openapi("Error");

export const PaginationSchema = z
  .object({
    total: z.number().int(),
    offset: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
  })
  .openapi("Pagination");

// =============================================================================
// Conversations
// =============================================================================

export const ConversationSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    briefingId: z.string().nullable(),
    title: z.string(),
    status: z.enum(["active", "ended", "failed"]),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Conversation");

export const CreateConversationBodySchema = z
  .object({
    agentId: z.string().min(1),
    title: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("CreateConversationBody");

export const ConversationResponseSchema = z
  .object({
    conversation: ConversationSchema,
  })
  .openapi("ConversationResponse");

export const ConversationListResponseSchema = z
  .object({
    conversations: z.array(ConversationSchema),
    pagination: PaginationSchema,
  })
  .openapi("ConversationListResponse");

// =============================================================================
// Messages
// =============================================================================

export const MessageSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .openapi("Message");

export const SendMessageBodySchema = z
  .object({
    content: z.string().min(1),
  })
  .openapi("SendMessageBody");

export const SendMessageResponseSchema = z
  .object({
    userMessage: MessageSchema,
    assistantMessage: MessageSchema.nullable(),
  })
  .openapi("SendMessageResponse");

export const MessageListResponseSchema = z
  .object({
    messages: z.array(MessageSchema),
    pagination: PaginationSchema,
  })
  .openapi("MessageListResponse");

// =============================================================================
// Webhook — for agents to push responses back
// =============================================================================

export const AgentMessageBodySchema = z
  .object({
    briefingId: z.string().min(1),
    content: z.string().min(1),
    sender: z.string().min(1),
  })
  .openapi("AgentMessageBody");

export const AgentMessageResponseSchema = z
  .object({
    ok: z.literal(true),
    message: MessageSchema,
  })
  .openapi("AgentMessageResponse");
