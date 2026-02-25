// packages/master/src/runtime/mod.ts
// Runtime module exports

// Sockpuppet Services
export {
  Journal,
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
  JournalInjectionLive,
  JournalProjection,
  JournalProjectionLive,
  makeJournalLayer,
} from "./sockpuppet/journal-runtime.ts";

// Briefing Layer
export {
  Briefing,
  BriefingInjection,
  BriefingInjectionLive,
  BriefingProjection,
  BriefingProjectionLive,
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
