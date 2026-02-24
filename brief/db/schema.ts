// brief/db/schema.ts
// SQLite schema initialization for conversation persistence.
// Designed for Fly.io volume mounts — a single SQLite file on persistent disk.

import { Database } from "@db/sqlite";

export const initSchema = (db: Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id            TEXT PRIMARY KEY,
      agent_id      TEXT NOT NULL,
      briefing_id   TEXT,
      title         TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'failed')),
      metadata      TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
    CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_briefing_id ON conversations(briefing_id);

    CREATE TABLE IF NOT EXISTS messages (
      id                TEXT PRIMARY KEY,
      conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role              TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content           TEXT NOT NULL,
      metadata          TEXT NOT NULL DEFAULT '{}',
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
  `);
};
