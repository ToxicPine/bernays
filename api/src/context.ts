// api/src/context.ts
// Shared server context — stores, registries, projections

import { Effect, Layer } from "effect";
import {
  type ConfigStoreService,
  configurePostgresEventStore,
  type EventStore,
  EventStoreLive,
  type StorableEvent,
} from "@bernays/server/store";
import {
  type AnyPlatform,
  createPlatformRegistry,
  type PlatformDefinition,
  type PlatformRegistry,
} from "@bernays/server/platforms";
import {
  type Injector,
  makeInjectorTag,
  makeInjectionLayer,
  type Projection,
  makeProjectionTag,
  makeProjectionLayer,
} from "@bernays/server/projections";
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
 */
export interface AccountStoreView {
  readonly get: (id: string) => Effect.Effect<import("effect").Option.Option<BaseAccount>>;
  readonly list: () => Effect.Effect<readonly BaseAccount[]>;
}

export interface ServerContext {
  /** The raw event store — used by the GET /events endpoint for unscoped queries. */
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

// deno-lint-ignore no-explicit-any
const asPlatform = (
  p: PlatformDefinition<any, any, any, any, any, any, any, any, any>,
): AnyPlatform => p;

const PLATFORMS: readonly AnyPlatform[] = [
  asPlatform(linkedInPlatform),
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
  const { createPostgresConfigStore } = await import("@bernays/server/store");
  const configStore = await createPostgresConfigStore({
    connectionString: databaseUrl,
  });

  // Register platforms
  const registry = createPlatformRegistry(PLATFORMS);

  // Create injectors and projections per scope via layers
  const eventStoreLayer = EventStoreLive(eventStore);
  const injectors = new Map<Scope, Injector<StorableEvent>>();
  const projections = new Map<Scope, Projection<StorableEvent>>();

  for (const platform of PLATFORMS) {
    const scope = platform.scope;
    const schema = platform.eventSchema;

    // Create scope-specific tags
    const injTag = makeInjectorTag<StorableEvent>(`${scope}/Injection`);
    const projTag = makeProjectionTag<StorableEvent>(`${scope}/Projection`);

    // Build layers
    const injLayer = makeInjectionLayer(injTag, scope, schema).pipe(
      Layer.provide(eventStoreLayer),
    );
    const projLayer = makeProjectionLayer(projTag, scope, schema).pipe(
      Layer.provide(eventStoreLayer),
    );

    // Resolve services
    const inj = await Effect.runPromise(
      Effect.provide(injTag, injLayer),
    );
    const proj = await Effect.runPromise(
      Effect.provide(projTag, projLayer),
    );

    injectors.set(scope, inj);
    projections.set(scope, proj);
  }

  // Briefing projection for read access
  const briefingProjTag = makeProjectionTag<StorableEvent>(
    "briefing/Projection",
  );
  const briefingProjLayer = makeProjectionLayer(
    briefingProjTag,
    BRIEFING_SCOPE,
    BriefingEventSchema,
  ).pipe(Layer.provide(eventStoreLayer));

  const briefingProj = await Effect.runPromise(
    Effect.provide(briefingProjTag, briefingProjLayer),
  );
  projections.set(BRIEFING_SCOPE, briefingProj);

  // Create account stores per platform identity
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
