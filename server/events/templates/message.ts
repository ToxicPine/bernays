// events/templates/message.ts
// Template for reply message events

import { z } from "@zod/zod";
import {
  CanonicalId,
  CorrelationId,
  EventId,
  ParticipantIdFromString,
} from "$/core/mod.ts";

/**
 * Base schema for reply message events.
 * A reply references its predecessor, forming a message graph.
 *
 * Platforms extend this and override `type` with their scoped version.
 */
export const MessageObservedBase = z.object({
  kind: z.literal("reply").default("reply"),
  eventId: z.uuid().default(() => crypto.randomUUID()).transform(EventId),
  correlationId: z.uuid().default(() => crypto.randomUUID()).transform(
    CorrelationId,
  ),
  timestamp: z.iso.datetime().default(() => new Date().toISOString()),
  canonicalId: z.string().transform(CanonicalId),
  senderId: z.string().transform(ParticipantIdFromString),
  predecessorId: z.string().transform(CanonicalId),
  content: z.string().optional(),
  // scope, type: platforms add these
});

export type MessageObservedBase = z.infer<typeof MessageObservedBase>;
