// src/events/metadata.ts
// Correlation metadata for event sourcing

import { z } from "@zod/zod";
import { StorableEventSchema } from "$/store/mod.ts";
import { CausationId, CorrelationId, IntentId } from "$/core/branded.ts";

/**
 * Extended event schema with correlation/causation for tracing.
 * All domain events should extend this schema.
 *
 * Extends StorableEvent with:
 * - correlationId: Links related events across the system
 * - causationId: Links cause and effect (optional)
 * - intentId: Associates event with originating intent (optional)
 */
export const CorrelationMetadataSchema = StorableEventSchema.extend({
  correlationId: z.uuid().default(() => crypto.randomUUID()).transform(
    CorrelationId,
  ),
  causationId: z.uuid().transform(CausationId).optional(),
  intentId: z.uuid().transform(IntentId).optional(),
});

export type CorrelationMetadata = z.infer<typeof CorrelationMetadataSchema>;
