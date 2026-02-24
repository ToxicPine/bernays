// packages/commandline/src/config.ts
// Environment configuration

import { AgentId } from "@bernays/server/core";

export const config = {
  browserbaseApiKey: Deno.env.get("BROWSERBASE_API_KEY")!,
  browserbaseContextId: Deno.env.get("BROWSERBASE_CONTEXT_ID")!,
  databaseUrl: Deno.env.get("DATABASE_URL")!,
  accountId: Deno.env.get("ACCOUNT_ID") ?? "demo-account",
  agentId: AgentId("virtual-bernays"),
  runSockpuppet: Deno.env.get("RUN_SOCKPUPPET") === "1",
} as const;
