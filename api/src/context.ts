// api/src/context.ts
// Shared server context — stores, registries, projections

import { Effect, Option } from "effect";
import {
  type ConfigStoreService,
  configurePostgresEventStore,
  createPostgresConfigStore,
  type EventStore,
  type StorableEvent,
} from "@bernays/server/store";
import {
  type AnyPlatform,
  createPlatformRegistry,
  type PlatformDefinition,
  type PlatformRegistry,
} from "@bernays/server/platforms";
import { type Injector, makeInjector } from "@bernays/server/projections";
import { makeProjection, type Projection } from "@bernays/server/projections";
import {
  BRIEFING_SCOPE,
  ParticipantIdFromString,
  type Scope,
} from "@bernays/server/core";
import { BriefingEventSchema } from "@bernays/server/events";
import type { BaseAccount } from "@bernays/server/views";

// Plugins
import {
  createPostgresLinkedInAccountStore,
  linkedInPlatform,
} from "@bernays/plugins/linkedin";

// =============================================================================
// Server Context
// =============================================================================

/**
 * Read-only view of an account store — only the operations the API needs.
 * This avoids variance issues with the full AccountStoreService<TScope, TAccount>
 * (which has contravariant parameters due to .get() accepting ParticipantId<TScope>).
 */
export interface AccountStoreView {
  readonly get: (id: string) => Effect.Effect<Option.Option<BaseAccount>>;
  readonly list: () => Effect.Effect<readonly BaseAccount[]>;
}

export interface ServerContext {
  readonly eventStore: EventStore<StorableEvent>;
  readonly configStore: ConfigStoreService;
  readonly registry: PlatformRegistry;
  readonly injectors: ReadonlyMap<Scope, Injector<StorableEvent>>;
  readonly projections: ReadonlyMap<Scope, Projection<StorableEvent>>;
  readonly accountStores: ReadonlyMap<string, AccountStoreView>;
}

// =============================================================================
// Platform Registration
// =============================================================================

// PlatformDefinition has invariant type parameters (behavior methods are both
// covariant and contravariant), so TypeScript can't widen specific platforms
// to AnyPlatform directly. This helper erases platform-specific types for
// registry consumption. Safe because the API only reads from behaviors.
// deno-lint-ignore no-explicit-any
const asPlatform = (
  p: PlatformDefinition<any, any, any, any, any, any, any, any, any>,
): AnyPlatform => p;

const PLATFORMS: readonly AnyPlatform[] = [
  asPlatform(linkedInPlatform),
  // asPlatform(xPlatform),
  // asPlatform(redditPlatform),
];

// =============================================================================
// Context Factory
// =============================================================================

export interface ServerConfig {
  readonly databaseUrl: string;
}

export const createServerContext = async (
  config: ServerConfig,
): Promise<ServerContext> => {
  const { databaseUrl } = config;

  // Initialize stores
  const eventStore = await Effect.runPromise(
    configurePostgresEventStore({ databaseUrl }),
  );
  const configStore = await createPostgresConfigStore({
    connectionString: databaseUrl,
  });

  // Register platforms
  const registry = createPlatformRegistry(PLATFORMS);

  // Create injectors and projections per scope
  const injectors = new Map<Scope, Injector<StorableEvent>>();
  const projections = new Map<Scope, Projection<StorableEvent>>();

  for (const platform of PLATFORMS) {
    const scope = platform.scope;
    const schema = platform.eventSchema;
    injectors.set(scope, makeInjector(scope, schema, eventStore));
    projections.set(scope, makeProjection(scope, schema, eventStore));
  }

  // Register briefing scope for read access (agents write directly via BriefingService)
  projections.set(
    BRIEFING_SCOPE,
    makeProjection(BRIEFING_SCOPE, BriefingEventSchema, eventStore),
  );

  // Create account stores per platform identity.
  // Wrap platform-specific stores to satisfy AccountStoreView (which uses plain
  // string IDs). The wrapper just forwards calls — branded ParticipantId<TScope>
  // is a string at runtime, so this is safe.
  const accountStores = new Map<string, AccountStoreView>();

  const linkedInAccountStore = await createPostgresLinkedInAccountStore({
    connectionString: databaseUrl,
  });
  accountStores.set("linkedin", {
    get: (id) =>
      linkedInAccountStore.get(ParticipantIdFromString<"linkedin">(id)),
    list: () => linkedInAccountStore.list(),
  });

  return {
    eventStore,
    configStore,
    registry,
    injectors,
    projections,
    accountStores,
  };
};
