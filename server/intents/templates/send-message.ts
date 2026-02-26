// intents/templates/send-message.ts
// Template for send message intents

import { z } from "@zod/zod";
import { ThreadId } from "$/core/branded.ts";

/**
 * Base schema for send message intents.
 * Platforms extend this and override `type` with their namespaced version.
 */
export const SendMessageBase = z.object({
  threadId: z.string().transform(ThreadId),
  content: z.string().min(1),
  // type: platforms add their namespaced literal (e.g., "linkedin:SendMessage")
});

export type SendMessageBase = z.infer<typeof SendMessageBase>;
