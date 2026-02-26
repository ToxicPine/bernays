// packages/master/src/core/scope.ts
// Scope infrastructure for scoped event/intent types

import { Scope } from "./branded.ts";

import { z } from "@zod/zod";

export const CORE_SCOPE = Scope("core");

/**
 * Create a journal scope for a specific participant.
 * This enables efficient queries by pushing the filter to the EventStore level
 * instead of fetching all journal events and filtering in memory.
 */
export const makeJournalScope = (participantId: string): Scope =>
  Scope(`journal:${participantId}`);

export const BRIEFING_SCOPE = Scope("briefing");

export const ScopeSchema = z.string().min(1).transform((val) => Scope(val));
