// src/briefing/service.ts
// High-level Briefing service for sockpuppets and the brief user gateway
//
// All participants write to a single shared event store. No HTTP
// transport — the store is the rendezvous point. Each participant
// is identified by an AgentId provided at construction time.
//
// Writes go through Injector, reads go through Projection. The service
// never sees the raw EventStore.

import { Context, Effect, Layer, Option } from "effect";
import type { BriefingEvent } from "$/events/briefing.ts";
import { BRIEFING_SCOPE } from "$/core/scope.ts";
import { AgentId, BriefingId, CorrelationId, EventId } from "$/core/branded.ts";
import type { Injector } from "$/projections/injector.ts";
import type { Projection } from "$/projections/projection.ts";
import { BriefingEventSchema } from "$/events/briefing.ts";
import { makeInjectorTag, makeInjectionLayer } from "$/projections/injector.ts";
import {
  makeProjectionTag,
  makeProjectionLayer,
} from "$/projections/projection.ts";
import {
  type BriefingView,
  deriveBriefings,
  getActiveBriefings,
} from "./view.ts";

// =============================================================================
// Error Type
// =============================================================================

export type BriefingErrorCode =
  | "NotFound"
  | "InvalidState"
  | "InjectionFailed";

export interface BriefingError {
  readonly _tag: "BriefingError";
  readonly code: BriefingErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const briefingError = (
  code: BriefingErrorCode,
  message: string,
  cause?: unknown,
): BriefingError => ({ _tag: "BriefingError", code, message, cause });

// =============================================================================
// Service Interface
// =============================================================================

export interface BriefingService {
  /** All briefings where this agent is the recipient and hasn't responded yet. */
  readonly pending: Effect.Effect<readonly BriefingView[]>;
  /** All briefings currently in progress. */
  readonly active: Effect.Effect<readonly BriefingView[]>;
  /** All briefings this agent is involved in. */
  readonly all: Effect.Effect<readonly BriefingView[]>;
  /** Look up a single briefing. */
  readonly get: (id: string) => Effect.Effect<Option.Option<BriefingView>>;

  /** Request a new briefing with another agent. */
  readonly request: (
    agent: string,
    topic: string,
    options?: {
      scheduledAt?: string;
      context?: Record<string, unknown>;
    },
  ) => Effect.Effect<BriefingView, BriefingError>;

  /** Accept a pending briefing request. */
  readonly accept: (
    briefingId: string,
  ) => Effect.Effect<BriefingView, BriefingError>;

  /** Decline a pending briefing request. */
  readonly decline: (
    briefingId: string,
    reason?: string,
  ) => Effect.Effect<BriefingView, BriefingError>;

  /** Send a message in an active briefing. */
  readonly send: (
    briefingId: string,
    content: string,
  ) => Effect.Effect<void, BriefingError>;

