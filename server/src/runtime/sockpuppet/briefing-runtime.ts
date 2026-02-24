// src/runtime/sockpuppet/briefing-runtime.ts
// Briefing service layer for sockpuppet runtime composition

import { Layer } from "effect";
import {
  Briefing,
  type BriefingRuntimeConfig,
  makeBriefingService,
} from "$/briefing/service.ts";

export type { BriefingRuntimeConfig };

/**
 * Create a Layer that provides the Briefing service.
 * Follows the same pattern as makeJournalLayer.
 */
export const makeBriefingLayer = (
  config: BriefingRuntimeConfig,
): Layer.Layer<Briefing> =>
  Layer.succeed(Briefing, makeBriefingService(config));
