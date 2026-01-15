// plugins/linkedindojo/schemas.ts
// LinkedIn Dojo schemas - same event/intent shapes as LinkedIn, different scope

import { z } from "@zod/zod";
import {
  CanonicalId,
  IntentId,
  participantIdSchema,
  Scope,
  ThreadId,
} from "@bernays/server/core";
import { CorrelationMetadataSchema } from "@bernays/server/events";
import {
  AnchorMessageObservedBase,
  MessageObservedBase,
} from "@bernays/server/events";
import {
  SendMessageBase,
  SyncConversationsBase,
} from "@bernays/server/intents";

// Re-export anchor from LinkedIn plugin (same structure for both)
import { LinkedInAnchorSchema } from "../linkedin/schemas.ts";
export type { LinkedInAnchor } from "../linkedin/schemas.ts";
export { LinkedInAnchorSchema };

// Dojo Scope

export const LINKEDIN_DOJO_SCOPE = Scope("linkedindojo");
export type LinkedInDojoScope = typeof LINKEDIN_DOJO_SCOPE;

const linkedInDojoScopeSchema = z.literal("linkedindojo").transform(() =>
  LINKEDIN_DOJO_SCOPE
);

// Event Schemas (same shape as LinkedIn, different scope)

// Identity schema - dojo uses linkedin identity namespace
const linkedInParticipantIdSchema = participantIdSchema("linkedin");

export const LinkedInDojoAuthObservedSchema = CorrelationMetadataSchema.extend({
  scope: linkedInDojoScopeSchema,
  type: z.literal("AuthObserved"),
  participantId: linkedInParticipantIdSchema,
  configId: z.string(),
  authenticated: z.boolean(),
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

export const LinkedInDojoMessageObservedSchema = MessageObservedBase
  .extend({
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

export const LinkedInDojoRateLimitObservedSchema = CorrelationMetadataSchema
  .extend({
    scope: linkedInDojoScopeSchema,
    type: z.literal("RateLimitObserved"),
    configId: z.string(),
    participantId: linkedInParticipantIdSchema,
    retryAfter: z.iso.datetime().optional(),
    limitType: z.enum(["weekly_invites", "daily_messages", "searches"]),
  });

export type LinkedInDojoRateLimitObserved = z.infer<
  typeof LinkedInDojoRateLimitObservedSchema
>;

// Event Union
export const LinkedInDojoEventSchema = z.discriminatedUnion("type", [
  LinkedInDojoAuthObservedSchema,
  LinkedInDojoAnchorMessageObservedSchema,
  LinkedInDojoMessageObservedSchema,
  LinkedInDojoMessageSentSchema,
  LinkedInDojoRateLimitObservedSchema,
]);

export type LinkedInDojoEvent = z.infer<typeof LinkedInDojoEventSchema>;

// Intent Schemas

const LinkedInDojoIntentBase = z.object({
  scope: linkedInDojoScopeSchema,
  intentId: z.uuid().transform(IntentId),
  timestamp: z.iso.datetime(),
});

export const LinkedInDojoSendMessageSchema = LinkedInDojoIntentBase.extend(
  SendMessageBase.shape,
).extend({
  type: z.literal("SendMessage"),
});

export type LinkedInDojoSendMessage = z.infer<
  typeof LinkedInDojoSendMessageSchema
>;

export const LinkedInDojoSyncConversationsSchema = LinkedInDojoIntentBase
  .extend(
    SyncConversationsBase.shape,
  ).extend({
    type: z.literal("SyncConversations"),
  });

export type LinkedInDojoSyncConversations = z.infer<
  typeof LinkedInDojoSyncConversationsSchema
>;

// Intent Union
export const LinkedInDojoIntentSchema = z.discriminatedUnion("type", [
  LinkedInDojoSendMessageSchema,
  LinkedInDojoSyncConversationsSchema,
]);

export type LinkedInDojoIntent = z.infer<typeof LinkedInDojoIntentSchema>;
