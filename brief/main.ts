// brief/main.ts
// Entry point — initialize context and start serving

import { AgentId } from "@bernays/server/core";
import { createServerContext } from "./context.ts";
import { createApp } from "./server.ts";

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  Deno.exit(1);
}

const PORT = parseInt(Deno.env.get("PORT") ?? "8081", 10);
const SELF = AgentId(Deno.env.get("BRIEF_AGENT_ID") ?? "user");

const ctx = await createServerContext({ databaseUrl, self: SELF });
const app = createApp(ctx);

console.log(`bernays-brief listening on :${PORT}`);
Deno.serve({ port: PORT }, app.fetch);
