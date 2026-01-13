// src/events/templates/auth.ts
// Auth observation event template

import { z } from "@zod/zod";
import {
  AccountId,
  type AccountId as AccountIdType,
  BrowserConfigId,
  type BrowserConfigId as BrowserConfigIdType,
} from "$/core/branded.ts";
import { CorrelationMetadataSchema } from "$/events/metadata.ts";

export const AuthStatusSchema = z.enum(["authenticated", "expired", "unknown"]);
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

/**
 * Base schema for auth observation events.
 * Platforms extend this with their scope and type literals.
 *
 * Example extension:
 * ```typescript
 * const LinkedInAuthObservedSchema = AuthObservedBase.extend({
 *   scope: z.literal("linkedin"),
 *   type: z.literal("AuthObserved"),
 * });
 * ```
 */
export const AuthObservedBase = CorrelationMetadataSchema.extend({
  configId: z.string().transform(BrowserConfigId),
  accountId: z.string().transform(AccountId),
  status: AuthStatusSchema,
});

export type AuthObservedBase = z.infer<typeof AuthObservedBase>;

/** Type-safe accessors for use in platform behaviors. */

export interface AuthObservedFields {
  readonly configId: BrowserConfigIdType;
  readonly accountId: AccountIdType;
  readonly status: AuthStatus;
}
