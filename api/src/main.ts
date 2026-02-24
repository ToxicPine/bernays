// api/src/main.ts
// Entry point — initialize context and start Deno.serve

import { createServerContext } from "$/context.ts";
import { createApp } from "$/server.ts";

// =============================================================================
// Main
// =============================================================================

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  Deno.exit(1);
}

const port = parseInt(Deno.env.get("PORT") ?? "8080", 10);

console.log("Initializing server context...");
const ctx = await createServerContext({ databaseUrl });

const app = createApp(ctx);

console.log(`Listening on http://0.0.0.0:${port}`);
Deno.serve({ port, hostname: "0.0.0.0" }, app.fetch);
