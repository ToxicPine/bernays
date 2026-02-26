// packages/master/src/runtime/mod.ts
// Runtime module exports

// Sockpuppet Services
export {
  Journal,
  type JournalEntry,
  type JournalEntryInput,
  type JournalService,
  type PlatformService,
} from "./sockpuppet/services.ts";

// Platform Layer
export { makePlatformLayer } from "./sockpuppet/platform-runtime.ts";

// Re-export makePlatformService from canonical location
export { makePlatformService } from "$/platforms/mod.ts";

// Journal Layer
export {
  JournalInjection,
  JournalProjection,
  makeJournalLayer,
} from "./sockpuppet/journal-runtime.ts";

// Journal scope helper
export { makeJournalScope } from "$/core/scope.ts";

// Briefing Layer
export {
  Briefing,
  BriefingInjection,
  BriefingProjection,
  makeBriefingLayer,
} from "./sockpuppet/briefing-runtime.ts";

// Briefing Service types
export { type BriefingService } from "$/briefing/service.ts";

// Runtime Service
export {
  makeRuntimeLayer,
  Runtime,
  type RuntimeConfig,
  type RuntimeService,
} from "./runtime.ts";
