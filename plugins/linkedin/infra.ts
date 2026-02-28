// plugins/linkedin/infra.ts
// LinkedIn shared observation infrastructure — optional, for multi-account
//
// When running multiple sockpuppets, observing public state independently
// per-account wastes browser sessions and hits rate limits faster. This
// shared infra layer observes public state once. Each sockpuppet's sync
// fiber handles only its private state.
//
// For single-account deployments (the common case), this layer is optional.
// The per-sockpuppet sync fiber handles everything.

import { Context, Duration, Effect, Ref } from "effect";

// =============================================================================
// Public State Types
// =============================================================================

export interface FeedPost {
  readonly postUrn: string;
  readonly authorId: string;
  readonly content: string;
  readonly timestamp: string;
  readonly reactions: number;
  readonly comments: number;
}

export interface CompanyPage {
  readonly companyId: string;
  readonly name: string;
  readonly followers: number;
  readonly recentPosts: readonly string[];
}

export interface GroupPost {
  readonly groupId: string;
  readonly postUrn: string;
  readonly authorId: string;
  readonly content: string;
  readonly timestamp: string;
}

export interface PublicProfile {
  readonly memberId: string;
  readonly publicIdentifier: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly headline?: string;
  readonly occupation?: string;
}

export interface LinkedInPublicState {
  readonly feedPosts: Map<string, FeedPost>;
  readonly companyPages: Map<string, CompanyPage>;
  readonly groupPosts: Map<string, GroupPost>;
  readonly publicProfiles: Map<string, PublicProfile>;
}

// =============================================================================
// Cache Settings
// =============================================================================

export interface CacheResourceSettings {
  readonly ttl: Duration.Duration;
  readonly evictAfter: Duration.Duration;
  readonly watchInterval: Duration.Duration;
}

export interface LinkedInCacheSettings {
  readonly feedPost: CacheResourceSettings;
  readonly companyPage: CacheResourceSettings;
  readonly groupPost: CacheResourceSettings;
  readonly publicProfile: CacheResourceSettings;
}

export const defaultCacheSettings: LinkedInCacheSettings = {
  feedPost: {
    ttl: Duration.hours(1),
    evictAfter: Duration.hours(24),
    watchInterval: Duration.hours(4),
  },
  companyPage: {
    ttl: Duration.hours(6),
    evictAfter: Duration.hours(72),
    watchInterval: Duration.hours(24),
  },
  groupPost: {
    ttl: Duration.hours(1),
    evictAfter: Duration.hours(24),
    watchInterval: Duration.hours(4),
  },
  publicProfile: {
    ttl: Duration.hours(12),
    evictAfter: Duration.hours(168),
    watchInterval: Duration.hours(48),
  },
};

// =============================================================================
// Ensure/Watch Targets
// =============================================================================

export type EnsureTarget =
  | { readonly kind: "feedPost"; readonly postUrn: string }
  | { readonly kind: "companyPage"; readonly companyId: string }
  | {
      readonly kind: "groupPost";
      readonly groupId: string;
      readonly postUrn: string;
    }
  | { readonly kind: "publicProfile"; readonly memberId: string };

export type WatchTopic =
  | { readonly kind: "feed"; readonly query?: string }
  | { readonly kind: "company"; readonly companyId: string }
  | { readonly kind: "group"; readonly groupId: string };

// =============================================================================
// Infra Service Interface
// =============================================================================

export interface LinkedInInfraService {
  /** Shared public state. Read after calling ensureFetched. */
  readonly publicState: Ref.Ref<LinkedInPublicState>;

  /** Ensure a resource is in the cache and fresh (per cache settings TTL).
   *  No-op if already current. Scrapes via CDP and emits events on cache fill. */
  readonly ensureFetched: (target: EnsureTarget) => Effect.Effect<void>;

  /** Subscribe to autonomous refresh for a topic. */
  readonly watch: (topic: WatchTopic) => Effect.Effect<void>;

  /** Unsubscribe from autonomous refresh. */
  readonly unwatch: (topic: WatchTopic) => Effect.Effect<void>;
}

// =============================================================================
// Infra Context Tag
// =============================================================================

export class LinkedInInfra extends Context.Tag("linkedin/Infra")<
  LinkedInInfra,
  LinkedInInfraService
>() {}

// =============================================================================
// Empty Public State
// =============================================================================

export const emptyPublicState = (): LinkedInPublicState => ({
  feedPosts: new Map(),
  companyPages: new Map(),
  groupPosts: new Map(),
  publicProfiles: new Map(),
});

// =============================================================================
// Infra Layer Factory (stub — implemented when multi-account support needed)
// =============================================================================

// TODO: Implement makeLinkedInInfraLayer when multi-account observation is needed.
// const makeLinkedInInfraLayer = (
//   settings?: Partial<LinkedInCacheSettings>,
// ): Layer.Layer<LinkedInInfra, never, BrowserPool | EventStoreTag> => { ... };
