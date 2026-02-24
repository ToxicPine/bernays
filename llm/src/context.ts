// llm/src/context.ts
// Server context — SQLite database, conversation service, agent resolution

import { Database } from "@db/sqlite";
import { initSchema } from "$/db/schema.ts";
import {
  type AgentResolver,
  type ConversationService,
  makeConversationService,
} from "$/services/conversations.ts";

// =============================================================================
// Server Context
// =============================================================================

export interface ServerContext {
  readonly db: Database;
  readonly conversations: ConversationService;
}

// =============================================================================
// Configuration
// =============================================================================

export interface ServerConfig {
  /** Path to the SQLite database file. On Fly.io, this should be on a volume mount. */
  readonly dbPath: string;
  /** User identity for outbound briefing requests. */
  readonly userId: string;
  /** Resolve agent names to URLs. Defaults to flycast. */
  readonly resolveAgent?: AgentResolver;
  /** Briefing client timeout in ms. */
  readonly clientTimeoutMs?: number;
}

/** Default agent resolver — flycast private networking. */
const flycastResolver: AgentResolver = (agentId) =>
  `http://${agentId}.flycast`;

// =============================================================================
// Factory
// =============================================================================

export const createServerContext = (config: ServerConfig): ServerContext => {
  const db = new Database(config.dbPath);

  // Enable WAL mode for better concurrent read performance
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Initialize schema
  initSchema(db);

  const conversations = makeConversationService({
    db,
    resolveAgent: config.resolveAgent ?? flycastResolver,
    userId: config.userId,
    clientTimeoutMs: config.clientTimeoutMs,
  });

  return { db, conversations };
};
