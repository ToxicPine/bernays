// packages/commandline/src/config.ts
// Environment configuration

import { AgentId } from "@bernays/server/core";
import { join } from "@std/path";

const loadAgentId = (): string | null => {
  const projectRoot = join(import.meta.dirname!, "..");
  const bernaysFile = join(projectRoot, ".bernays");

  try {
    const content = Deno.readTextFileSync(bernaysFile);
    return content.trim();
  } catch {
    return Deno.env.get("BERNAYS_AGENT_ID") ?? null;
  }
};

const agentId = loadAgentId();

if (!agentId) {
  throw new Error("BERNAYS_AGENT_ID is required");
}

export const config = {
  browserbaseApiKey: Deno.env.get("BROWSERBASE_API_KEY")!,
  browserbaseContextId: Deno.env.get("BROWSERBASE_CONTEXT_ID")!,
  databaseUrl: Deno.env.get("DATABASE_URL")!,
  accountId: Deno.env.get("ACCOUNT_ID") ?? "demo-account",
  agentId: AgentId(agentId),
  runSockpuppet: Deno.env.get("RUN_SOCKPUPPET") === "1",
} as const;
