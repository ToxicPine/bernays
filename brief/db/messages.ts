// brief/db/messages.ts
// Message CRUD + pagination against SQLite

import { Database } from "@db/sqlite";
import type { PaginatedResult } from "./conversations.ts";

// =============================================================================
// Types
// =============================================================================

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export interface CreateMessageInput {
  readonly id: string;
  readonly conversationId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ListMessagesQuery {
  readonly conversationId: string;
  readonly limit: number;
  readonly offset: number;
}

// =============================================================================
// Row mapping
// =============================================================================

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata: string;
  created_at: string;
}

const rowToMessage = (row: MessageRow): Message => ({
  id: row.id,
  conversationId: row.conversation_id,
  role: row.role as Message["role"],
  content: row.content,
  metadata: JSON.parse(row.metadata),
  createdAt: row.created_at,
});

// =============================================================================
// Queries
// =============================================================================

export const createMessage = (
  db: Database,
  input: CreateMessageInput,
): Message => {
  const now = new Date().toISOString();
  db.exec(
    `INSERT INTO messages (id, conversation_id, role, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.conversationId,
      input.role,
      input.content,
      JSON.stringify(input.metadata ?? {}),
      now,
    ],
  );

  return getMessage(db, input.id)!;
};

export const getMessage = (
  db: Database,
  id: string,
): Message | undefined => {
  const row = db.prepare(
    "SELECT * FROM messages WHERE id = ?",
  ).get<MessageRow>(id);

  return row ? rowToMessage(row) : undefined;
};

export const listMessages = (
  db: Database,
  query: ListMessagesQuery,
): PaginatedResult<Message> => {
  const countRow = db.prepare(
    "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?",
  ).get<{ count: number }>(query.conversationId);
  const total = countRow?.count ?? 0;

  const rows = db.prepare(
    `SELECT * FROM messages WHERE conversation_id = ?
     ORDER BY created_at ASC
     LIMIT ? OFFSET ?`,
  ).all<MessageRow>(query.conversationId, query.limit, query.offset);

  return {
    items: rows.map(rowToMessage),
    total,
    limit: query.limit,
    offset: query.offset,
    hasMore: query.offset + query.limit < total,
  };
};
