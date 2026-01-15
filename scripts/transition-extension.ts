#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
// =============================================================================
// transition-extension.ts — Transition From Old Extension ID to New
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
import { Effect, Layer } from "effect";
import { ExtensionId } from "@bernays/server/core";
import {
  ConfigStore,
  createPostgresConfigStore,
  transitionExtension,
} from "@bernays/server/store";
import {
  BrowserBackendLive,
  makeBrowserbaseBackend,
} from "@bernays/server/backend";
import { createLogger, loadDotenv, type Logger } from "./lib/cli/mod.ts";

// =============================================================================
// Config
// =============================================================================

const PROJECT_ROOT = new URL("..", import.meta.url).pathname;

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

  // Create services
  log.section("Connecting to Database");
  const configStore = await createPostgresConfigStore({
    connectionString: databaseUrl,
  });

  const fromId = ExtensionId(config.fromId);
  const toId = ExtensionId(config.toId);

  // For dry-run, just list what would be affected
  if (config.dryRun) {
    return await dryRun(configStore, fromId, toId, log);
  }

  // Create layers for the Effect
  const ConfigStoreLive = Layer.succeed(ConfigStore, configStore);
  const backend = makeBrowserbaseBackend(apiKey, configStore);
  const BackendLive = BrowserBackendLive(backend);

  // Run the transition
  log.section("Updating Browser Configs");
  log.info(`Replacing: ${config.fromId}`);
  log.info(`With: ${config.toId}`);

  const result = await Effect.runPromise(
    transitionExtension(fromId, toId).pipe(
      Effect.provide(ConfigStoreLive),
      Effect.provide(BackendLive),
    ),
  );

  log.ok(`Updated ${result.configsUpdated} config(s)`);

  log.section("Cleaning Up Old Extension");
  if (result.extensionDeleted) {
    log.ok(`Deleted extension: ${config.fromId}`);
  }

  log.section("Done");

  return result;
};

// =============================================================================
// Dry Run
// =============================================================================

const dryRun = async (
  configStore: Awaited<ReturnType<typeof createPostgresConfigStore>>,
  fromId: ReturnType<typeof ExtensionId>,
  toId: ReturnType<typeof ExtensionId>,
  log: Logger,
): Promise<TransitionResult> => {
  log.section("Checking Browser Configs");
  log.info(`Would Replace: ${fromId}`);
  log.info(`With: ${toId}`);

  const configs = await Effect.runPromise(configStore.list());
  const affected = configs.filter((c) => c.extensionIds.includes(fromId));

  if (affected.length === 0) {
    log.info("No Browser Configs Found With Old Extension ID");
  } else {
    log.info(`Found ${affected.length} Config(s) With Old Extension ID`);
    for (const c of affected) {
      log.dim(`  Would Update: ${c.id}`);
    }
  }

  log.section("Would Clean Up Old Extension");
  log.dim(`  Would Delete Extension: ${fromId}`);

  log.section("Done");
  log.dim("  (Dry Run — No Changes Were Made)");

  return { configsUpdated: affected.length, extensionDeleted: false };
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
transition-extension.ts — Transition From Old Extension ID to New

USAGE
  bernays transition-extension [OPTIONS]

OPTIONS
  --from <id>     Old Extension ID to Replace (required)
  --to <id>       New Extension ID to Use (required)
  --silent, -s    Suppress Non-Error Output
  --dry-run       Show What Would Be Done Without Making Changes
  --help, -h      Show This Help
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
