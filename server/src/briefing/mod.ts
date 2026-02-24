// src/briefing/mod.ts
// Briefing module — agent-to-agent structured conversations

export {
  BriefingClient,
  type BriefingClientError,
  briefingClientError,
  type BriefingClientErrorCode,
  type BriefingClientService,
  type BriefingEndResponse,
  type BriefingMessageResponse,
  type BriefingRequestResponse,
  makeBriefingClient,
} from "./client.ts";

export {
  type BriefingMessage,
  type BriefingStatus,
  type BriefingView,
  deriveBriefings,
  getActiveBriefings,
  getBriefing,
} from "./view.ts";

export {
  type AgentRegistry,
  Briefing,
  type BriefingError,
  briefingError,
  type BriefingErrorCode,
  type BriefingRuntimeConfig,
  type BriefingService,
  flycastRegistry,
  makeBriefingService,
} from "./service.ts";
