// providers/graph.ts
// Thread graph building from message events.
//
// Builds a graph structure from message events, preserving all platform-specific
// fields. Adapters use this to implement deriveInbox and deriveThread.
//
// Design:
// - Uses Zod schemas with .passthrough() to preserve platform fields
// - Generic types allow full type preservation at the platform level
// - Thread identity = canonicalId of the root anchor message

import { z } from "@zod/zod";
import {
  CanonicalId,
  type CanonicalId as CanonicalIdType,
  type ParticipantId as ParticipantIdType,
  ParticipantIdFromString,
  ThreadId,
} from "$/core/mod.ts";
import { type StorableEvent, StorableEventSchema } from "$/store/mod.ts";

// Graph Message Schemas

/**
 * Schema for anchor messages in the graph.
 * Uses .loose() to preserve platform-specific fields.
 */
export const GraphAnchorSchema = StorableEventSchema.extend({
  kind: z.literal("anchor"),
  canonicalId: z.string().transform(CanonicalId),
  senderId: z.string().transform(ParticipantIdFromString),
  content: z.string().optional(),
  anchor: z.unknown(),
}).loose();

export type GraphAnchor = z.infer<typeof GraphAnchorSchema>;

/**
 * Schema for reply messages in the graph.
 * Uses .loose() to preserve platform-specific fields.
 */
export const GraphReplySchema = StorableEventSchema.extend({
  kind: z.literal("reply"),
  canonicalId: z.string().transform(CanonicalId),
  senderId: z.string().transform(ParticipantIdFromString),
  predecessorId: z.string().transform(CanonicalId),
  content: z.string().optional(),
}).loose();

export type GraphReply = z.infer<typeof GraphReplySchema>;

/**
 * Schema for message mutation events.
 * Uses .loose() to preserve platform-specific fields.
 */
export const GraphMutationSchema = StorableEventSchema.extend({
  kind: z.literal("mutation"),
  canonicalId: z.string().transform(CanonicalId),
  mutation: z.enum(["deleted", "edited"]),
  editedContent: z.string().optional(),
}).loose();

export type GraphMutation = z.infer<typeof GraphMutationSchema>;

/**
 * Union of graph message types.
 */
export const GraphMessageSchema = z.discriminatedUnion("kind", [
  GraphAnchorSchema,
  GraphReplySchema,
]);
export type GraphMessage = z.infer<typeof GraphMessageSchema>;

/**
 * Type guard for anchor messages.
 */
export const isGraphAnchor = (msg: GraphMessage): msg is GraphAnchor =>
  msg.kind === "anchor";

/**
 * Union of all graph event types (messages + mutations).
 */
export const GraphEventSchema = z.discriminatedUnion("kind", [
  GraphAnchorSchema,
  GraphReplySchema,
  GraphMutationSchema,
]);
export type GraphEvent = z.infer<typeof GraphEventSchema>;

// Graph Node

/**
 * A node in the message graph.
 * TMessage allows platforms to preserve their full event type.
 */
export interface GraphNode<TMessage extends GraphMessage = GraphMessage> {
  readonly message: TMessage;
  readonly deleted: boolean;
  readonly editedContent?: string;
}

// Thread Graph

/**
 * A thread derived from the message graph.
 *
 * @template TScope - The platform scope (e.g., "linkedin", "x")
 * @template TMessage - The message event type (defaults to GraphMessage)
 * @template TAnchor - The anchor type (defaults to unknown)
 */
export interface ThreadGraph<
  TScope extends string = string,
  TMessage extends GraphMessage = GraphMessage,
  TAnchor = unknown,
> {
  /** Thread ID (derived from root message's canonicalId) */
  readonly id: ThreadId;
  readonly scope: TScope;
  readonly anchor: TAnchor;
  readonly nodes: readonly GraphNode<TMessage>[];
  readonly lastActivity: string;
}

// Graph State (internal)

interface NodeState {
  readonly message: GraphMessage;
  deleted: boolean;
  editedContent?: string;
}

interface GraphState {
  readonly nodes: Map<string, NodeState>;
  readonly children: Map<string, string[]>;
}

// Graph Builder

/**
 * Build thread graphs from a sequence of scope-filtered events.
 *
 * This is a utility function that behaviors use to build their
 * deriveInbox and deriveThread implementations. It processes
 * anchor, reply, and mutation events to build a thread graph.
 *
 * IMPORTANT: Events must be pre-filtered by scope via the Projection layer.
 * The scope parameter types the returned ThreadGraph instances, ensuring
 * compile-time safety when working with scope-specific threads.
 *
 * @template TScope - The platform scope (e.g., "linkedin", "x")
 * @template TMessage - The message event type (defaults to GraphMessage)
 * @template TAnchor - The anchor type (defaults to unknown)
 * @param scope - The platform scope for typing the output
 * @param events - Events to process (pre-filtered by scope from Projection)
 * @returns Map of ThreadId to scope-typed ThreadGraph
 */
export function buildThreadGraphs<
  TScope extends string,
  TMessage extends GraphMessage = GraphMessage,
  TAnchor = unknown,
