// llm/src/services/conversations.ts
// Conversation service — orchestrates SQLite persistence + briefing client
//
// When a user creates a conversation, we record it locally and call the
// target agent's briefing API to initiate the briefing. When the user
// sends a message, we record it and forward it to the agent. The agent's
// sockpuppet handles the response via its briefing service.

import { Database } from "@db/sqlite";
import { Effect } from "effect";
import {
  type BriefingClientService,
  makeBriefingClient,
} from "@bernays/server/briefing";

import {
  type Conversation,
  type CreateConversationInput,
  createConversation,
  getConversation,
  type ListConversationsQuery,
  listConversations,
  type PaginatedResult,
  updateConversationStatus,
} from "$/db/conversations.ts";
import {
  createMessage,
  type CreateMessageInput,
  listMessages,
  type ListMessagesQuery,
  type Message,
} from "$/db/messages.ts";

// =============================================================================
// Types
// =============================================================================

export type AgentResolver = (agentId: string) => string | undefined;

export interface ConversationServiceConfig {
  readonly db: Database;
  readonly resolveAgent: AgentResolver;
  readonly userId: string;
  readonly clientTimeoutMs?: number;
}

export interface SendMessageResult {
  readonly userMessage: Message;
  readonly assistantMessage: Message | null;
}

// =============================================================================
// Service
// =============================================================================

export interface ConversationService {
  readonly create: (
    agentId: string,
    options?: { title?: string; context?: Record<string, unknown> },
  ) => Promise<Conversation>;

  readonly get: (id: string) => Conversation | undefined;

  readonly list: (
    query: Omit<ListConversationsQuery, "limit" | "offset"> & {
      limit?: number;
      offset?: number;
    },
  ) => PaginatedResult<Conversation>;

  readonly sendMessage: (
    conversationId: string,
    content: string,
  ) => Promise<SendMessageResult>;

  readonly listMessages: (
    query: Omit<ListMessagesQuery, "limit" | "offset"> & {
      limit?: number;
      offset?: number;
    },
  ) => PaginatedResult<Message>;

  readonly end: (id: string) => Promise<Conversation | undefined>;
}

export const makeConversationService = (
  config: ConversationServiceConfig,
): ConversationService => {
  const { db, resolveAgent, userId } = config;
  const client: BriefingClientService = makeBriefingClient(
    config.clientTimeoutMs ?? 30_000,
  );

  return {
    create: async (agentId, options) => {
      const id = crypto.randomUUID();
      const briefingId = crypto.randomUUID();

      // Record locally first
      createConversation(db, {
        id,
        agentId,
        briefingId,
        title: options?.title ?? "",
        metadata: options?.context ?? {},
      } satisfies CreateConversationInput);

      // Resolve agent URL and initiate briefing
      const agentUrl = resolveAgent(agentId);
      if (!agentUrl) {
        updateConversationStatus(db, id, "failed");
        throw new Error(`Cannot resolve agent: ${agentId}`);
      }

      try {
        const response = await Effect.runPromise(
          client.requestBriefing(agentUrl, {
            briefingId,
            fromAgent: userId,
            topic: options?.title ?? "conversation",
            context: options?.context,
          }),
        );

        if (!response.accepted) {
          updateConversationStatus(db, id, "failed");
        }

        return getConversation(db, id)!;
      } catch (err) {
        updateConversationStatus(db, id, "failed");
        throw err;
      }
    },

    get: (id) => getConversation(db, id),

    list: (query) =>
      listConversations(db, {
        ...query,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      }),

    sendMessage: async (conversationId, content) => {
      const conversation = getConversation(db, conversationId);
      if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
      }
      if (conversation.status !== "active") {
        throw new Error(
          `Cannot send message to ${conversation.status} conversation`,
        );
      }
      if (!conversation.briefingId) {
        throw new Error("Conversation has no briefing ID");
      }

      // Record user message
      const userMessage = createMessage(db, {
        id: crypto.randomUUID(),
        conversationId,
        role: "user",
        content,
      } satisfies CreateMessageInput);

      // Forward to agent via briefing
      const agentUrl = resolveAgent(conversation.agentId);
      if (!agentUrl) {
        throw new Error(`Cannot resolve agent: ${conversation.agentId}`);
      }

      try {
        await Effect.runPromise(
          client.sendMessage(agentUrl, conversation.briefingId, {
            sender: userId,
            content,
          }),
        );
      } catch {
        // Message was recorded locally even if remote delivery fails.
        // The agent can pick it up on next poll.
      }

      // The agent's response comes back asynchronously — either via a webhook
      // callback or the caller polls GET /conversations/:id/messages.
      return { userMessage, assistantMessage: null };
    },

    listMessages: (query) =>
      listMessages(db, {
        ...query,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      }),

    end: async (id) => {
      const conversation = getConversation(db, id);
      if (!conversation) return undefined;
      if (conversation.status !== "active") return conversation;

      // Notify agent
      if (conversation.briefingId) {
        const agentUrl = resolveAgent(conversation.agentId);
        if (agentUrl) {
          try {
            await Effect.runPromise(
              client.endBriefing(agentUrl, conversation.briefingId, {
                endedBy: userId,
              }),
            );
          } catch {
            // Best-effort remote notification
          }
        }
      }

      return updateConversationStatus(db, id, "ended");
    },
  };
};