  /** End a briefing, optionally with a reason and structured summary. */
  readonly end: (
    briefingId: string,
    options?: {
      reason?: string;
      summary?: Record<string, unknown>;
    },
  ) => Effect.Effect<BriefingView, BriefingError>;
}

/** Tag for the BriefingService — sockpuppets yield* this. */
export class Briefing extends Context.Tag("sockpuppet/Briefing")<
  Briefing,
  BriefingService
>() {}

// =============================================================================
// Scoped Tags for Briefing's Injection/Projection
// =============================================================================

/** Injector tag for briefing events. */
export const BriefingInjection = makeInjectorTag<BriefingEvent>(
  "briefing/Injection",
);

/** Projection tag for briefing events. */
export const BriefingProjection = makeProjectionTag<BriefingEvent>(
  "briefing/Projection",
);

// =============================================================================
// Briefing Injection/Projection Layers
// =============================================================================

/** Layer providing BriefingInjection. Depends on EventStoreTag. */
export const BriefingInjectionLive = makeInjectionLayer(
  BriefingInjection,
  BRIEFING_SCOPE,
  BriefingEventSchema,
);

/** Layer providing BriefingProjection. Depends on EventStoreTag. */
export const BriefingProjectionLive = makeProjectionLayer(
  BriefingProjection,
  BRIEFING_SCOPE,
  BriefingEventSchema,
);

// =============================================================================
// Implementation
// =============================================================================

const makeEventBase = () => ({
  scope: BRIEFING_SCOPE,
  eventId: EventId(crypto.randomUUID()),
  timestamp: new Date().toISOString(),
  correlationId: CorrelationId(crypto.randomUUID()),
});

const makeBriefingServiceImpl = (
  self: AgentId,
  injector: Injector<BriefingEvent>,
  projection: Projection<BriefingEvent>,
): BriefingService => {
  const injectEvent = (
    event: BriefingEvent,
  ): Effect.Effect<void, BriefingError> =>
    injector.append(event).pipe(
      Effect.catchAll((err) =>
        Effect.fail(
          briefingError(
            "InjectionFailed",
            `Failed to record event: ${err.message}`,
            err,
          ),
        )
      ),
    );

  const allEvents = (): Effect.Effect<readonly BriefingEvent[]> =>
    projection.query().pipe(
      Effect.catchAll(() => Effect.succeed([] as readonly BriefingEvent[])),
    );

  const allViews = (): Effect.Effect<ReadonlyMap<string, BriefingView>> =>
    Effect.map(allEvents(), (events) => deriveBriefings(events, self));

  const getBriefingOrFail = (
    briefingId: string,
  ): Effect.Effect<BriefingView, BriefingError> =>
    Effect.flatMap(allViews(), (views) => {
      const b = views.get(briefingId);
      return b ? Effect.succeed(b) : Effect.fail(
        briefingError("NotFound", `Briefing not found: ${briefingId}`),
      );
    });

  return {
    pending: Effect.map(allEvents(), (events) => {
      const all = deriveBriefings(events, self);
      return [...all.values()].filter(
        (b) => b.status === "requested" && b.toAgent === self,
      );
    }),

    active: Effect.map(allEvents(), (events) => {
      return getActiveBriefings(events, self).filter((b) =>
        b.status === "active"
      );
    }),

    all: Effect.map(allViews(), (views) => [...views.values()]),

    get: (id) =>
      Effect.map(allViews(), (views) => {
        const b = views.get(id);
        return b ? Option.some(b) : Option.none();
      }),

    request: (agent, topic, options) =>
      Effect.gen(function* () {
        const briefingId = crypto.randomUUID();

        const requestedEvent: BriefingEvent = {
          ...makeEventBase(),
          type: "BriefingRequested" as const,
          briefingId: BriefingId(briefingId),
          fromAgent: self,
          toAgent: AgentId(agent),
          topic,
          scheduledAt: options?.scheduledAt,
          context: options?.context,
        };
        yield* injectEvent(requestedEvent);

        return yield* getBriefingOrFail(briefingId);
      }),

    accept: (briefingId) =>
      Effect.gen(function* () {
        const existing = yield* getBriefingOrFail(briefingId);

        if (existing.status !== "requested") {
          return yield* Effect.fail(
            briefingError(
              "InvalidState",
              `Cannot accept briefing in state: ${existing.status}`,
            ),
          );
        }

        const acceptedEvent: BriefingEvent = {
          ...makeEventBase(),
          type: "BriefingAccepted" as const,
          briefingId: BriefingId(briefingId),
          acceptedBy: self,
        };
        yield* injectEvent(acceptedEvent);

        return yield* getBriefingOrFail(briefingId);
      }),

    decline: (briefingId, reason?) =>
      Effect.gen(function* () {
        const existing = yield* getBriefingOrFail(briefingId);

        if (existing.status !== "requested") {
          return yield* Effect.fail(
            briefingError(
              "InvalidState",
              `Cannot decline briefing in state: ${existing.status}`,
            ),
          );
        }

        const declinedEvent: BriefingEvent = {
          ...makeEventBase(),
          type: "BriefingDeclined" as const,
          briefingId: BriefingId(briefingId),
          declinedBy: self,
          reason,
        };
        yield* injectEvent(declinedEvent);

        return yield* getBriefingOrFail(briefingId);
      }),

    send: (briefingId, content) =>
      Effect.gen(function* () {
        const existing = yield* getBriefingOrFail(briefingId);

        if (existing.status !== "active" && existing.status !== "requested") {
          return yield* Effect.fail(
            briefingError(
              "InvalidState",
              `Cannot send message to briefing in state: ${existing.status}`,
            ),
          );
        }

        const messageEvent: BriefingEvent = {
          ...makeEventBase(),
          type: "BriefingMessageSent" as const,
          briefingId: BriefingId(briefingId),
          sender: self,
          content,
        };
        yield* injectEvent(messageEvent);
      }),

    end: (briefingId, options) =>
      Effect.gen(function* () {
        const existing = yield* getBriefingOrFail(briefingId);

        if (existing.status === "ended" || existing.status === "declined") {
          return yield* Effect.fail(
            briefingError(
              "InvalidState",
              `Cannot end briefing in state: ${existing.status}`,
            ),
          );
        }

        const endEvent: BriefingEvent = {
          ...makeEventBase(),
          type: "BriefingEnded" as const,
          briefingId: BriefingId(briefingId),
          endedBy: self,
          reason: options?.reason,
          summary: options?.summary,
        };
        yield* injectEvent(endEvent);

        return yield* getBriefingOrFail(briefingId);
      }),
  };
};

// =============================================================================
// Briefing Layer
// =============================================================================

/**
 * Create a Layer that provides the Briefing service.
 * Depends on BriefingInjection and BriefingProjection.
 */
export const makeBriefingLayer = (self: AgentId) =>
  Layer.effect(
    Briefing,
    Effect.gen(function* () {
      const injector = yield* BriefingInjection;
      const projection = yield* BriefingProjection;
      return makeBriefingServiceImpl(self, injector, projection);
    }),
  );
