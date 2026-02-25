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
  BriefingInjection,
  BriefingInjectionLive,
  BriefingProjection,
  BriefingProjectionLive,
  type BriefingService,
  makeBriefingLayer,
} from "./service.ts";
