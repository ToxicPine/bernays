#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env
// =============================================================================
// load-accounts.ts — Load Accounts From TOML Files
// =============================================================================
//
// Usage:
//   deno run -A scripts/load-accounts.ts <command> [options]
//
// Commands:
//   import <platform> <file>   Import accounts from TOML to database
//   export <platform>          Export accounts from database to TOML (stdout)
//   validate <platform> <file> Validate TOML without touching database
//
// Options:
//   --db-url <url>            Database connection string (default: DATABASE_URL env)
//   --help, -h                Show help
//
// Adding a new platform:
//   1. Add the store factory to storeFactories in scripts/lib/platforms/stores.ts
//   2. That's it - the CLI automatically picks up new platforms
//
// =============================================================================

import { parseArgs } from "@std/cli";
import { parse as parseToml, stringify as stringifyToml } from "@std/toml";
import { Effect } from "effect";

import {
  type BrowserConfigId as BrowserConfigIdType,
  type ParticipantId as ParticipantIdType,
} from "@bernays/server/core";
import { createLogger, die, statusOk } from "./lib/cli/mod.ts";
import {
  AccountsTomlFileSchema,
  fromAccount,
  getStore,
  isSupportedPlatform,
  supportedPlatforms,
  toAccount,
} from "./lib/platforms/mod.ts";

// =============================================================================
// Help
// =============================================================================

const buildHelp = (): string => {
  const platforms = supportedPlatforms();
  const platformList = platforms.map((p) =>
    `  ${p.padEnd(24)} ${p.charAt(0).toUpperCase() + p.slice(1)} accounts`
  ).join("\n");

  return `
load-accounts — CLI Utility for Loading Accounts from TOML Files

USAGE:
  bernays load-accounts [COMMAND] [OPTIONS]

COMMANDS:
  import <platform> <file>   Import Accounts From TOML to Database
  export <platform>          Export Accounts From Database to TOML (stdout)
  validate <platform> <file> Validate TOML Without Touching Database

PLATFORMS:
${platformList}

OPTIONS:
  --db-url <url>            Database Connection String (default: DATABASE_URL env)
  --help, -h                Show Help

EXAMPLES:
  # Validate TOML syntax and schema
  bernays load-accounts validate linkedin accounts/linkedin.toml

  # Import accounts to database
  bernays load-accounts import linkedin accounts/linkedin.toml

  # Export accounts to file
  bernays load-accounts export linkedin > accounts/linkedin-backup.toml

EXTENDING:
  To Add a New Platform, Add The Store Factory to StoreFactories in
  scripts/lib/platforms/stores.ts
`.trim();
};

// =============================================================================
// File Reading
// =============================================================================

const readTomlFile = async (
  filepath: string,
): Promise<Record<string, unknown>> => {
  let content: string;
  try {
    content = await Deno.readTextFile(filepath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      die(`File Not Found: ${filepath}`);
    }
    throw die(`Failed to Read File: ${err}`);
  }

  try {
    return parseToml(content);
  } catch (err) {
    throw die(`TOML Parse Error: ${err}`);
  }
};

// =============================================================================
// Commands
// =============================================================================

