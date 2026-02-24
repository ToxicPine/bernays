// packages/master/src/core/scope.ts
// Scope infrastructure for scoped event/intent types

import { Scope } from "./branded.ts";

import { z } from "@zod/zod";

export const CORE_SCOPE = Scope("core");

export const JOURNAL_SCOPE = Scope("journal");

export const ScopeSchema = z.string().min(1).transform((val) => Scope(val));
