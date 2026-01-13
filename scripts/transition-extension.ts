#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
// =============================================================================
// transition-extension.ts — Transition from old extension ID to new
// =============================================================================
//
// Usage:
//   deno run -A scripts/transition-extension.ts --from <old-id> --to <new-id>
//   just ext-transition --from <old-id> --to <new-id>
//
// Options:
//   --from <id>     Old extension ID to replace
//   --to <id>       New extension ID to use
//   --silent, -s    Suppress non-error output
//   --dry-run       Show what would be done without making changes
//
// What it does:
//   1. Connects to the database
//   2. Updates all browser_configs replacing old extension ID with new
//   3. Deletes the old extension from Browserbase
//
// Environment:
//   DATABASE_URL              Required for database connection
//   BROWSERBASE_API_KEY       Required for Browserbase API
//
// =============================================================================

import { parseArgs } from "@std/cli";
import postgres from "postgres";
import { createLogger, type Logger } from "./lib/log.ts";
import { loadDotenv } from "./lib/env.ts";

// =============================================================================
// Config
// =============================================================================

const PROJECT_ROOT = new URL("..", import.meta.url).pathname;
const API_BASE = "https://www.browserbase.com";

// =============================================================================
// Types
// =============================================================================

interface TransitionConfig {
  fromId: string;
  toId: string;
  silent: boolean;
  dryRun: boolean;
}

interface TransitionResult {
  configsUpdated: number;
  extensionDeleted: boolean;
}

// =============================================================================
// Database Operations
// =============================================================================

const updateExtensionIds = async (
  sql: postgres.Sql,
  fromId: string,
  toId: string,
  log: Logger,
  dryRun: boolean,
): Promise<number> => {
  // Find configs that have the old extension ID
  const configs = await sql`
    SELECT id, extension_ids
    FROM browser_configs
    WHERE ${fromId} = ANY(extension_ids)
  `;

  if (configs.length === 0) {
    log.info("No Browser Configs Found with the Old Extension ID");
    return 0;
  }

  log.info(`Found ${configs.length} Config(s) with Old Extension ID`);

  if (dryRun) {
    for (const config of configs) {
      log.dim(`  Would Update: ${config.id}`);
    }
    return configs.length;
  }

  for (const config of configs) {
    const oldIds = config.extension_ids as string[];
    const newIds = oldIds.map((id) => (id === fromId ? toId : id));

    await sql`
      UPDATE browser_configs
      SET extension_ids = ${newIds},
          updated_at = NOW()
      WHERE id = ${config.id}
    `;

    log.dim(`  Updated: ${config.id}`);
  }

  return configs.length;
};

// =============================================================================
// Browserbase API
// =============================================================================

const deleteExtension = async (
  id: string,
  apiKey: string,
  log: Logger,
  dryRun: boolean,
): Promise<boolean> => {
  if (dryRun) {
    log.info(`Would delete extension: ${id}`);
    return true;
  }

  const res = await fetch(`${API_BASE}/v1/extensions/${id}`, {
    method: "DELETE",
    headers: { "X-BB-API-Key": apiKey },
  });

  if (res.status === 404) {
    log.warn(`Extension ${id} not found in Browserbase (already deleted?)`);
    return false;
  }

  if (res.status !== 204 && res.status !== 200) {
    log.warn(`Delete returned unexpected status: ${res.status}`);
    return false;
  }

  log.ok(`Deleted extension: ${id}`);
  return true;
};

// =============================================================================
// Main
// =============================================================================

export const transition = async (
  config: TransitionConfig,
): Promise<TransitionResult> => {
  const log = createLogger(config.silent);

  loadDotenv(`${PROJECT_ROOT}/.env`);

  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set.\nSet it in .env or as an environment variable.",
    );
  }

  const apiKey = Deno.env.get("BROWSERBASE_API_KEY");
  if (!apiKey) {
    throw new Error(
      "BROWSERBASE_API_KEY is not set.\nSet it in .env or as an environment variable.",
    );
  }

  if (config.dryRun) {
    log.warn("DRY RUN - No changes will be made");
  }

  // Connect to database
  log.section("Connecting to Database");
  const sql = postgres(databaseUrl, {
    onnotice: () => {}, // Suppress NOTICE/WARNING messages
  });

  let configsUpdated = 0;
  let extensionDeleted = false;

  try {
    // Update browser configs
    log.section("Updating Browser Configs");
    log.info(`Replacing: ${config.fromId}`);
    log.info(`With:      ${config.toId}`);
    configsUpdated = await updateExtensionIds(
      sql,
      config.fromId,
      config.toId,
      log,
      config.dryRun,
    );

    if (configsUpdated > 0) {
      log.ok(`Updated ${configsUpdated} config(s)`);
    }

    // Delete old extension from Browserbase
    log.section("Cleaning Up Old Extension");
    extensionDeleted = await deleteExtension(
      config.fromId,
      apiKey,
      log,
      config.dryRun,
    );

    log.section("Done");
    if (config.dryRun) {
      log.dim("  (Dry run - no changes were made)");
    }
  } finally {
    await sql.end();
  }

  return { configsUpdated, extensionDeleted };
};

// =============================================================================
// CLI
// =============================================================================

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["from", "to"],
    boolean: ["silent", "help", "dry-run"],
    alias: { s: "silent", h: "help" },
  });

  if (args.help) {
    console.log(`
transition-extension.ts — Transition from old extension ID to new

USAGE
  deno run -A scripts/transition-extension.ts --from <old-id> --to <new-id>
  just ext-transition --from <old-id> --to <new-id>

OPTIONS
  --from <id>     Old extension ID to replace (required)
  --to <id>       New extension ID to use (required)
  --silent, -s    Suppress non-error output
  --dry-run       Show what would be done without making changes
  --help, -h      Show this help

ENVIRONMENT
  DATABASE_URL              Database connection URL
  BROWSERBASE_API_KEY       Browserbase API key
`.trim());
    Deno.exit(0);
  }

  if (!args.from) {
    console.error("Error: --from <old-id> is required");
    Deno.exit(1);
  }

  if (!args.to) {
    console.error("Error: --to <new-id> is required");
    Deno.exit(1);
  }

  try {
    await transition({
      fromId: args.from,
      toId: args.to,
      silent: args.silent,
      dryRun: args["dry-run"],
    });
  } catch (error) {
    const log = createLogger(false);
    log.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
