// brief/context.ts
// Server context — shared event store + briefing service
//
// brief is just another participant in the briefing protocol, identified
// by an AgentId. It reads and writes the same Postgres event log as
// every sockpuppet.

import { Effect } from "effect";
import { AgentId, type AgentId as AgentIdType } from "@bernays/server/core";
import { configurePostgresEventStore } from "@bernays/server/store";
import {
  type BriefingService,
  makeBriefingService,
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

  const briefing = makeBriefingService({
    self: config.self,
    eventStore,
  });

  return { briefing };
};
