// packages/master/src/runtime/mod.ts
// Runtime module exports
//
// Note: For hashing utilities, import from $/core/mod.ts
// Note: For graph utilities, import from $/views/mod.ts

// Sockpuppet Services
export {
  Journal,
  type JournalEntryInput,
  type JournalService,
  Platform,
  type PlatformServiceInterface,
} from "./sockpuppet/services.ts";

// Platform Layer
export {
  makePlatformLayer,
  makePlatformService,
  type PlatformRuntimeConfig,
} from "./sockpuppet/platform-runtime.ts";

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
