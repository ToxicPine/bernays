// api/src/context.ts
// Shared server context — stores, registries, projections

import { Effect, Layer, ManagedRuntime } from "effect";
import {
  type ConfigStoreService,
  EventStorePostgres,
  type EventStoreService,
  EventStoreTag,
} from "@bernays/server/store";
import {
  type AnyPlatform,
  createPlatformRegistry,
  type PlatformDefinition,
  type PlatformRegistry,
} from "@bernays/server/platforms";
import {
  type Injector,
  makeInjectionLayer,
  makeInjectorTag,
  makeProjectionLayer,
  makeProjectionTag,
  type Projection,
} from "@bernays/server/projections";
import {
  BRIEFING_SCOPE,
  ParticipantIdFromString,
  type Scope,
} from "@bernays/server/core";
import { BriefingEventSchema } from "@bernays/server/events";
import type { BaseAccount } from "@bernays/server/views";
import type { StorableEvent } from "@bernays/server/store";

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
  readonly get: (
    id: string,
  ) => Effect.Effect<import("effect").Option.Option<BaseAccount>>;
  readonly list: () => Effect.Effect<readonly BaseAccount[]>;
}

export interface ServerContext {
  /** The event store service — used by the GET /events endpoint for unscoped queries. */
  readonly eventStore: EventStoreService;
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
  p: PlatformDefinition<any, any, any, any, any, any, any, any, any, any>,
): AnyPlatform => p as AnyPlatform;

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

  // Build a managed runtime for the EventStore so the Layer's scope
  // (SQL connection + poll fiber) stays alive for the server's lifetime.
  const eventStoreRuntime = ManagedRuntime.make(
    EventStorePostgres({ databaseUrl }),
  );
  const eventStore = await eventStoreRuntime.runPromise(EventStoreTag);

  const { createPostgresConfigStore } = await import("@bernays/server/store");
  const configStore = await createPostgresConfigStore({
    connectionString: databaseUrl,
  });

  // Register platforms
  const registry = createPlatformRegistry(PLATFORMS);

  // Provide a Layer.succeed layer for injection/projection layers so they
  // share the same already-initialised EventStoreService.
  const eventStoreLayer = Layer.succeed(EventStoreTag, eventStore);

  const injectors = new Map<Scope, Injector<StorableEvent>>();
  const projections = new Map<Scope, Projection<StorableEvent>>();

  for (const platform of PLATFORMS) {
    const scope = platform.scope;
    const schema = platform.eventSchema;

    const injTag = makeInjectorTag<StorableEvent>(`${scope}/Injection`);
    const projTag = makeProjectionTag<StorableEvent>(`${scope}/Projection`);

    const injLayer = makeInjectionLayer(injTag, scope, schema).pipe(
      Layer.provide(eventStoreLayer),
    );
    const projLayer = makeProjectionLayer(projTag, scope, schema).pipe(
      Layer.provide(eventStoreLayer),
    );

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
