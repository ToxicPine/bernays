// src/briefing/view.ts
// Derive briefing state from events — pure functions
//
// `endedBy` and message `sender` are written as `"self"` at event creation
// time when the local agent performs the action. Remote actions arrive with
// the remote agent's identity via the Host header. No normalization needed
// at derivation time.

import type { BriefingEvent } from "$/events/briefing.ts";

// =============================================================================
// Briefing View — discriminated union on status
// =============================================================================

export interface BriefingBase {
  readonly briefingId: string;
  readonly remoteAgent: string;
  readonly topic: string;
  readonly requestedAt: string;
  readonly scheduledAt?: string;
  readonly context?: Record<string, unknown>;
  readonly messages: readonly {
    readonly sender: "self" | (string & {});
    readonly content: string;
    readonly timestamp: string;
  }[];
}

export type BriefingView =
  | (BriefingBase & { readonly status: "requested" })
  | (BriefingBase & { readonly status: "declined"; readonly endReason?: string })
  | (BriefingBase & { readonly status: "active"; readonly acceptedAt: string })
  | (BriefingBase & {
      readonly status: "ended";
      readonly acceptedAt: string;
      readonly endedBy: "self" | (string & {});
      readonly endedAt: string;
      readonly endReason?: string;
      readonly summary?: Record<string, unknown>;
    });

export type BriefingStatus = BriefingView["status"];

// =============================================================================
// Internal mutable accumulator
// =============================================================================

interface BriefingAccumulator {
  briefingId: string;
  fromAgent: string;
  toAgent: string;
  topic: string;
  requestedAt: string;
  scheduledAt?: string;
  context?: Record<string, unknown>;
  messages: { sender: string; content: string; timestamp: string }[];
  status: BriefingStatus;
  acceptedAt?: string;
  endedBy?: string;
  endedAt?: string;
  endReason?: string;
  summary?: Record<string, unknown>;
}

const toView = (acc: BriefingAccumulator): BriefingView => {
  // The remote agent is whichever of fromAgent/toAgent is not "self".
  // When this agent initiated, fromAgent was written as "self".
  // When this agent received, toAgent was written as "self".
  const remoteAgent =
    acc.fromAgent === "self" ? acc.toAgent : acc.fromAgent;

  const base: BriefingBase = {
    briefingId: acc.briefingId,
    remoteAgent,
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
      return { ...base, status: "declined", endReason: acc.endReason };
    case "active":
      return { ...base, status: "active", acceptedAt: acc.acceptedAt! };
    case "ended":
      return {
        ...base,
        status: "ended",
        acceptedAt: acc.acceptedAt!,
        endedBy: acc.endedBy!,
        endedAt: acc.endedAt!,
        endReason: acc.endReason,
        summary: acc.summary,
      };
  }
};

// =============================================================================
// Derivation
// =============================================================================

/**
 * Derive all briefing views from events.
 */
export const deriveBriefings = (
  events: readonly BriefingEvent[],
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
          existing.endReason = event.reason;
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
          existing.endReason = event.reason;
          existing.summary = event.summary;
          existing.endedAt = event.timestamp;
        }
        break;
      }
    }
  }

  const result = new Map<string, BriefingView>();
  for (const [id, acc] of accumulators) {
    result.set(id, toView(acc));
  }
  return result;
};

/**
 * Get active briefings (requested or in-progress).
 */
export const getActiveBriefings = (
  events: readonly BriefingEvent[],
): readonly BriefingView[] => {
  const all = deriveBriefings(events);
  return [...all.values()].filter(
    (b) => b.status === "requested" || b.status === "active",
  );
};

/**
 * Get a specific briefing by ID.
 */
export const getBriefing = (
  events: readonly BriefingEvent[],
  briefingId: string,
): BriefingView | undefined => {
  const all = deriveBriefings(events);
  return all.get(briefingId);
};
