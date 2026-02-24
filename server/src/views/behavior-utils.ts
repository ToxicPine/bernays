// src/views/behavior-utils.ts
// Shared utilities for platform behavior derivation functions.
//
// These utilities eliminate duplication across platform behaviors by providing
// common implementations for converting graph data to view types.

import type { ParticipantId } from "$/core/mod.ts";
import {
  type GraphMessage,
  graphNodesToMessages,
  type ThreadGraph,
} from "./graph.ts";
import type { MessageView, Participant } from "./thread.ts";

/**
 * Convert graph nodes to MessageView format.
 *
 * This is a shared utility for platform behaviors to convert ThreadGraph nodes
 * into the MessageView format used by thread views.
 *
 * Note: TIdentity (the identity scope for ParticipantIds) may differ from the
 * ThreadGraph's event scope. For example, linkedindojo has event scope
 * "linkedindojo" but uses identity scope "linkedin" for ParticipantIds.
 *
 * @template TIdentity - The identity scope for ParticipantIds (e.g., "linkedin", "x")
 * @param graph - The thread graph containing message nodes
 * @returns Array of MessageView objects typed to the identity scope
 */
export const toMessageViews = <TIdentity extends string>(
  graph: ThreadGraph<string, GraphMessage, unknown>,
): readonly MessageView<TIdentity>[] =>
  graphNodesToMessages(graph.nodes).map((m) => ({
    id: m.canonicalId,
    senderId: m.senderId as ParticipantId<TIdentity>,
    content: m.content,
    timestamp: m.timestamp,
  }));

/**
 * Extract participants from an anchor with a participants array.
 *
 * This is a shared utility for platform behaviors to extract participant
 * information from anchor objects that contain a participants array.
 *
 * @template TScope - The platform identity scope (e.g., "linkedin", "x", "reddit")
 * @param anchor - Object containing a participants array of ParticipantIds
 * @returns Array of Participant objects
 */
export const extractParticipants = <TScope extends string>(
  anchor: { readonly participants: readonly ParticipantId<TScope>[] },
): readonly Participant<TScope>[] => anchor.participants.map((id) => ({ id }));
