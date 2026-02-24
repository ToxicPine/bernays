// src/briefing/view.ts
// Derive briefing state from events — pure functions

import type { BriefingId } from "$/core/branded.ts";
import type { BriefingEvent } from "$/events/briefing.ts";

// =============================================================================
// Briefing Status
// =============================================================================

export type BriefingStatus =
  | "requested"
  | "accepted"
  | "declined"
  | "active"
  | "ended";

// =============================================================================
// Briefing View
// =============================================================================

export interface BriefingMessage {
  readonly sender: string;
  readonly content: string;
  readonly timestamp: string;
}

export interface BriefingView {
  readonly briefingId: string;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly topic: string;
  readonly status: BriefingStatus;
  readonly messages: readonly BriefingMessage[];
  readonly context?: Record<string, unknown>;
  readonly endedBy?: string;
  readonly endReason?: string;
  readonly summary?: Record<string, unknown>;
  readonly requestedAt: string;
  /** When the briefing is scheduled (ISO 8601). Undefined = immediate. */
  readonly scheduledAt?: string;
  /** When the briefing was accepted (ISO 8601). */
  readonly acceptedAt?: string;
  readonly endedAt?: string;
}

// =============================================================================
// Derivation
// =============================================================================

/**
 * Derive all briefing views from events.
 */
export const deriveBriefings = (
  events: readonly BriefingEvent[],
): ReadonlyMap<string, BriefingView> => {
  const briefings = new Map<string, BriefingView>();

  for (const event of events) {
    const id = event.briefingId as string;

    switch (event.type) {
      case "BriefingRequested": {
        briefings.set(id, {
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
        const existing = briefings.get(id);
        if (existing) {
          briefings.set(id, {
            ...existing,
            status: "active",
            acceptedAt: event.timestamp,
          });
        }
        break;
      }
      case "BriefingDeclined": {
        const existing = briefings.get(id);
        if (existing) {
          briefings.set(id, {
            ...existing,
            status: "declined",
            endReason: event.reason,
          });
        }
        break;
      }
      case "BriefingMessageSent": {
        const existing = briefings.get(id);
        if (existing) {
          const msg: BriefingMessage = {
            sender: event.sender,
            content: event.content,
            timestamp: event.timestamp,
          };
          briefings.set(id, {
            ...existing,
            status: "active",
            messages: [...existing.messages, msg],
          });
        }
        break;
      }
      case "BriefingEnded": {
        const existing = briefings.get(id);
        if (existing) {
          briefings.set(id, {
            ...existing,
            status: "ended",
            endedBy: event.endedBy,
            endReason: event.reason,
            summary: event.summary,
            endedAt: event.timestamp,
          });
        }
        break;
      }
    }
  }

  return briefings;
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
