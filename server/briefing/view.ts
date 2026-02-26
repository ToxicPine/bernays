// src/briefing/view.ts
// Derive briefing state from events — pure functions
//
// Events store real AgentId values. The view layer uses the caller's
// identity only for filtering (which briefings are mine), not for
// transforming field values.

import type { AgentId } from "$/core/branded.ts";
import type { BriefingEvent } from "$/events/briefing.ts";

// =============================================================================
// Briefing View — discriminated union on status
// =============================================================================

export interface BriefingBase {
  readonly briefingId: string;
  readonly fromAgent: AgentId;
  readonly toAgent: AgentId;
  readonly topic: string;
  readonly requestedAt: string;
  readonly scheduledAt?: string;
  readonly context?: Record<string, unknown>;
  readonly messages: readonly {
    readonly sender: AgentId;
    readonly content: string;
    readonly timestamp: string;
  }[];
}

export type BriefingView =
  | (BriefingBase & { readonly status: "requested" })
  | (BriefingBase & { readonly status: "declined"; readonly reason?: string })
  | (BriefingBase & { readonly status: "active"; readonly acceptedAt: string })
  | (BriefingBase & {
    readonly status: "ended";
    readonly acceptedAt: string;
    readonly endedBy: AgentId;
    readonly endedAt: string;
    readonly reason?: string;
    readonly summary?: Record<string, unknown>;
  });

export type BriefingStatus = BriefingView["status"];

// =============================================================================
// Internal mutable accumulator
// =============================================================================

interface BriefingAccumulator {
  briefingId: string;
  fromAgent: AgentId;
  toAgent: AgentId;
  topic: string;
  requestedAt: string;
  scheduledAt?: string;
  context?: Record<string, unknown>;
  messages: { sender: AgentId; content: string; timestamp: string }[];
  status: BriefingStatus;
  acceptedAt?: string;
  endedBy?: AgentId;
  endedAt?: string;
  reason?: string;
  summary?: Record<string, unknown>;
}

const toView = (acc: BriefingAccumulator): BriefingView => {
  const base: BriefingBase = {
    briefingId: acc.briefingId,
    fromAgent: acc.fromAgent,
    toAgent: acc.toAgent,
    topic: acc.topic,
    requestedAt: acc.requestedAt,
    scheduledAt: acc.scheduledAt,
    context: acc.context,
    messages: acc.messages,
  };

  switch (acc.status) {
    case "requested":
      return { ...base, status: "requested" };
    case "declined":
      return { ...base, status: "declined", reason: acc.reason };
    case "active":
      return { ...base, status: "active", acceptedAt: acc.acceptedAt! };
    case "ended":
      return {
        ...base,
        status: "ended",
        acceptedAt: acc.acceptedAt!,
        endedBy: acc.endedBy!,
        endedAt: acc.endedAt!,
        reason: acc.reason,
        summary: acc.summary,
      };
  }
};

// =============================================================================
// Derivation
// =============================================================================

/**
 * Derive all briefing views from events, filtered to briefings that
 * involve the given agent.
 */
export const deriveBriefings = (
  events: readonly BriefingEvent[],
  self: AgentId,
): ReadonlyMap<string, BriefingView> => {
  const accumulators = new Map<string, BriefingAccumulator>();

  for (const event of events) {
    const id = event.briefingId as string;

    switch (event.type) {
      case "BriefingRequested": {
        accumulators.set(id, {
          briefingId: id,
          fromAgent: event.fromAgent,
          toAgent: event.toAgent,
          topic: event.topic,
          status: "requested",
          messages: [],
          context: event.context,
          requestedAt: event.timestamp,
          scheduledAt: event.scheduledAt,
        });
        break;
      }
      case "BriefingAccepted": {
        const existing = accumulators.get(id);
        if (existing) {
          existing.status = "active";
          existing.acceptedAt = event.timestamp;
        }
        break;
      }
      case "BriefingDeclined": {
        const existing = accumulators.get(id);
        if (existing) {
          existing.status = "declined";
          existing.reason = event.reason;
        }
        break;
      }
      case "BriefingMessageSent": {
        const existing = accumulators.get(id);
        if (existing) {
          if (existing.status !== "declined" && existing.status !== "ended") {
            existing.status = "active";
          }
          existing.messages.push({
            sender: event.sender,
            content: event.content,
            timestamp: event.timestamp,
          });
        }
        break;
      }
      case "BriefingEnded": {
        const existing = accumulators.get(id);
        if (existing) {
          existing.status = "ended";
          existing.endedBy = event.endedBy;
          existing.reason = event.reason;
          existing.summary = event.summary;
          existing.endedAt = event.timestamp;
        }
        break;
      }
    }
  }

  // Filter to briefings involving this agent
  const result = new Map<string, BriefingView>();
  for (const [id, acc] of accumulators) {
    if (acc.fromAgent === self || acc.toAgent === self) {
      result.set(id, toView(acc));
    }
  }
  return result;
};

/**
 * Get active briefings (requested or in-progress) for the given agent.
 */
export const getActiveBriefings = (
  events: readonly BriefingEvent[],
  self: AgentId,
): readonly BriefingView[] => {
  const all = deriveBriefings(events, self);
  return [...all.values()].filter(
    (b) => b.status === "requested" || b.status === "active",
  );
};

/**
 * Get a specific briefing by ID (only if the agent is a participant).
 */
export const getBriefing = (
  events: readonly BriefingEvent[],
  self: AgentId,
  briefingId: string,
): BriefingView | undefined => {
  const all = deriveBriefings(events, self);
  return all.get(briefingId);
};
