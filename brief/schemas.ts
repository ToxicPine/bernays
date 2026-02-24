// brief/schemas.ts
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

// =============================================================================
// Briefings (exposed as "conversations" to the user)
// =============================================================================

const BriefingMessageSchema = z
  .object({
    sender: z.string(),
    content: z.string(),
    timestamp: z.string(),
  })
  .openapi("BriefingMessage");

export const BriefingViewSchema = z
  .object({
    briefingId: z.string(),
    fromAgent: z.string(),
    toAgent: z.string(),
    topic: z.string(),
    status: z.enum(["requested", "declined", "active", "ended"]),
    messages: z.array(BriefingMessageSchema),
    context: z.record(z.string(), z.unknown()).optional(),
    requestedAt: z.string(),
    scheduledAt: z.string().optional(),
    acceptedAt: z.string().optional(),
    endedBy: z.string().optional(),
    endedAt: z.string().optional(),
    reason: z.string().optional(),
    summary: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("BriefingView");

export const CreateConversationBodySchema = z
  .object({
    agentId: z.string().min(1),
    topic: z.string().min(1),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("CreateConversationBody");

export const ConversationResponseSchema = z
  .object({
    briefing: BriefingViewSchema,
  })
  .openapi("ConversationResponse");

export const ConversationListResponseSchema = z
  .object({
    briefings: z.array(BriefingViewSchema),
  })
  .openapi("ConversationListResponse");

export const SendMessageBodySchema = z
  .object({
    content: z.string().min(1),
  })
  .openapi("SendMessageBody");

export const SendMessageResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("SendMessageResponse");

export const MessageListResponseSchema = z
  .object({
    messages: z.array(BriefingMessageSchema),
  })
  .openapi("MessageListResponse");
