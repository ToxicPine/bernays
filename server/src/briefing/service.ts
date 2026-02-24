// src/briefing/service.ts
// High-level Briefing service for sockpuppets
//
// Wraps the low-level BriefingClient (outbound HTTP), local event
// injection/projection, and agent name resolution into a single
// interface that sockpuppets yield*.

import { Context, Effect, Option } from "effect";
import type { BriefingEvent } from "$/events/briefing.ts";
import { BRIEFING_SCOPE } from "$/core/scope.ts";
import {
  BriefingId,
  CorrelationId,
  EventId,
} from "$/core/branded.ts";
import type { Injector } from "$/projections/injector.ts";
import type { EventStore, StorableEvent } from "$/store/mod.ts";
import { BriefingEventSchema } from "$/events/briefing.ts";
import { makeInjector } from "$/projections/injector.ts";
import {
  type BriefingView,
  deriveBriefings,
  getActiveBriefings,
} from "./view.ts";
import {
  type BriefingClientService,
  makeBriefingClient,
} from "./client.ts";

// =============================================================================
// Error Type
// =============================================================================

export type BriefingErrorCode =
  | "NotFound"
  | "InvalidState"
  | "InjectionFailed"
  | "RemoteFailed"
  | "ResolutionFailed";

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
// Agent Registry
// =============================================================================

/**
 * Maps agent names to flycast URLs.
 * Provided at layer composition time.
 */
export type AgentRegistry = (agent: string) => string | undefined;

/**
 * Simple registry: maps name -> http://<name>.flycast
 */
export const flycastRegistry: AgentRegistry = (agent: string) =>
  `http://${agent}.flycast`;

// =============================================================================
// Service Interface
// =============================================================================

