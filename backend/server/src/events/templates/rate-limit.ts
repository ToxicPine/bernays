// src/events/templates/rate-limit.ts
// Rate limit observation event template

import { z } from "@zod/zod";
import {
  BrowserConfigId,
  type BrowserConfigId as BrowserConfigIdType,
  type ParticipantId as ParticipantIdType,
  participantIdSchema,
} from "$/core/mod.ts";
import { CorrelationMetadataSchema } from "$/events/metadata.ts";

/**
 * Factory to create scoped rate limit observation base schemas.
 * Provides common fields with proper branded type transforms.
 *
 * Platforms extend this with their scope (using their own scope schema with
 * branded transform), type literal, and platform-specific limit type enum.
 *
 * Example extension:
 * ```typescript
 * const LinkedInRateLimitObservedSchema = rateLimitObservedBase("linkedin").extend({
 *   scope: linkedInScopeSchema, // z.literal("linkedin").transform(() => LINKEDIN_SCOPE)
 *   type: z.literal("RateLimitObserved"),
 *   limitType: z.enum(["weekly_invites", "daily_messages", "searches"]),
 * });
 * ```
 */
export const rateLimitObservedBase = <TScope extends string>(scope: TScope) =>
  CorrelationMetadataSchema.extend({
    configId: z.string().transform(BrowserConfigId),
    participantId: participantIdSchema(scope),
    retryAfter: z.iso.datetime().optional(),
  });

/**
 * Generic RateLimitObservedBase for cases where scope is not known at compile time.
 * Prefer the scoped factory `rateLimitObservedBase(scope)` when possible.
 */
export const RateLimitObservedBase = CorrelationMetadataSchema.extend({
  configId: z.string().transform(BrowserConfigId),
  participantId: z.string(),
  retryAfter: z.iso.datetime().optional(),
});

export type RateLimitObservedBase = z.infer<typeof RateLimitObservedBase>;

/** Type-safe accessors for use in platform behaviors. */

export interface RateLimitObservedFields<TScope extends string = string> {
  readonly configId: BrowserConfigIdType;
  readonly participantId: ParticipantIdType<TScope>;
  readonly retryAfter?: string;
}
