// src/events/briefing.ts
// Briefing events — agent-to-agent structured conversations
//
// Briefings are cross-cutting (not tied to any platform). Both agents
// record events locally in the "briefing" scope. The lifecycle is:
//
//   BriefingRequested → BriefingAccepted/BriefingDeclined
//   BriefingMessageSent (either agent, repeated)
//   BriefingEnded (either agent)

import { z } from "@zod/zod";
import { CorrelationMetadataSchema } from "./metadata.ts";
import { BriefingId } from "$/core/branded.ts";
import { BRIEFING_SCOPE } from "$/core/scope.ts";

export { BRIEFING_SCOPE };

// Helper for scope literal with transform
const briefingScopeSchema = z
  .literal("briefing")
  .transform(() => BRIEFING_SCOPE);

// =============================================================================
// Briefing Requested
// =============================================================================

/**
 * Recorded by the initiator when requesting a briefing.
 * Also recorded by the recipient when receiving the request via API.
 */
export const BriefingRequestedSchema = CorrelationMetadataSchema.extend({
  scope: briefingScopeSchema,
  type: z.literal("BriefingRequested"),
  briefingId: z.string().transform(BriefingId),
  /** The agent that initiated the briefing (this instance's identity) */
  fromAgent: z.string().min(1),
  /** The target agent's address (e.g., "agent-b.flycast") */
  toAgent: z.string().min(1),
  /** Short description of what the briefing is about */
  topic: z.string().min(1),
  /** When the briefing is scheduled to occur (ISO 8601). If omitted, immediate. */
  scheduledAt: z.iso.datetime().optional(),
  /** Optional structured context to pass to the recipient */
  context: z.record(z.string(), z.unknown()).optional(),
});

export type BriefingRequested = z.infer<typeof BriefingRequestedSchema>;

// =============================================================================
// Briefing Accepted
// =============================================================================

export const BriefingAcceptedSchema = CorrelationMetadataSchema.extend({
  scope: briefingScopeSchema,
  type: z.literal("BriefingAccepted"),
  briefingId: z.string().transform(BriefingId),
  fromAgent: z.string().min(1),
  toAgent: z.string().min(1),
});

export type BriefingAccepted = z.infer<typeof BriefingAcceptedSchema>;

// =============================================================================
// Briefing Declined
// =============================================================================

export const BriefingDeclinedSchema = CorrelationMetadataSchema.extend({
  scope: briefingScopeSchema,
  type: z.literal("BriefingDeclined"),
  briefingId: z.string().transform(BriefingId),
  fromAgent: z.string().min(1),
  toAgent: z.string().min(1),
  reason: z.string().optional(),
});

export type BriefingDeclined = z.infer<typeof BriefingDeclinedSchema>;

// =============================================================================
// Briefing Message Sent
// =============================================================================

/**
 * A message within an active briefing. Either agent can send.
 */
export const BriefingMessageSentSchema = CorrelationMetadataSchema.extend({
  scope: briefingScopeSchema,
  type: z.literal("BriefingMessageSent"),
  briefingId: z.string().transform(BriefingId),
  /** Which agent sent this message */
  sender: z.string().min(1),
  content: z.string().min(1),
});

export type BriefingMessageSent = z.infer<typeof BriefingMessageSentSchema>;

// =============================================================================
// Briefing Ended
// =============================================================================

export const BriefingEndedSchema = CorrelationMetadataSchema.extend({
  scope: briefingScopeSchema,
  type: z.literal("BriefingEnded"),
  briefingId: z.string().transform(BriefingId),
  /** Which agent ended the briefing */
  endedBy: z.string().min(1),
  reason: z.string().optional(),
  /** Optional structured summary of the briefing outcome */
  summary: z.record(z.string(), z.unknown()).optional(),
});

export type BriefingEnded = z.infer<typeof BriefingEndedSchema>;

// =============================================================================
// Union
// =============================================================================

export const BriefingEventSchema = z.discriminatedUnion("type", [
  BriefingRequestedSchema,
  BriefingAcceptedSchema,
  BriefingDeclinedSchema,
  BriefingMessageSentSchema,
  BriefingEndedSchema,
]);

export type BriefingEvent = z.infer<typeof BriefingEventSchema>;
