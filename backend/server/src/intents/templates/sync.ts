// intents/templates/sync.ts
// Template for sync conversations intents

import { z } from "@zod/zod";

/**
 * Base schema for sync conversations intents.
 * Platforms extend this and override `type` with their namespaced version.
 */
export const SyncConversationsBase = z.object({
  since: z.iso.datetime().optional(),
  limit: z.number().positive().optional(),
  // type: platforms add their namespaced literal (e.g., "linkedin:SyncConversations")
});

export type SyncConversationsBase = z.infer<typeof SyncConversationsBase>;
