// packages/master/src/core/branded.ts
// Branded types for compile-time ID safety

import { z } from "@zod/zod";

/**
 * Branded type utility - adds a phantom type tag to T.
 * Prevents accidentally mixing up IDs that are structurally the same.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type ThreadId = Brand<string, "ThreadId">;

export type CanonicalId = Brand<string, "CanonicalId">;

export type ParticipantId<TScope extends string = string> = string & {
  readonly __brand: "ParticipantId";
  readonly __scope: TScope;
};
export type EventId = Brand<string, "EventId">;
export type CorrelationId = Brand<string, "CorrelationId">;
export type CausationId = Brand<string, "CausationId">;
export type IntentId = Brand<string, "IntentId">;
export type Scope = Brand<string, "Scope">;

export type BrowserConfigId = Brand<string, "BrowserConfigId">;
export type BriefingId = Brand<string, "BriefingId">;
export type AgentId = Brand<string, "AgentId">;

export const ThreadId = (value: string): ThreadId => value as ThreadId;
export const CanonicalId = (value: string): CanonicalId => value as CanonicalId;

export const ParticipantId = <TScope extends string>(
  scope: TScope,
  platformId: string,
): ParticipantId<TScope> => `${scope}:${platformId}` as ParticipantId<TScope>;

export const ParticipantIdFromString = <TScope extends string = string>(
  value: string,
): ParticipantId<TScope> => value as ParticipantId<TScope>;

export const getParticipantPlatformId = (id: ParticipantId): string =>
  id.split(":")[1] ?? "";

export const getParticipantScope = (id: ParticipantId): string =>
  id.split(":")[0] ?? "";

export const participantIdSchema = <TScope extends string>(scope: TScope) =>
  z
    .string()
    .refine(
      (s): s is `${TScope}:${string}` => s.startsWith(`${scope}:`),
      { message: `ParticipantId Must Be Prefixed With "${scope}:"` },
    )
    .transform((s): ParticipantId<TScope> => s as ParticipantId<TScope>);
export const EventId = (value: string): EventId => value as EventId;
export const CorrelationId = (value: string): CorrelationId =>
  value as CorrelationId;
export const CausationId = (value: string): CausationId => value as CausationId;
export const IntentId = (value: string): IntentId => value as IntentId;
export const Scope = (value: string): Scope => value as Scope;
export const BrowserConfigId = (value: string): BrowserConfigId =>
  value as BrowserConfigId;
export const BriefingId = (value: string): BriefingId => value as BriefingId;
export const AgentId = (value: string): AgentId => value as AgentId;

export const isUUID = (value: unknown): value is string => {
  return z.uuid().safeParse(value).success;
};