const validateCommand = async (
  platform: string,
  filepath: string,
): Promise<void> => {
  const log = createLogger();
  log.section(`Validating ${filepath}`);

  const parsed = await readTomlFile(filepath);
  const result = AccountsTomlFileSchema.safeParse(parsed);

  if (!result.success) {
    log.error("Validation Failed:");
    for (const issue of result.error.issues) {
      log.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    Deno.exit(1);
  }

  statusOk(`Validated ${result.data.accounts.length} ${platform} Account(s)`);
};

const importCommand = async (
  platform: string,
  filepath: string,
  dbUrl: string,
): Promise<void> => {
  const log = createLogger();
  log.section(`Importing ${filepath} to database`);

  const parsed = await readTomlFile(filepath);
  const result = AccountsTomlFileSchema.safeParse(parsed);

  if (!result.success) {
    log.error("Validation Failed:");
    for (const issue of result.error.issues) {
      log.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    Deno.exit(1);
  }

  if (!isSupportedPlatform(platform)) {
    return die(`Unknown Platform: ${platform}`);
  }

  // After the type guard above, platform is narrowed to SupportedPlatform
  log.info("Connecting to Database...");
  const storeEntry = getStore(platform);
  const store = await storeEntry.create({ connectionString: dbUrl });

  let upserted = 0;
  for (const tomlAccount of result.data.accounts) {
    const account = toAccount(tomlAccount);
    try {
      // Type assertion needed because store is platform-specific but account is generic
      await Effect.runPromise(
        (store.upsert as (a: typeof account) => Effect.Effect<void>)(account),
      );
      log.info(`Upserted: ${account.id}`);
      upserted++;
    } catch (err) {
      log.error(`Failed to upsert ${account.id}: ${err}`);
    }
  }

  statusOk(
    `Upserted ${upserted}/${result.data.accounts.length} ${platform} Account(s)`,
  );
};

const exportCommand = async (
  platform: string,
  dbUrl: string,
): Promise<void> => {
  const log = createLogger();
  log.section(`Exporting ${platform} accounts from database`);

  if (!isSupportedPlatform(platform)) {
    return die(`Unknown Platform: ${platform}`);
  }

  // After the type guard above, platform is narrowed to SupportedPlatform
  log.info("Connecting to Database...");
  const storeEntry = getStore(platform);
  const store = await storeEntry.create({ connectionString: dbUrl });

  // Use type assertion for the list result since it can be any platform's account type
  // The runtime dispatch already ensures the correct store is used
  const accounts = await Effect.runPromise(
    store.list() as Effect.Effect<
      readonly {
        id: ParticipantIdType;
        browserBindings: readonly {
          configId: BrowserConfigIdType;
          metadata: Record<string, unknown>;
        }[];
      }[]
    >,
  );

  if (accounts.length === 0) {
    log.warn(`No ${platform} Accounts Found in Database`);
    return;
  }

  const tomlData = {
    accounts: accounts.map(fromAccount),
  };

  const tomlString = stringifyToml(tomlData);
  console.log(tomlString);

  // Status to stderr so it doesn't interfere with stdout redirect
  console.error(`\n[OK] Exported ${accounts.length} ${platform} Account(s)`);
};

// =============================================================================
// Main
// =============================================================================

const main = async (): Promise<void> => {
  const args = parseArgs(Deno.args, {
    string: ["db-url"],
    boolean: ["help"],
    alias: {
      h: "help",
    },
  });

  if (args.help) {
    console.log(buildHelp());
    return;
  }

  const [command, ...rest] = args._;

  if (!command) {
    console.log(buildHelp());
    Deno.exit(1);
  }

  const dbUrl = args["db-url"] || Deno.env.get("DATABASE_URL") ||
    Deno.env.get("POSTGRES_URL");
  const platforms = supportedPlatforms();
  const platformNames = platforms.join("|");

  const isValidPlatform = (name: string): boolean => isSupportedPlatform(name);

  switch (command) {
    case "validate": {
      const [platform, filepath] = rest;
      if (!platform || !isValidPlatform(String(platform))) {
        die(`Usage: validate <${platformNames}> <file>`);
      }
      if (!filepath) {
        die(`Usage: validate <${platformNames}> <file>`);
      }
      await validateCommand(String(platform), String(filepath));
      break;
    }

    case "import": {
      const [platform, filepath] = rest;
      if (!platform || !isValidPlatform(String(platform))) {
        return die(`Usage: import <${platformNames}> <file>`);
      }
      if (!filepath) {
        return die(`Usage: import <${platformNames}> <file>`);
      }
      if (!dbUrl) {
        return die("Database URL Required — Set DATABASE_URL or Use --db-url");
      }
      await importCommand(String(platform), String(filepath), dbUrl);
      break;
    }

    case "export": {
      const [platform] = rest;
      if (!platform || !isValidPlatform(String(platform))) {
        return die(`Usage: export <${platformNames}>`);
      }
      if (!dbUrl) {
        return die("Database URL Required — Set DATABASE_URL or Use --db-url");
      }
      await exportCommand(String(platform), dbUrl);
      break;
    }

    default:
      die(`Unknown Command: ${command}\nRun with --help for usage.`);
  }
};

if (import.meta.main) {
  await main();
}
