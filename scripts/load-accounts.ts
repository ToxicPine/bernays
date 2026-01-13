#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env
// =============================================================================
// load-accounts.ts — CLI utility for loading accounts from TOML files
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
// Platforms:
//   linkedin                   LinkedIn accounts
//   x                          X (Twitter) accounts
//
// Options:
//   --db-url <url>            Database connection string (default: DATABASE_URL env)
//   --help, -h                Show help
//
// Examples:
//   # Validate TOML
//   deno run -A scripts/load-accounts.ts validate linkedin accounts/linkedin.toml
//
//   # Import to database
//   deno run -A scripts/load-accounts.ts import linkedin accounts/linkedin.toml
//
//   # Export to file
//   deno run -A scripts/load-accounts.ts export linkedin > accounts/linkedin-backup.toml
//
// =============================================================================

import { parseArgs } from "@std/cli";
import { parse as parseToml, stringify as stringifyToml } from "@std/toml";
import { Effect } from "effect";

import { createLogger, die, statusOk } from "./lib/log.ts";
import {
  LinkedInTomlFileSchema,
  XTomlFileSchema,
  toLinkedInAccount,
  toXAccount,
  fromLinkedInAccount,
  fromXAccount,
} from "./lib/account-schemas.ts";

import {
  createPostgresLinkedInAccountStore,
} from "@bernays/plugins/linkedin";
import {
  createPostgresXAccountStore,
} from "@bernays/plugins/x";

// =============================================================================
// Types
// =============================================================================

type PlatformName = "linkedin" | "x";

// =============================================================================
// Help
// =============================================================================

const HELP = `
load-accounts — CLI utility for loading accounts from TOML files

USAGE:
  bernays load-accounts [COMMAND] [OPTIONS]

COMMANDS:
  import <platform> <file>   Import Accounts From TOML to Database
  export <platform>          Export Accounts From Database to TOML (stdout)
  validate <platform> <file> Validate TOML Without Touching Database

PLATFORMS:
  linkedin                   LinkedIn Accounts
  x                          X (Twitter) Accounts

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
`.trim();

// =============================================================================
// Validation
// =============================================================================

const isPlatform = (value: string): value is PlatformName => {
  return value === "linkedin" || value === "x";
};

// =============================================================================
// File Reading
// =============================================================================

const readTomlFile = async (filepath: string): Promise<Record<string, unknown>> => {
  let content: string;
  try {
    content = await Deno.readTextFile(filepath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      die(`File not found: ${filepath}`);
    }
    throw die(`Failed to read file: ${err}`);
  }

  try {
    return parseToml(content);
  } catch (err) {
    throw die(`TOML parse error: ${err}`);
  }
};

// =============================================================================
// LinkedIn Commands
// =============================================================================

