// packages/master/src/core/scope.ts
// Scope infrastructure for scoped event/intent types

import { Scope } from "./branded.ts";

/** Core framework scope - for runtime lifecycle events */
export const CORE_SCOPE = Scope("core");

/** Journal scope - for sockpuppet journal entries */
export const JOURNAL_SCOPE = Scope("journal");

import { z } from "@zod/zod";

/** Zod schema for Scope branded type */
export const ScopeSchema = z.string().min(1).transform((val) => Scope(val));
