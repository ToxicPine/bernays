// packages/master/src/runtime/mod.ts
// Runtime module exports
//
// Note: For hashing utilities, import from $/core/mod.ts
// Note: For graph utilities, import from $/views/mod.ts

// Sockpuppet Services
// Note: Platform tags are now platform-specific (e.g., LinkedInPlatform from plugins)
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
  type JournalRuntimeConfig,
  makeInMemoryJournalLayer,
  makeJournalLayer,
} from "./sockpuppet/journal-runtime.ts";

// Runtime Service
export {
  makeRuntimeLayer,
  Runtime,
  type RuntimeConfig,
  type RuntimeService,
} from "./runtime.ts";
