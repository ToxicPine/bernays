// packages/master/src/runtime/sockpuppet/compose.ts
// Sockpuppet layer composition and execution

import { Effect, Layer } from "effect";
import type { Journal } from "./services.ts";

// Layer Composition

/**
 * Compose Platform and Journal layers into a single layer.
 * Generic over the platform tag type.
 */
export const makeSockpuppetLayer = <TPlatform>(
  platformLayer: Layer.Layer<TPlatform>,
  journalLayer: Layer.Layer<Journal>,
): Layer.Layer<TPlatform | Journal> => Layer.merge(platformLayer, journalLayer);

// Sockpuppet Execution

/**
 * Run a sockpuppet effect with the provided layer.
 * Generic over the platform tag type.
 */
export const runSockpuppet = async <A, E, TPlatform>(
  sockpuppet: Effect.Effect<A, E, TPlatform | Journal>,
  layer: Layer.Layer<TPlatform | Journal>,
): Promise<A> => {
  const program = Effect.provide(sockpuppet, layer);
  return Effect.runPromise(program);
};
