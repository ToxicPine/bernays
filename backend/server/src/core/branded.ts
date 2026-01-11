// packages/master/src/core/branded.ts
// Branded types for compile-time ID safety

// ============================================================================
// Brand Utility
// ============================================================================

/**
 * Branded type utility - adds a phantom type tag to T.
 * Prevents accidentally mixing up IDs that are structurally the same.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

// ============================================================================
// Branded ID Types
// ============================================================================

/** Thread identifier - prevents mixing with message IDs */
export type ThreadId = Brand<string, "ThreadId">;

/** Canonical message identifier - platform-independent */
export type CanonicalId = Brand<string, "CanonicalId">;

/** Account identifier - prevents mixing with user IDs */
export type AccountId = Brand<string, "AccountId">;

/** Event identifier - deduplication key */
export type EventId = Brand<string, "EventId">;

/** Correlation identifier - links related events */
export type CorrelationId = Brand<string, "CorrelationId">;

/** Causation identifier - links cause and effect */
export type CausationId = Brand<string, "CausationId">;

/** Intent identifier - tracks intent lifecycle */
export type IntentId = Brand<string, "IntentId">;

/** Scope identifier - platform or domain scope (e.g., "linkedin", "core") */
export type Scope = Brand<string, "Scope">;

/** Browser configuration identifier - distinguishes browser configs from instance IDs */
export type BrowserConfigId = Brand<string, "BrowserConfigId">;

/** Extension identifier - distinguishes extension IDs from other strings */
export type ExtensionId = Brand<string, "ExtensionId">;

// ============================================================================
// Constructor Functions
// ============================================================================

/** Create a ThreadId from a string */
export const ThreadId = (value: string): ThreadId => value as ThreadId;

/** Create a CanonicalId from a string */
export const CanonicalId = (value: string): CanonicalId => value as CanonicalId;

/** Create an AccountId from a string */
export const AccountId = (value: string): AccountId => value as AccountId;

/** Create an EventId from a string */
export const EventId = (value: string): EventId => value as EventId;

/** Create a CorrelationId from a string */
export const CorrelationId = (value: string): CorrelationId =>
  value as CorrelationId;

/** Create a CausationId from a string */
export const CausationId = (value: string): CausationId => value as CausationId;

/** Create an IntentId from a string */
export const IntentId = (value: string): IntentId => value as IntentId;

/** Create a Scope from a string */
export const Scope = (value: string): Scope => value as Scope;

/** Create a BrowserConfigId from a string */
export const BrowserConfigId = (value: string): BrowserConfigId =>
  value as BrowserConfigId;

/** Create an ExtensionId from a string */
export const ExtensionId = (value: string): ExtensionId => value as ExtensionId;

// ============================================================================
// Type Guards
// ============================================================================

/** Check if a value is a valid UUID string */
export const isUUID = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
};
