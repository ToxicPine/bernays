// brief/context.ts
// Server context — shared event store + briefing service
//
// brief is just another participant in the briefing protocol, identified
// by an AgentId. It reads and writes the same Postgres event log as
// every sockpuppet.

import { Effect, Layer } from "effect";
import { type AgentId as AgentIdType } from "@bernays/server/core";
import { configurePostgresEventStore, EventStoreLive } from "@bernays/server/store";
import {
  type BriefingService,
  Briefing,
  BriefingInjectionLive,
  BriefingProjectionLive,
  makeBriefingLayer,
} from "@bernays/server/briefing";

// =============================================================================
// Server Context
// =============================================================================

export interface ServerContext {
  readonly briefing: BriefingService;
}

// =============================================================================
// Configuration
// =============================================================================

export interface ServerConfig {
  /** Postgres connection string (same database the agents use). */
  readonly databaseUrl: string;
  /** This participant's identity in the briefing protocol. */
  readonly self: AgentIdType;
}

// =============================================================================
// Factory
// =============================================================================

export const createServerContext = async (
  config: ServerConfig,
): Promise<ServerContext> => {
  const eventStore = await Effect.runPromise(
    configurePostgresEventStore({ databaseUrl: config.databaseUrl }),
  );

  // Build the layer stack: Briefing -> BriefingInjection/Projection -> EventStore
  const eventStoreLayer = EventStoreLive(eventStore);

  const injectionProjectionLayer = Layer.mergeAll(
    BriefingInjectionLive,
    BriefingProjectionLive,
  ).pipe(Layer.provide(eventStoreLayer));

  const briefingLayer = makeBriefingLayer(config.self).pipe(
    Layer.provide(injectionProjectionLayer),
  );

  // Resolve the service from the fully-provided layer
  const briefing = await Effect.runPromise(
    Effect.provide(Briefing, briefingLayer),
  );

  return { briefing };
};
