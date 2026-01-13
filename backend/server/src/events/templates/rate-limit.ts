// src/events/templates/rate-limit.ts
// Rate limit observation event template

import { z } from "@zod/zod";
import {
  AccountId,
  type AccountId as AccountIdType,
  BrowserConfigId,
  type BrowserConfigId as BrowserConfigIdType,
} from "$/core/branded.ts";
import { CorrelationMetadataSchema } from "$/events/metadata.ts";

/**
 * Base schema for rate limit observation events.
 * Platforms extend this with their scope and type literals.
 *
 * Example extension:
 * ```typescript
 * const LinkedInRateLimitObservedSchema = RateLimitObservedBase.extend({
 *   scope: z.literal("linkedin"),
 *   type: z.literal("RateLimitObserved"),
 *   // Platform-specific fields
 *   limitType: z.enum(["weekly_invites", "daily_messages", "searches"]),
 * });
 * ```
 */
export const RateLimitObservedBase = CorrelationMetadataSchema.extend({
  configId: z.string().transform(BrowserConfigId),
  accountId: z.string().transform(AccountId),
  retryAfter: z.iso.datetime().optional(),
});

export type RateLimitObservedBase = z.infer<typeof RateLimitObservedBase>;

/** Type-safe accessors for use in platform behaviors. */

export interface RateLimitObservedFields {
  readonly configId: BrowserConfigIdType;
  readonly accountId: AccountIdType;
  readonly retryAfter?: string;
}
