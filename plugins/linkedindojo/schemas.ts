// plugins/linkedindojo/schemas.ts
// LinkedIn Dojo schemas — same event shapes as LinkedIn, different scope.
// Dojo is a browser-free testing environment that shares LinkedIn identity.

import { z } from "@zod/zod";
import {
  BrowserConfigId,
  CanonicalId,
  participantIdSchema,
  Scope,
  ThreadId,
} from "@bernays/server/core";
import { CorrelationMetadataSchema } from "@bernays/server/events";
import {
  AnchorMessageObservedBase,
  MessageObservedBase,
} from "@bernays/server/events";

// Re-export anchor from LinkedIn plugin (same structure)
import { LinkedInAnchorSchema } from "../linkedin/schemas.ts";
export type { LinkedInAnchor } from "../linkedin/schemas.ts";
export { LinkedInAnchorSchema };

// =============================================================================
// Scope
// =============================================================================

export const LINKEDIN_DOJO_SCOPE = Scope("linkedindojo");
export type LinkedInDojoScope = typeof LINKEDIN_DOJO_SCOPE;

const linkedInDojoScopeSchema = z.literal("linkedindojo").transform(() =>
  LINKEDIN_DOJO_SCOPE
);

// Identity — dojo uses LinkedIn identity namespace
const linkedInParticipantIdSchema = participantIdSchema("linkedin");

// =============================================================================
// Event Schemas (subset of LinkedIn events, different scope)
// =============================================================================

export const LinkedInDojoAuthObservedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInDojoScopeSchema,
  type: z.literal("AuthObserved"),
  participantId: linkedInParticipantIdSchema,
  configId: z.string().transform(BrowserConfigId),
  status: z.enum(["authenticated", "expired", "challenged", "unknown"]),
  challengeType: z.string().optional(),
});

export type LinkedInDojoAuthObserved = z.infer<
  typeof LinkedInDojoAuthObservedSchema
>;

export const LinkedInDojoAnchorMessageObservedSchema = AnchorMessageObservedBase
  .extend({
    scope: linkedInDojoScopeSchema,
    type: z.literal("AnchorMessageObserved"),
    anchor: LinkedInAnchorSchema,
    threadId: z.string().transform(ThreadId),
  });

export type LinkedInDojoAnchorMessageObserved = z.infer<
  typeof LinkedInDojoAnchorMessageObservedSchema
>;

export const LinkedInDojoMessageObservedSchema = MessageObservedBase.extend({
  scope: linkedInDojoScopeSchema,
  type: z.literal("MessageObserved"),
  threadId: z.string().transform(ThreadId),
});

export type LinkedInDojoMessageObserved = z.infer<
  typeof LinkedInDojoMessageObservedSchema
>;

export const LinkedInDojoMessageSentSchema = CorrelationMetadataSchema.extend({
  scope: linkedInDojoScopeSchema,
  type: z.literal("MessageSent"),
  threadId: z.string().transform(ThreadId),
  canonicalId: z.string().transform(CanonicalId),
  senderId: linkedInParticipantIdSchema,
  content: z.string(),
});

export type LinkedInDojoMessageSent = z.infer<
  typeof LinkedInDojoMessageSentSchema
>;

export const LinkedInDojoRestrictionObservedSchema = CorrelationMetadataSchema
  .extend({
    scope: linkedInDojoScopeSchema,
    type: z.literal("RestrictionObserved"),
    configId: z.string().transform(BrowserConfigId),
    restrictionType: z.string(),
    retryAfter: z.string().optional(),
  });

export type LinkedInDojoRestrictionObserved = z.infer<
  typeof LinkedInDojoRestrictionObservedSchema
>;

export const LinkedInDojoRestrictionClearedSchema = CorrelationMetadataSchema
  .extend({
    scope: linkedInDojoScopeSchema,
    type: z.literal("RestrictionCleared"),
    configId: z.string().transform(BrowserConfigId),
    restrictionType: z.string(),
  });

export type LinkedInDojoRestrictionCleared = z.infer<
  typeof LinkedInDojoRestrictionClearedSchema
>;

// =============================================================================
// Event Union
// =============================================================================

export const LinkedInDojoEventSchema = z.discriminatedUnion("type", [
  LinkedInDojoAuthObservedSchema,
  LinkedInDojoAnchorMessageObservedSchema,
  LinkedInDojoMessageObservedSchema,
  LinkedInDojoMessageSentSchema,
  LinkedInDojoRestrictionObservedSchema,
  LinkedInDojoRestrictionClearedSchema,
]);

export type LinkedInDojoEvent = z.infer<typeof LinkedInDojoEventSchema>;
