// packages/master/src/runtime/sockpuppet/compose.ts
// Sockpuppet layer composition and execution

import { Effect, Layer } from "effect";
import type { Journal, Platform } from "./services.ts";

// Layer Composition

/**
 * Compose Platform and Journal layers into a single layer.
 */
export const makeSockpuppetLayer = (
  platformLayer: Layer.Layer<Platform>,
  journalLayer: Layer.Layer<Journal>,
): Layer.Layer<Platform | Journal> => Layer.merge(platformLayer, journalLayer);

// Sockpuppet Execution

/**
 * Run a sockpuppet effect with the provided layer.
 */
export const runSockpuppet = async <A, E>(
  sockpuppet: Effect.Effect<A, E, Platform | Journal>,
  layer: Layer.Layer<Platform | Journal>,
): Promise<A> => {
  const program = Effect.provide(sockpuppet, layer);
  return Effect.runPromise(program);
};
