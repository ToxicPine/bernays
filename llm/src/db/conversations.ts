// llm/src/db/conversations.ts
// Conversation CRUD against SQLite

import { Database } from "@db/sqlite";

// =============================================================================
// Types
// =============================================================================

export interface Conversation {
  readonly id: string;
  readonly agentId: string;
  readonly briefingId: string | null;
  readonly title: string;
  readonly status: "active" | "ended" | "failed";
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateConversationInput {
  readonly id: string;
  readonly agentId: string;
  readonly briefingId?: string;
  readonly title?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ListConversationsQuery {
  readonly agentId?: string;
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

// =============================================================================
// Row mapping
// =============================================================================

interface ConversationRow {
  id: string;
  agent_id: string;
  briefing_id: string | null;
  title: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

const rowToConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  agentId: row.agent_id,
  briefingId: row.briefing_id,
  title: row.title,
  status: row.status as Conversation["status"],
  metadata: JSON.parse(row.metadata),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// =============================================================================
// Queries
// =============================================================================

export const createConversation = (
  db: Database,
  input: CreateConversationInput,
): Conversation => {
  const now = new Date().toISOString();
  db.exec(
    `INSERT INTO conversations (id, agent_id, briefing_id, title, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.agentId,
      input.briefingId ?? null,
      input.title ?? "",
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    ],
  );

  return getConversation(db, input.id)!;
};

export const getConversation = (
  db: Database,
  id: string,
): Conversation | undefined => {
  const row = db.prepare(
    "SELECT * FROM conversations WHERE id = ?",
  ).get<ConversationRow>(id);

  return row ? rowToConversation(row) : undefined;
};

export const listConversations = (
  db: Database,
  query: ListConversationsQuery,
): PaginatedResult<Conversation> => {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.agentId) {
    conditions.push("agent_id = ?");
    params.push(query.agentId);
  }
  if (query.status) {
    conditions.push("status = ?");
    params.push(query.status);
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const countRow = db.prepare(
    `SELECT COUNT(*) as count FROM conversations ${where}`,
  ).get<{ count: number }>(...params);
  const total = countRow?.count ?? 0;

  const rows = db.prepare(
    `SELECT * FROM conversations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all<ConversationRow>(...params, query.limit, query.offset);

  return {
    items: rows.map(rowToConversation),
    total,
    limit: query.limit,
    offset: query.offset,
    hasMore: query.offset + query.limit < total,
  };
};

export const updateConversationStatus = (
  db: Database,
  id: string,
  status: Conversation["status"],
): Conversation | undefined => {
  const now = new Date().toISOString();
  db.exec(
    "UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?",
    [status, now, id],
  );
  return getConversation(db, id);
};

export const updateConversationBriefingId = (
  db: Database,
  id: string,
  briefingId: string,
): Conversation | undefined => {
  const now = new Date().toISOString();
  db.exec(
    "UPDATE conversations SET briefing_id = ?, updated_at = ? WHERE id = ?",
    [briefingId, now, id],
  );
  return getConversation(db, id);
};
