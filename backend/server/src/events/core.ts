// src/events/core.ts
// Core framework events - produced by master process
// All events have scope: "core"

import { z } from "@zod/zod";
import { CorrelationMetadataSchema } from "./metadata.ts";
import { CORE_SCOPE } from "$/core/scope.ts";

// Re-export for convenience
export { CORE_SCOPE };

// Helper for scope literal with transform
const coreScopeSchema = z.literal("core").transform(() => CORE_SCOPE);

// ============================================================================
// Error Schema
// ============================================================================

export const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

// ============================================================================
// Intent Lifecycle Events
// ============================================================================

export const IntentReceivedEventSchema = CorrelationMetadataSchema.extend({
  scope: coreScopeSchema,
  type: z.literal("IntentReceived"),
  intentType: z.string(),
  dedupeKey: z.string().optional(),
});

export const IntentDispatchStartedEventSchema = CorrelationMetadataSchema
  .extend({
    scope: coreScopeSchema,
    type: z.literal("IntentDispatchStarted"),
    intentType: z.string(),
    attemptNumber: z.number().positive(),
  });

export const RetryScheduledEventSchema = CorrelationMetadataSchema.extend({
  scope: coreScopeSchema,
  type: z.literal("RetryScheduled"),
  intentType: z.string(),
  attemptNumber: z.number().positive(),
  retryAfter: z.iso.datetime(),
  reason: z.string(),
});

export const StateReconciledEventSchema = CorrelationMetadataSchema.extend({
  scope: coreScopeSchema,
  type: z.literal("StateReconciled"),
  intentType: z.string(),
  reconciledState: z.unknown(),
  discrepancies: z.array(z.string()).optional(),
});

export const IntentAbandonedEventSchema = CorrelationMetadataSchema.extend({
  scope: coreScopeSchema,
  type: z.literal("IntentAbandoned"),
  intentType: z.string(),
  reason: z.string(),
  finalError: ErrorSchema.optional(),
});

// ============================================================================
// Browser Command Events
// ============================================================================

export const BrowserCommandSentEventSchema = CorrelationMetadataSchema.extend({
  scope: coreScopeSchema,
  type: z.literal("BrowserCommandSent"),
  command: z.string(),
  requestId: z.string(),
});

export const BrowserCommandCompletedEventSchema = CorrelationMetadataSchema
  .extend({
    scope: coreScopeSchema,
    type: z.literal("BrowserCommandCompleted"),
    command: z.string(),
    requestId: z.string(),
    result: z.unknown(),
    durationMs: z.number().nonnegative(),
  });

export const BrowserCommandFailedEventSchema = CorrelationMetadataSchema.extend(
  {
    scope: coreScopeSchema,
    type: z.literal("BrowserCommandFailed"),
    command: z.string(),
    requestId: z.string(),
    error: ErrorSchema,
    durationMs: z.number().nonnegative(),
  },
);

// ============================================================================
// Auth Status Events
// ============================================================================

export const AuthStatusChangedEventSchema = CorrelationMetadataSchema.extend({
  scope: coreScopeSchema,
  type: z.literal("AuthStatusChanged"),
  targetScope: z.string(),
  status: z.enum(["signed-in", "signed-out", "session-expired"]),
  userId: z.string().optional(),
});

// ============================================================================
// Failure Observation Events
// ============================================================================

export const RateLimitDetectedEventSchema = CorrelationMetadataSchema.extend({
  scope: coreScopeSchema,
  type: z.literal("RateLimitDetected"),
  retryAfter: z.iso.datetime().optional(),
  limitType: z.string().optional(),
});

export const UIChangedEventSchema = CorrelationMetadataSchema.extend({
  scope: coreScopeSchema,
  type: z.literal("UIChanged"),
  selector: z.string(),
  description: z.string().optional(),
});

// ============================================================================
// Discriminated Union
// ============================================================================

export const CoreEventSchema = z.discriminatedUnion("type", [
  IntentReceivedEventSchema,
  IntentDispatchStartedEventSchema,
  BrowserCommandSentEventSchema,
  BrowserCommandCompletedEventSchema,
  BrowserCommandFailedEventSchema,
  RetryScheduledEventSchema,
  StateReconciledEventSchema,
  IntentAbandonedEventSchema,
  AuthStatusChangedEventSchema,
  RateLimitDetectedEventSchema,
  UIChangedEventSchema,
]);

export type CoreEvent = z.infer<typeof CoreEventSchema>;

// ============================================================================
// Type Exports
// ============================================================================

export type IntentReceivedEvent = z.infer<typeof IntentReceivedEventSchema>;
export type IntentDispatchStartedEvent = z.infer<
  typeof IntentDispatchStartedEventSchema
>;
export type RetryScheduledEvent = z.infer<typeof RetryScheduledEventSchema>;
export type StateReconciledEvent = z.infer<typeof StateReconciledEventSchema>;
export type IntentAbandonedEvent = z.infer<typeof IntentAbandonedEventSchema>;
export type BrowserCommandSentEvent = z.infer<
  typeof BrowserCommandSentEventSchema
>;
export type BrowserCommandCompletedEvent = z.infer<
  typeof BrowserCommandCompletedEventSchema
>;
export type BrowserCommandFailedEvent = z.infer<
  typeof BrowserCommandFailedEventSchema
>;
export type AuthStatusChangedEvent = z.infer<
  typeof AuthStatusChangedEventSchema
>;
export type RateLimitDetectedEvent = z.infer<
  typeof RateLimitDetectedEventSchema
>;
export type UIChangedEvent = z.infer<typeof UIChangedEventSchema>;
