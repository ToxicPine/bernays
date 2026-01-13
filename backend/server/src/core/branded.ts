// packages/master/src/core/branded.ts
// Branded types for compile-time ID safety

/**
 * Branded type utility - adds a phantom type tag to T.
 * Prevents accidentally mixing up IDs that are structurally the same.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ThreadId = Brand<string, "ThreadId">;

export type CanonicalId = Brand<string, "CanonicalId">;
export type AccountId = Brand<string, "AccountId">;
export type EventId = Brand<string, "EventId">;
export type CorrelationId = Brand<string, "CorrelationId">;
export type CausationId = Brand<string, "CausationId">;
export type IntentId = Brand<string, "IntentId">;
export type Scope = Brand<string, "Scope">;

export type BrowserConfigId = Brand<string, "BrowserConfigId">;
export type ExtensionId = Brand<string, "ExtensionId">;

/**
 * Constructor functions: Cast a string to its branded type.
 * These are identity functions but enforce type safety at the call site.
 */
export const ThreadId = (value: string): ThreadId => value as ThreadId;
export const CanonicalId = (value: string): CanonicalId => value as CanonicalId;
export const AccountId = (value: string): AccountId => value as AccountId;
export const EventId = (value: string): EventId => value as EventId;
export const CorrelationId = (value: string): CorrelationId =>
  value as CorrelationId;
export const CausationId = (value: string): CausationId => value as CausationId;
export const IntentId = (value: string): IntentId => value as IntentId;
export const Scope = (value: string): Scope => value as Scope;
export const BrowserConfigId = (value: string): BrowserConfigId =>
  value as BrowserConfigId;
export const ExtensionId = (value: string): ExtensionId => value as ExtensionId;

/** Check if a value is a valid UUID string */
export const isUUID = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
};