const validateLinkedIn = async (filepath: string): Promise<void> => {
  const log = createLogger();
  log.section(`Validating ${filepath}`);

  const parsed = await readTomlFile(filepath);
  const result = LinkedInTomlFileSchema.safeParse(parsed);

  if (!result.success) {
    log.error("Validation failed:");
    for (const issue of result.error.issues) {
      log.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    Deno.exit(1);
  }

  statusOk(`Validated ${result.data.accounts.length} LinkedIn account(s)`);
};

const importLinkedIn = async (filepath: string, dbUrl: string): Promise<void> => {
  const log = createLogger();
  log.section(`Importing ${filepath} to database`);

  const parsed = await readTomlFile(filepath);
  const result = LinkedInTomlFileSchema.safeParse(parsed);

  if (!result.success) {
    log.error("Validation failed:");
    for (const issue of result.error.issues) {
      log.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    Deno.exit(1);
  }

  log.info("Connecting to database...");
  const store = await createPostgresLinkedInAccountStore({ connectionString: dbUrl });

  let upserted = 0;
  for (const tomlAccount of result.data.accounts) {
    const account = toLinkedInAccount(tomlAccount);
    try {
      await Effect.runPromise(store.upsert(account));
      log.info(`Upserted: ${account.id}`);
      upserted++;
    } catch (err) {
      log.error(`Failed to upsert ${account.id}: ${err}`);
    }
  }

  statusOk(`Upserted ${upserted}/${result.data.accounts.length} LinkedIn account(s)`);
};

const exportLinkedIn = async (dbUrl: string): Promise<void> => {
  const log = createLogger();
  log.section("Exporting LinkedIn Accounts From Database");

  log.info("Connecting To Database...");
  const store = await createPostgresLinkedInAccountStore({ connectionString: dbUrl });

  const accounts = await Effect.runPromise(store.list());

  if (accounts.length === 0) {
    log.warn("No LinkedIn Accounts Found in Database");
    return;
  }

  const tomlData = {
    accounts: accounts.map(fromLinkedInAccount),
  };

  const tomlString = stringifyToml(tomlData);
  console.log(tomlString);

  // Status to stderr so it doesn't interfere with stdout redirect
  console.error(`\n[OK] Exported ${accounts.length} LinkedIn Account(s)`);
};

// =============================================================================
// X Commands
// =============================================================================

const validateX = async (filepath: string): Promise<void> => {
  const log = createLogger();
  log.section(`Validating ${filepath}`);

  const parsed = await readTomlFile(filepath);
  const result = XTomlFileSchema.safeParse(parsed);

  if (!result.success) {
    log.error("Validation Failed:");
    for (const issue of result.error.issues) {
      log.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    Deno.exit(1);
  }

  statusOk(`Validated ${result.data.accounts.length} X Account(s)`);
};

const importX = async (filepath: string, dbUrl: string): Promise<void> => {
  const log = createLogger();
  log.section(`Importing ${filepath} to Database`);

  const parsed = await readTomlFile(filepath);
  const result = XTomlFileSchema.safeParse(parsed);

  if (!result.success) {
    log.error("Validation Failed:");
    for (const issue of result.error.issues) {
      log.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    Deno.exit(1);
  }

  log.info("Connecting to Database...");
  const store = await createPostgresXAccountStore({ connectionString: dbUrl });

  let upserted = 0;
  for (const tomlAccount of result.data.accounts) {
    const account = toXAccount(tomlAccount);
    try {
      await Effect.runPromise(store.upsert(account));
      log.info(`Upserted: ${account.id}`);
      upserted++;
    } catch (err) {
      log.error(`Failed to Upsert ${account.id}: ${err}`);
    }
  }

  statusOk(`Upserted ${upserted}/${result.data.accounts.length} X Account(s)`);
};

const exportX = async (dbUrl: string): Promise<void> => {
  const log = createLogger();
  log.section("Exporting X Accounts from Database");

  log.info("Connecting to Database...");
  const store = await createPostgresXAccountStore({ connectionString: dbUrl });

  const accounts = await Effect.runPromise(store.list());

  if (accounts.length === 0) {
    log.warn("No X Accounts Found in Database");
    return;
  }

  const tomlData = {
    accounts: accounts.map(fromXAccount),
  };

  const tomlString = stringifyToml(tomlData);
  console.log(tomlString);

  // Status to stderr so it doesn't interfere with stdout redirect
  console.error(`\n[OK] Exported ${accounts.length} X Account(s)`);
};

// =============================================================================
// Command Dispatch
// =============================================================================

const validateCommand = async (platform: PlatformName, filepath: string): Promise<void> => {
  if (platform === "linkedin") {
    await validateLinkedIn(filepath);
  } else {
    await validateX(filepath);
  }
};

const importCommand = async (
  platform: PlatformName,
  filepath: string,
  dbUrl: string,
): Promise<void> => {
  if (platform === "linkedin") {
    await importLinkedIn(filepath, dbUrl);
  } else {
    await importX(filepath, dbUrl);
  }
};

const exportCommand = async (platform: PlatformName, dbUrl: string): Promise<void> => {
  if (platform === "linkedin") {
    await exportLinkedIn(dbUrl);
  } else {
    await exportX(dbUrl);
  }
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
    console.log(HELP);
    return;
  }

  const [command, ...rest] = args._;

  if (!command) {
    console.log(HELP);
    Deno.exit(1);
  }

  const dbUrl = args["db-url"] || Deno.env.get("DATABASE_URL") || Deno.env.get("POSTGRES_URL");

  switch (command) {
    case "validate": {
      const [platform, filepath] = rest;
      if (!platform || !isPlatform(String(platform))) {
        die("Usage: validate <linkedin|x> <file>");
      }
      if (!filepath) {
        die("Usage: validate <linkedin|x> <file>");
      }
      await validateCommand(String(platform) as PlatformName, String(filepath));
      break;
    }

    case "import": {
      const [platform, filepath] = rest;
      if (!platform || !isPlatform(String(platform))) {
        return die("Usage: import <linkedin|x> <file>");
      }
      if (!filepath) {
        return die("Usage: import <linkedin|x> <file>");
      }
      if (!dbUrl) {
        return die("Database URL required. Set DATABASE_URL env var or use --db-url");
      }
      await importCommand(String(platform) as PlatformName, String(filepath), dbUrl);
      break;
    }

    case "export": {
      const [platform] = rest;
      if (!platform || !isPlatform(String(platform))) {
        return die("Usage: export <linkedin|x>");
      }
      if (!dbUrl) {
        return die("Database URL required. Set DATABASE_URL env var or use --db-url");
      }
      await exportCommand(String(platform) as PlatformName, dbUrl);
      break;
    }

    default:
      die(`Unknown command: ${command}\nRun with --help for usage.`);
  }
};

if (import.meta.main) {
  await main();
}
