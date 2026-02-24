// llm/src/main.ts
// Entry point — initialize context and start serving

import { createServerContext } from "$/context.ts";
import { createApp } from "$/server.ts";

const DB_PATH = Deno.env.get("LLM_DB_PATH") ?? "/data/llm.db";
const USER_ID = Deno.env.get("LLM_USER_ID") ?? "user";
const PORT = parseInt(Deno.env.get("PORT") ?? "8081", 10);

const ctx = createServerContext({
  dbPath: DB_PATH,
  userId: USER_ID,
});

const app = createApp(ctx);

console.log(`bernays-llm listening on :${PORT}`);
Deno.serve({ port: PORT }, app.fetch);
