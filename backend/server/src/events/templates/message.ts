// events/templates/message.ts
// Template for reply message events

import { z } from "@zod/zod";
import type { CanonicalId, CorrelationId, EventId } from "$/core/branded.ts";

/**
 * Base schema for reply message events.
 * A reply references its predecessor, forming a message graph.
 *
 * Platforms extend this and override `type` with their namespaced version.
 */
export const MessageObservedBase = z.object({
  kind: z.literal("reply"),
  eventId: z.uuid().transform((val) => val as EventId),
  correlationId: z.uuid().transform((val) => val as CorrelationId),
  timestamp: z.iso.datetime(),
  canonicalId: z.string().transform((val) => val as CanonicalId),
  senderId: z.string(),
  predecessorId: z.string().transform((val) => val as CanonicalId),
  content: z.string().optional(),
  // type: platforms add their namespaced literal (e.g., "linkedin:MessageObserved")
});

export type MessageObservedBase = z.infer<typeof MessageObservedBase>;
