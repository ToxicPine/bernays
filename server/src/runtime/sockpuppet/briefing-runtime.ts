// src/runtime/sockpuppet/briefing-runtime.ts
// Briefing service layer for sockpuppet runtime composition
// Re-exports from the canonical briefing service location.

export {
  Briefing,
  BriefingInjection,
  BriefingInjectionLive,
  BriefingProjection,
  BriefingProjectionLive,
  makeBriefingLayer,
} from "$/briefing/service.ts";
