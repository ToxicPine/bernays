// src/platforms/x/schemas.ts
// X (Twitter) platform schemas

import { z } from "@zod/zod";
import {
  type AccountId as AccountIdType,
  Scope,
  ThreadId,
} from "@bernays/server/core";
import { CorrelationMetadataSchema } from "@bernays/server/events";

// ============================================================================
// Scope
// ============================================================================

export const X_SCOPE = Scope("x");
export type XScope = typeof X_SCOPE;

const xScopeSchema = z.literal("x").transform(() => X_SCOPE);

// ============================================================================
// X Anchor
// ============================================================================

export const XAnchorSchema = z.object({
  conversationId: z.string(),
  participants: z.array(z.string()),
});

export type XAnchor = z.infer<typeof XAnchorSchema>;

// ============================================================================
// X Event Schemas (minimal stub)
// ============================================================================

export const XAuthObservedSchema = CorrelationMetadataSchema.extend({
  scope: xScopeSchema,
  type: z.literal("AuthObserved"),
  accountId: z.string().transform((val): AccountIdType => val as AccountIdType),
  authenticated: z.boolean(),
});

export type XAuthObserved = z.infer<typeof XAuthObservedSchema>;

export const XEventSchema = z.discriminatedUnion("type", [
  XAuthObservedSchema,
]);

export type XEvent = z.infer<typeof XEventSchema>;

// ============================================================================
// X Intent Schemas (minimal stub)
// ============================================================================

export const XSendMessageSchema = z.object({
  scope: xScopeSchema,
  type: z.literal("SendMessage"),
  threadId: z.string().transform((val): ThreadId => val as ThreadId),
  content: z.string(),
});

export type XSendMessage = z.infer<typeof XSendMessageSchema>;

export const XIntentSchema = z.discriminatedUnion("type", [
  XSendMessageSchema,
]);

export type XIntent = z.infer<typeof XIntentSchema>;
