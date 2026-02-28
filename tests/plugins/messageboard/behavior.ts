// tests/plugins/messageboard/behavior.ts
// Minimal platform behavior for the messageboard test plugin.
// Only the state and materialization needed to exercise the reactive pipeline.

import type {
  BrowserConfigId,
  ParticipantId,
  ThreadId,
} from "@bernays/server/core";
import { ParticipantIdFromString } from "@bernays/server/core";
import {
  applyGraphEvent,
  emptyGraphState,
  type GraphMessage,
  graphNodesToMessages,
  type GraphState,
  materializeThreadGraphs,
} from "@bernays/server/views";
import type {
  BaseBoundBrowser,
  BaseInboxView,
  BaseThreadView,
} from "@bernays/server/views";
import type { PlatformBehavior } from "@bernays/server/platforms";
import type { MessageBoardAccount } from "./account.ts";
import type { MessageBoardAnchor, MessageBoardEvent } from "./schemas.ts";
import { MESSAGEBOARD_SCOPE } from "./schemas.ts";

// =============================================================================
// View types
// =============================================================================

export interface MessageBoardThreadSummary {
  readonly lastActivity: string;
}

export interface MessageBoardInbox
  extends BaseInboxView<MessageBoardThreadSummary> {
  readonly byThreadId: Readonly<Record<string, MessageBoardThreadSummary>>;
}

export interface MessageBoardThread
  extends BaseThreadView<MessageBoardAnchor> {}

// =============================================================================
// Plugin state
// =============================================================================

export interface MessageBoardPluginState {
  graph: GraphState;
}

// =============================================================================
// Behavior
// =============================================================================

export const messageBoardBehavior: PlatformBehavior<
  typeof MESSAGEBOARD_SCOPE,
  "messageboard",
  MessageBoardEvent,
  MessageBoardAnchor,
  MessageBoardThread,
  MessageBoardInbox,
  MessageBoardAccount,
  BaseBoundBrowser,
  never,
  MessageBoardPluginState
> = {
  scope: MESSAGEBOARD_SCOPE,
  identity: "messageboard",

  emptyState: (): MessageBoardPluginState => ({
    graph: emptyGraphState(),
  }),

  applyEvent: (
    state: MessageBoardPluginState,
    event: MessageBoardEvent,
  ): void => {
    applyGraphEvent(state.graph, event);
  },

  materializeInbox: (
    state: MessageBoardPluginState,
    _participantId: ParticipantId<"messageboard">,
  ): MessageBoardInbox => {
    const threads = materializeThreadGraphs<
      typeof MESSAGEBOARD_SCOPE,
      GraphMessage,
      MessageBoardAnchor
    >(MESSAGEBOARD_SCOPE, state.graph);

    const byThreadId: Record<string, MessageBoardThreadSummary> = {};
    for (const thread of threads.values()) {
      byThreadId[thread.id] = { lastActivity: thread.lastActivity };
    }

    return { byThreadId };
  },

  materializeThread: (
    state: MessageBoardPluginState,
    threadId: ThreadId,
  ): MessageBoardThread | undefined => {
    const threads = materializeThreadGraphs<
      typeof MESSAGEBOARD_SCOPE,
      GraphMessage,
      MessageBoardAnchor
    >(MESSAGEBOARD_SCOPE, state.graph);

    const thread = threads.get(threadId);
    if (!thread) return undefined;

    return {
      threadId: thread.id,
      messages: graphNodesToMessages(thread.nodes).map((m) => ({
        id: m.canonicalId,
        senderId: ParticipantIdFromString<"messageboard">(m.senderId),
        content: m.content,
        timestamp: m.timestamp,
      })),
      participants: [],
      anchor: thread.anchor,
    };
  },

  materializeBrowsers: (
    _state: MessageBoardPluginState,
    account: MessageBoardAccount,
    runningConfigIds: ReadonlySet<BrowserConfigId>,
  ): readonly BaseBoundBrowser[] =>
    account.browserBindings.map((b) => ({
      configId: b.configId,
      isRunning: runningConfigIds.has(b.configId),
      metadata: b.metadata,
    })),
};
