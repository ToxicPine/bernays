// api/src/context.ts
// Shared server context — stores, registries, projections

import { Effect } from "effect";
import type { z } from "@zod/zod";
import {
  type EventStore,
  type StorableEvent,
  configurePostgresEventStore,
  createPostgresConfigStore,
  type ConfigStoreService,
} from "@bernays/server/store";
import {
  type AnyPlatform,
  createPlatformRegistry,
  type PlatformRegistry,
} from "@bernays/server/platforms";
import { type Injector, makeInjector } from "@bernays/server/projections";
import { makeProjection, type Projection } from "@bernays/server/projections";
import type { Scope } from "@bernays/server/core";
import type { AccountStoreService } from "@bernays/server/core";
import type { BaseAccount } from "@bernays/server/views";

// Plugins
import {
  createPostgresLinkedInAccountStore,
  linkedInPlatform,
} from "@bernays/plugins/linkedin";

// =============================================================================
// Server Context
// =============================================================================

export interface ServerContext {
  readonly eventStore: EventStore<StorableEvent>;
  readonly configStore: ConfigStoreService;
  readonly registry: PlatformRegistry;
  readonly injectors: ReadonlyMap<Scope, Injector<StorableEvent>>;
  readonly projections: ReadonlyMap<Scope, Projection<StorableEvent>>;
  readonly accountStores: ReadonlyMap<string, AccountStoreService<string, BaseAccount<string>>>;
}

// =============================================================================
// Platform Registration
// =============================================================================

// Platform type erasure: PlatformDefinition has invariant type parameters
// (behavior methods are both covariant and contravariant), so TypeScript
// can't widen LinkedInPlatform → AnyPlatform directly. These casts are safe
// because the API layer only reads from behaviors (covariant position).
const PLATFORMS: readonly AnyPlatform[] = [
  linkedInPlatform as unknown as AnyPlatform,
  // xPlatform as unknown as AnyPlatform,
  // redditPlatform as unknown as AnyPlatform,
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
    const schema = platform.eventSchema as z.ZodType<StorableEvent>;
    injectors.set(scope, makeInjector(scope, schema, eventStore));
    projections.set(scope, makeProjection(scope, schema, eventStore));
  }

  // Create account stores per platform identity
  const accountStores = new Map<string, AccountStoreService<string, BaseAccount<string>>>();

  const linkedInAccountStore = await createPostgresLinkedInAccountStore({
    connectionString: databaseUrl,
  });
  // Same variance issue: AccountStoreService.get() is contravariant in TScope.
  // Safe here because we only call .list() and .get() (covariant reads).
  accountStores.set("linkedin", linkedInAccountStore as unknown as AccountStoreService<string, BaseAccount<string>>);

  return {
    eventStore,
    configStore,
    registry,
    injectors,
    projections,
    accountStores,
  };
};
