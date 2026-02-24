// src/briefing/mod.ts
// Briefing module — agent-to-agent structured conversations

export {
  type BriefingBase,
  type BriefingStatus,
  type BriefingView,
  deriveBriefings,
  getActiveBriefings,
  getBriefing,
} from "./view.ts";

export {
  Briefing,
  type BriefingError,
  briefingError,
  type BriefingErrorCode,
  type BriefingRuntimeConfig,
  type BriefingService,
  makeBriefingService,
} from "./service.ts";