>(
  scope: TScope,
  events: readonly StorableEvent[],
): Map<ThreadId, ThreadGraph<TScope, TMessage, TAnchor>> {
  const state: GraphState = {
    nodes: new Map(),
    children: new Map(),
  };

  for (const event of events) {
    const result = GraphEventSchema.safeParse(event);
    if (!result.success) continue;

    const parsed = result.data;

    if (parsed.kind === "anchor") {
      if (!state.nodes.has(parsed.canonicalId)) {
        state.nodes.set(parsed.canonicalId, {
          message: parsed,
          deleted: false,
        });
      }
    } else if (parsed.kind === "reply") {
      if (!state.nodes.has(parsed.canonicalId)) {
        state.nodes.set(parsed.canonicalId, {
          message: parsed,
          deleted: false,
        });

        const children = state.children.get(parsed.predecessorId) ?? [];
        children.push(parsed.canonicalId);
        state.children.set(parsed.predecessorId, children);
      }
    } else if (parsed.kind === "mutation") {
      const node = state.nodes.get(parsed.canonicalId);
      if (node) {
        if (parsed.mutation === "deleted") {
          node.deleted = true;
        } else if (parsed.editedContent !== undefined) {
          node.editedContent = parsed.editedContent;
        }
      }
    }
  }

  // Filter to anchor nodes using type guard for safe narrowing
  const roots = [...state.nodes.values()].filter(
    (n): n is NodeState & { message: GraphAnchor } => isGraphAnchor(n.message),
  );

  const result = new Map<ThreadId, ThreadGraph<TScope, TMessage, TAnchor>>();

  for (const root of roots) {
    const rootMsg = root.message;
    const threadNodes = collectThreadNodes(
      state.nodes,
      state.children,
      rootMsg.canonicalId,
    );
    threadNodes.sort((a, b) =>
      a.message.timestamp.localeCompare(b.message.timestamp)
    );

    const lastActivity = threadNodes.reduce(
      (max, n) => (n.message.timestamp > max ? n.message.timestamp : max),
      root.message.timestamp,
    );

    const graphNodes: GraphNode<TMessage>[] = threadNodes.map((n) => ({
      message: n.message as TMessage,
      deleted: n.deleted,
      editedContent: n.editedContent,
    }));

    const threadId = ThreadId(rootMsg.canonicalId);
    result.set(threadId, {
      id: threadId,
      scope,
      anchor: rootMsg.anchor as TAnchor,
      nodes: graphNodes,
      lastActivity,
    });
  }

  return result;
}

/**
 * Find which thread a message belongs to by walking up to its root.
 *
 * @param events - Events to search
 * @param messageId - The canonicalId of the message to find
 * @returns The thread ID or undefined if not found
 */
export function findThreadRoot(
  events: readonly StorableEvent[],
  messageId: CanonicalId,
): ThreadId | undefined {
  const nodes = new Map<
    string,
    { predecessorId?: string; isAnchor: boolean }
  >();

  for (const event of events) {
    const result = GraphMessageSchema.safeParse(event);
    if (!result.success) continue;

    const parsed = result.data;

    if (!nodes.has(parsed.canonicalId)) {
      if (parsed.kind === "anchor") {
        nodes.set(parsed.canonicalId, { isAnchor: true });
      } else if (parsed.kind === "reply") {
        nodes.set(parsed.canonicalId, {
          predecessorId: parsed.predecessorId,
          isAnchor: false,
        });
      }
    }
  }

  return walkToRoot(nodes, messageId, new Set());
}

// Helpers for Converting Graph to Views

/**
 * Convert graph nodes to message views (for adapter use).
 * Filters out deleted messages and applies edits.
 */
export function graphNodesToMessages<TMessage extends GraphMessage>(
  nodes: readonly GraphNode<TMessage>[],
): readonly GraphNodeView[] {
  return nodes
    .filter((n) => !n.deleted)
    .map((n) => ({
      canonicalId: n.message.canonicalId,
      senderId: n.message.senderId,
      content: n.editedContent ?? n.message.content,
      timestamp: n.message.timestamp,
      predecessorId: n.message.kind === "reply"
        ? n.message.predecessorId
        : undefined,
    }));
}

/**
 * A simplified view of a graph node message.
 */
export interface GraphNodeView {
  readonly canonicalId: CanonicalIdType;
  readonly senderId: ParticipantIdType;
  readonly content?: string;
  readonly timestamp: string;
  readonly predecessorId?: CanonicalIdType;
}

// Internal Helpers

const collectThreadNodes = (
  nodes: Map<string, NodeState>,
  children: Map<string, string[]>,
  rootId: string,
): NodeState[] => {
  const result: NodeState[] = [];
  const queue = [rootId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodes.get(id);
    if (node) {
      result.push(node);
      queue.push(...(children.get(id) ?? []));
    }
  }

  return result;
};

const walkToRoot = (
  nodes: Map<string, { predecessorId?: string; isAnchor: boolean }>,
  messageId: string,
  visited: Set<string>,
): ThreadId | undefined => {
  if (visited.has(messageId)) return undefined;
  visited.add(messageId);

  const node = nodes.get(messageId);
  if (!node) return undefined;

  if (node.isAnchor) return ThreadId(messageId);
  if (!node.predecessorId) return undefined;

  return walkToRoot(nodes, node.predecessorId, visited);
};
