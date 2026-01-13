// events/templates/anchor-message.ts
// Template for anchor (root) message events

import { z } from "@zod/zod";
import type { CanonicalId, CorrelationId, EventId } from "$/core/branded.ts";

/**
 * Base schema for anchor message events.
 * An anchor message establishes a thread - it's the root message.
 *
 * Platforms extend this and override `type` with their namespaced version
 * (e.g., `linkedin:AnchorMessageObserved`) and define their own `anchor` shape.
 */
export const AnchorMessageObservedBase = z.object({
  kind: z.literal("anchor"),
  eventId: z.uuid().transform((val) => val as EventId),
  correlationId: z.uuid().transform((val) => val as CorrelationId),
  timestamp: z.iso.datetime(),
  canonicalId: z.string().transform((val) => val as CanonicalId),
  senderId: z.string(),
  content: z.string().optional(),
});

export type AnchorMessageObservedBase = z.infer<
  typeof AnchorMessageObservedBase
>;
