// events/templates/anchor-message.ts
// Template for anchor (root) message events

import { z } from "@zod/zod";
import {
  CanonicalId,
  CorrelationId,
  EventId,
  ParticipantIdFromString,
} from "$/core/mod.ts";

/**
 * Base schema for anchor message events.
 * An anchor message establishes a thread - it's the root message.
 *
 * Platforms extend this and override `type` with their namespaced version
 * (e.g., `linkedin:AnchorMessageObserved`) and define their own `anchor` shape.
 */
export const AnchorMessageObservedBase = z.object({
  kind: z.literal("anchor").default("anchor"),
  eventId: z.uuid().default(() => crypto.randomUUID()).transform(EventId),
  correlationId: z.uuid().default(() => crypto.randomUUID()).transform(
    CorrelationId,
  ),
  timestamp: z.iso.datetime().default(() => new Date().toISOString()),
  canonicalId: z.string().transform(CanonicalId),
  senderId: z.string().transform(ParticipantIdFromString),
  content: z.string().optional(),
});

export type AnchorMessageObservedBase = z.infer<
  typeof AnchorMessageObservedBase
>;
