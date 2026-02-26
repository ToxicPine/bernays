// packages/master/src/runtime/sockpuppet/compose.ts
// Sockpuppet layer composition and execution

import { Effect, Layer } from "effect";
import type { Journal } from "./services.ts";
import type { Briefing } from "$/briefing/service.ts";

// Layer Composition

/**
 * Compose Platform, Journal, and Briefing layers into a single layer.
 * Generic over the platform tag type.
 */
export function makeSockpuppetLayer<TPlatform>(
  platformLayer: Layer.Layer<TPlatform>,
  journalLayer: Layer.Layer<Journal>,
  briefingLayer: Layer.Layer<Briefing>,
): Layer.Layer<TPlatform | Journal | Briefing>;
export function makeSockpuppetLayer<TPlatform>(
  platformLayer: Layer.Layer<TPlatform>,
  journalLayer: Layer.Layer<Journal>,
): Layer.Layer<TPlatform | Journal>;
export function makeSockpuppetLayer<TPlatform>(
  platformLayer: Layer.Layer<TPlatform>,
  journalLayer: Layer.Layer<Journal>,
  briefingLayer?: Layer.Layer<Briefing>,
) {
  const base = Layer.merge(platformLayer, journalLayer);
  if (briefingLayer) {
    return Layer.merge(base, briefingLayer);
  }
  return base;
}

// Sockpuppet Execution

/**
 * Run a sockpuppet effect with the provided layer.
 * Generic over the platform tag type.
 */
export const runSockpuppet = async <A, E, TPlatform>(
  sockpuppet: Effect.Effect<A, E, TPlatform | Journal | Briefing>,
  layer: Layer.Layer<TPlatform | Journal | Briefing>,
): Promise<A> => {
  const program = Effect.provide(sockpuppet, layer);
  return Effect.runPromise(program);
};