export interface BriefingService {
  /** All briefings where this agent hasn't responded yet. */
  readonly pending: Effect.Effect<readonly BriefingView[]>;
  /** All briefings currently in progress. */
  readonly active: Effect.Effect<readonly BriefingView[]>;
  /** All briefings regardless of status. */
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
// Configuration
// =============================================================================

export interface BriefingRuntimeConfig {
  /** This agent's identity (e.g., "agent-a" or "agent-a.flycast") */
  readonly agentId: string;
  /** The event store for local event recording */
  readonly eventStore: EventStore<StorableEvent>;
  /** Resolve agent names to URLs. Defaults to flycastRegistry. */
  readonly agentRegistry?: AgentRegistry;
  /** HTTP client timeout in ms. Defaults to 30_000. */
  readonly timeoutMs?: number;
}

// =============================================================================
// Implementation
// =============================================================================

const makeEventBase = () => ({
  scope: BRIEFING_SCOPE,
  eventId: EventId(crypto.randomUUID()),
  timestamp: new Date().toISOString(),
  correlationId: CorrelationId(crypto.randomUUID()),
});

const fetchLocalBriefingEvents = async (
  eventStore: EventStore<StorableEvent>,
): Promise<readonly BriefingEvent[]> => {
  const result = await eventStore.fetch({
    type: "byScope",
    scope: BRIEFING_SCOPE,
  });
  if (!result.ok) return [];

  const events: BriefingEvent[] = [];
  for (const raw of result.value) {
    const parsed = BriefingEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
};

export const makeBriefingService = (
  config: BriefingRuntimeConfig,
): BriefingService => {
  const { agentId, eventStore } = config;
  const registry = config.agentRegistry ?? flycastRegistry;
  const client: BriefingClientService = makeBriefingClient(
    config.timeoutMs ?? 30_000,
  );
  const injector: Injector<BriefingEvent> = makeInjector(
    BRIEFING_SCOPE,
    BriefingEventSchema,
    eventStore,
  );

  const resolveAgent = (agent: string): Effect.Effect<string, BriefingError> => {
    const url = registry(agent);
    if (!url) {
      return Effect.fail(
        briefingError("ResolutionFailed", `Cannot resolve agent: ${agent}`),
      );
    }
    return Effect.succeed(url);
  };

  const injectEvent = (event: BriefingEvent): Effect.Effect<void, BriefingError> =>
    injector.append(event).pipe(
      Effect.catchAll((err) =>
        Effect.fail(
          briefingError("InjectionFailed", `Failed to record event: ${err.message}`, err),
        )
      ),
    );

  const allEvents = (): Effect.Effect<readonly BriefingEvent[]> =>
    Effect.promise(() => fetchLocalBriefingEvents(eventStore));

  const allViews = (): Effect.Effect<ReadonlyMap<string, BriefingView>> =>
    Effect.map(allEvents(), deriveBriefings);

  const getBriefingOrFail = (
    briefingId: string,
  ): Effect.Effect<BriefingView, BriefingError> =>
    Effect.flatMap(allViews(), (views) => {
      const b = views.get(briefingId);
      return b
        ? Effect.succeed(b)
        : Effect.fail(briefingError("NotFound", `Briefing not found: ${briefingId}`));
    });

  return {
    pending: Effect.map(allEvents(), (events) => {
      const all = deriveBriefings(events);
      return [...all.values()].filter((b) => b.status === "requested");
    }),

    active: Effect.map(allEvents(), (events) => {
      return getActiveBriefings(events).filter((b) => b.status === "active");
    }),

    all: Effect.map(allViews(), (views) => [...views.values()]),

    get: (id) =>
      Effect.map(allViews(), (views) => {
        const b = views.get(id);
        return b ? Option.some(b) : Option.none();
      }),

    request: (agent, topic, options) =>
      Effect.gen(function* () {
        const remoteUrl = yield* resolveAgent(agent);
        const briefingId = crypto.randomUUID();

        // Record locally — "self" is the initiator
        const requestedEvent: BriefingEvent = {
          ...makeEventBase(),
          type: "BriefingRequested" as const,
          briefingId: BriefingId(briefingId),
          fromAgent: "self",
          toAgent: agent,
          topic,
          scheduledAt: options?.scheduledAt,
          context: options?.context,
        };
        yield* injectEvent(requestedEvent);

        // Call remote
        const response = yield* client
          .requestBriefing(remoteUrl, {
            briefingId,
            fromAgent: agentId,
            topic,
            scheduledAt: options?.scheduledAt,
            context: options?.context,
          })
          .pipe(
            Effect.catchAll((err) =>
              Effect.fail(
                briefingError("RemoteFailed", err.message, err),
              )
            ),
          );

        // Record remote's response locally
        if (response.accepted) {
          const acceptedEvent: BriefingEvent = {
            ...makeEventBase(),
            type: "BriefingAccepted" as const,
            briefingId: BriefingId(briefingId),
            fromAgent: "self",
            toAgent: agent,
          };
          yield* injectEvent(acceptedEvent);
        } else {
          const declinedEvent: BriefingEvent = {
            ...makeEventBase(),
            type: "BriefingDeclined" as const,
            briefingId: BriefingId(briefingId),
            fromAgent: "self",
            toAgent: agent,
            reason: response.reason,
          };
          yield* injectEvent(declinedEvent);
        }

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
          fromAgent: existing.remoteAgent,
          toAgent: "self",
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
          fromAgent: existing.remoteAgent,
          toAgent: "self",
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

        // Record locally — sender is "self"
        const messageEvent: BriefingEvent = {
          ...makeEventBase(),
          type: "BriefingMessageSent" as const,
          briefingId: BriefingId(briefingId),
          sender: "self",
          content,
        };
        yield* injectEvent(messageEvent);

        // Send to remote
        const remoteUrl = yield* resolveAgent(existing.remoteAgent);

        yield* client
          .sendMessage(remoteUrl, briefingId, {
            sender: agentId,
            content,
          })
          .pipe(
            Effect.catchAll((err) =>
              Effect.fail(
                briefingError("RemoteFailed", err.message, err),
              )
            ),
          );
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

        // Record locally — endedBy is "self"
        const endEvent: BriefingEvent = {
          ...makeEventBase(),
          type: "BriefingEnded" as const,
          briefingId: BriefingId(briefingId),
          endedBy: "self",
          reason: options?.reason,
          summary: options?.summary,
        };
        yield* injectEvent(endEvent);

        // Notify remote
        const remoteUrl = yield* resolveAgent(existing.remoteAgent);

        yield* client
          .endBriefing(remoteUrl, briefingId, {
            endedBy: agentId,
            reason: options?.reason,
            summary: options?.summary,
          })
          .pipe(
            Effect.catchAll((err) =>
              Effect.fail(
                briefingError("RemoteFailed", err.message, err),
              )
            ),
          );

        return yield* getBriefingOrFail(briefingId);
      }),
  };
};
