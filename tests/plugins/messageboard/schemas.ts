// tests/plugins/messageboard/schemas.ts
// Event schemas for the messageboard test plugin.

import { z } from "@zod/zod";
import {
  CanonicalId,
  CorrelationId,
  EventId,
  ParticipantIdFromString,
  Scope,
} from "@bernays/server/core";

// Scope

export const MESSAGEBOARD_SCOPE = Scope("messageboard");
export type MessageBoardScope = typeof MESSAGEBOARD_SCOPE;

const messageboardScopeSchema = z
  .literal("messageboard")
  .transform(() => MESSAGEBOARD_SCOPE);

// Anchor shape

export const MessageBoardAnchorSchema = z.object({
  boardMessageId: z.string(),
});

export type MessageBoardAnchor = z.infer<typeof MessageBoardAnchorSchema>;

// =============================================================================
// AnchorMessageObserved
// A new root message observed on the board. Has kind:"anchor" so the
// graph machinery picks it up as a thread root.
// =============================================================================

export const MessageBoardAnchorMessageObservedSchema = z.object({
  kind: z.literal("anchor"),
  scope: messageboardScopeSchema,
  type: z.literal("AnchorMessageObserved"),
  eventId: z.uuid().transform(EventId),
  correlationId: z.uuid().transform(CorrelationId),
  timestamp: z.iso.datetime(),
  canonicalId: z.string().transform(CanonicalId),
  senderId: z.string().transform(ParticipantIdFromString),
  content: z.string(),
  anchor: MessageBoardAnchorSchema,
});

export type MessageBoardAnchorMessageObserved = z.infer<
  typeof MessageBoardAnchorMessageObservedSchema
>;

// =============================================================================
// ReplyObserved
// A reply to an existing message. Has kind:"reply" so the graph
// machinery links it to its predecessor.
// =============================================================================

export const MessageBoardReplyObservedSchema = z.object({
  kind: z.literal("reply"),
  scope: messageboardScopeSchema,
  type: z.literal("ReplyObserved"),
  eventId: z.uuid().transform(EventId),
  correlationId: z.uuid().transform(CorrelationId),
  timestamp: z.iso.datetime(),
  canonicalId: z.string().transform(CanonicalId),
  senderId: z.string().transform(ParticipantIdFromString),
  content: z.string(),
  predecessorId: z.string().transform(CanonicalId),
});

export type MessageBoardReplyObserved = z.infer<
  typeof MessageBoardReplyObservedSchema
>;

// =============================================================================
// MessageSent
// Confirmation that we posted a message. Not a graph event (no kind field).
// =============================================================================

export const MessageBoardMessageSentSchema = z.object({
  scope: messageboardScopeSchema,
  type: z.literal("MessageSent"),
  eventId: z.uuid().transform(EventId),
  correlationId: z.uuid().transform(CorrelationId),
  timestamp: z.iso.datetime(),
  canonicalId: z.string().transform(CanonicalId),
  senderId: z.string().transform(ParticipantIdFromString),
  content: z.string(),
  boardMessageId: z.string(),
});

export type MessageBoardMessageSent = z.infer<
  typeof MessageBoardMessageSentSchema
>;

// =============================================================================
// Event union
// =============================================================================

export const MessageBoardEventSchema = z.discriminatedUnion("type", [
  MessageBoardAnchorMessageObservedSchema,
  MessageBoardReplyObservedSchema,
  MessageBoardMessageSentSchema,
]);

export type MessageBoardEvent = z.infer<typeof MessageBoardEventSchema>;
