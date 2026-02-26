// src/events/templates/auth.ts
// Auth observation event template

import { z } from "@zod/zod";
import {
  BrowserConfigId,
  type BrowserConfigId as BrowserConfigIdType,
  type ParticipantId as ParticipantIdType,
  participantIdSchema,
} from "$/core/mod.ts";
import { CorrelationMetadataSchema } from "$/events/metadata.ts";

export const AuthStatusSchema = z.enum(["authenticated", "expired", "unknown"]);
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

/**
 * Factory to create scoped auth observation base schemas.
 * Provides common fields with proper branded type transforms.
 *
 * Platforms extend this with their scope (using their own scope schema with
 * branded transform), type literal, and platform-specific auth fields
 * (e.g., canRead, canWrite, issue status).
 *
 * Example extension:
 * ```typescript
 * const LinkedInAuthObservedSchema = authObservedBase("linkedin").extend({
 *   scope: linkedInScopeSchema, // z.literal("linkedin").transform(() => LINKEDIN_SCOPE)
 *   type: z.literal("AuthObserved"),
 *   authenticated: z.boolean(),
 *   canRead: z.boolean(),
 *   canWrite: z.boolean(),
 * });
 * ```
 */
export const authObservedBase = <TScope extends string>(scope: TScope) =>
  CorrelationMetadataSchema.extend({
    configId: z.string().transform(BrowserConfigId),
    participantId: participantIdSchema(scope),
  });

/**
 * Generic AuthObservedBase for cases where scope is not known at compile time.
 * Prefer the scoped factory `authObservedBase(scope)` when possible.
 */
export const AuthObservedBase = CorrelationMetadataSchema.extend({
  configId: z.string().transform(BrowserConfigId),
  participantId: z.string(),
});

export type AuthObservedBase = z.infer<typeof AuthObservedBase>;

/** Type-safe accessors for use in platform behaviors. */

export interface AuthObservedFields<TScope extends string = string> {
  readonly configId: BrowserConfigIdType;
  readonly participantId: ParticipantIdType<TScope>;
}
