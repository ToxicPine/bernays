#!/usr/bin/env -S deno run -A
// =============================================================================
// deploy.ts
// =============================================================================
//
// Usage:
//   deno run -A scripts/deploy.ts
//   just deploy
//
// Architecture:
//   This script uses a provider-based architecture for extensibility:
//   - ExecutionProvider: Handles app lifecycle, auth, secrets, deployment
//   - DatabaseProvider: Handles database provisioning and connection URLs
//
//   Current implementations:
//   - Fly.io execution provider (default)
//   - Fly Managed Postgres database provider (USE_FLY_POSTGRES=1)
//
//   To add new providers (e.g., Railway, Render, Neon, Supabase):
//   1. Implement the ExecutionProvider or DatabaseProvider interface
//   2. Add a factory function (e.g., createRailwayExecutionProvider)
//   3. Wire it up in main() based on env vars or CLI flags
//
// Environment variables:
//
//   App config:
//     APP_NAME                    App name (default: from fly.toml)
//     REGION                      Deploy region (default: from fly.toml or "iad")
//     ORG                         Organization slug
//
//   Database:
//     USE_FLY_POSTGRES=1          Use Fly Managed Postgres
//     POSTGRES_NAME               Cluster name (default: linkedin-automation-db)
//     DATABASE_URL                External database URL (if not using managed DB)
//     DB_READY_TIMEOUT            Seconds to wait for DB ready (default: 300)
//     DB_PLAN                     Database plan (default: development)
//     DB_VOLUME_GB                Database volume size (default: 10)
//
//   Secrets:
//     BROWSERBASE_API_KEY         Browserbase API key
//     BROWSERBASE_CONTEXT_ID      Browserbase context ID
//     BROWSERBASE_PROJECT_ID      Browserbase project ID
//     BROWSERBASE_EXTENSION_ID    Browserbase extension ID
//     RUN_SOCKPUPPET              Enable sockpuppet (default: 1)
//     ACCOUNT_ID                  Account identifier
//
//   Flags:
//     FORCE_DEPLOY=1              Deploy even if no changes detected
//     ALLOW_DIRTY_DEPLOY=1        Deploy with uncommitted changes
//     SKIP_DATABASE=1             Skip database setup
//     SKIP_SECRETS=1              Skip secret configuration
//
// =============================================================================

import { parseArgs } from "@std/cli";
import { encodeHex } from "@std/encoding";
import { parse as parseToml } from "@std/toml";
import { z } from "@zod/zod";
import {
  bold,
  die,
  dim,
  Spinner,
  statusErr,
  statusOk,
  statusWarn,
} from "./lib/log.ts";
import { loadDotenv, writeDotenv } from "./lib/env.ts";
import { commandExists, fileExistsSync, runCommand, runWithSpinner } from "./lib/shell.ts";
import { confirm, readSecret } from "./lib/tui.ts";

// =============================================================================
// Fly CLI Response Schemas
// =============================================================================

const FlyAuthSchema = z.object({
  email: z.string(),
}).loose();

const FlyStatusSchema = z.object({
  ID: z.string(),
  Hostname: z.string().optional(),
  Deployed: z.boolean().optional(),
}).loose();

const FlyOrgsSchema = z.record(z.string(), z.string());

const FlyMpgClusterSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
}).loose();

const FlyMpgListSchema = z.array(FlyMpgClusterSchema);

const FlyMpgStatusSchema = z.object({
  id: z.string().optional(),
  credentials: z.object({
    status: z.string().optional(),
    pgbouncer_uri: z.string().optional(),
  }).loose().optional(),
}).loose();

// =============================================================================
// Core Types
// =============================================================================

interface FlyInstanceConfig {
  readonly appName: string;
  readonly region: string;
  readonly org?: string;
}

interface FlyDatabaseConfig {
  readonly name: string;
  readonly region: string;
  readonly plan: string;
  readonly volumeGb: number;
  readonly timeoutSeconds: number;
}

interface DeployFlags {
  readonly forceDeploy: boolean;
  readonly allowDirtyDeploy: boolean;
  readonly skipDatabase: boolean;
  readonly skipSecrets: boolean;
  readonly useManagedDatabase: boolean;
}

interface SecretsConfig {
  readonly runSockpuppet: string;
  readonly accountId?: string;
  readonly browserbaseApiKey?: string;
  readonly browserbaseContextId?: string;
  readonly browserbaseProjectId?: string;
  readonly browserbaseExtensionId?: string;
  readonly databaseUrl?: string;
}

// =============================================================================
// Provider Interfaces
// =============================================================================

/**
 * ExecutionProvider handles app lifecycle, authentication, secrets, and deployment.
 *
 * Implementations:
 * - Fly.io (createFlyExecutionProvider)
 * - Future: Railway, Render, AWS ECS, etc.
 */
interface ExecutionProvider<TConfig> {
  readonly name: string;
  readonly config: TConfig;

  prepare(config: TConfig): Promise<void>;
  ensureAuth(): Promise<void>;
  instanceExists(): Promise<boolean>;
  ensureInstance(): Promise<void>;
  setSecrets(secrets: Record<string, string>): Promise<void>;
  deploy(): Promise<void>;
}

/**
 * DatabaseProvider handles database provisioning and connection URLs.
 *
 * Implementations:
 * - Fly Managed Postgres (createFlyPostgresProvider)
 * - Future: Neon, Supabase, PlanetScale, AWS RDS, etc.
 */
interface DatabaseProvider<TConfig, TDatabase> {
  readonly name: string;

  prepare(instance: TConfig, database: TDatabase): Promise<void>;
  exists(): Promise<boolean>;
  attach(): Promise<void>;
  waitForReady(): Promise<string>;
}

// =============================================================================
// Output Helpers
// =============================================================================

const ok = statusOk;
const warn = statusWarn;
const err = statusErr;

const spinner = new Spinner();

/**
 * Wrapper around runWithSpinner that returns a simplified result.
 */
const runQuiet = async (
  label: string,
  command: string[],
): Promise<{ success: boolean; output: string }> => {
  const result = await runWithSpinner(label, command);
  return {
    success: result.success,
    output: result.stdout + result.stderr,
  };
};

// =============================================================================
// TOML Parsing
// =============================================================================

const FlyTomlSchema = z.object({
  app: z.string().optional(),
  primary_region: z.string().optional(),
}).loose();

const readFlyToml = (filePath: string): z.infer<typeof FlyTomlSchema> | undefined => {
  if (!fileExistsSync(filePath)) return undefined;
  const content = Deno.readTextFileSync(filePath);
  const parsed = FlyTomlSchema.safeParse(parseToml(content));
  return parsed.success ? parsed.data : undefined;
};

// =============================================================================
// Git Utilities
// =============================================================================

const gitFingerprint = async (): Promise<string> => {
  const headResult = await runCommand(["git", "rev-parse", "HEAD"]);
  if (headResult.code !== 0) {
    die("Cannot Get Git HEAD \u2014 Is This a Git Repository?");
  }
  const head = headResult.stdout.trim();

  const statusResult = await runCommand([
    "git",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const dirty = statusResult.stdout.trim();

  if (dirty) {
    const hash = encodeHex(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dirty))
    );
    return `${head}+dirty:${hash}`;
  }

  return head;
};

const fingerprintFile = (app: string): string => `.deploy/fly-${app}.fingerprint`;

const checkShouldDeploy = async (app: string, flags: DeployFlags): Promise<void> => {
  const fpFile = fingerprintFile(app);
  const fp = await gitFingerprint();

  let last = "";
  try {
    last = Deno.readTextFileSync(fpFile).trim();
  } catch {
    // file doesn't exist
  }

  if (flags.forceDeploy) {
    warn("FORCE_DEPLOY=1 \u2014 Deploying Anyway");
    return;
  }

  if (fp === last) {
    ok("No Changes Since Last Deploy");
    console.log(dim("Set FORCE_DEPLOY=1 to deploy anyway"));
    Deno.exit(0);
  }

  if (fp.includes("+dirty:") && !flags.allowDirtyDeploy) {
    warn("Uncommitted Changes Detected");
    die("Commit Changes First, or Set ALLOW_DIRTY_DEPLOY=1");
  }
};

const recordDeploy = async (app: string): Promise<void> => {
  const fp = await gitFingerprint();
  const fpFile = fingerprintFile(app);

  try {
    Deno.mkdirSync(".deploy", { recursive: true });
  } catch {
    // Directory may exist
  }

  Deno.writeTextFileSync(fpFile, fp + "\n");
};

// =============================================================================
// Prerequisites
// =============================================================================

const requireRepoRoot = (): void => {
  if (!fileExistsSync("deno.json")) die("deno.json Not Found \u2014 Run from Repo Root");
};

const requireGit = async (): Promise<void> => {
  if (!(await commandExists("git"))) {
    die("git Not Found");
  }
  const result = await runCommand(["git", "rev-parse", "--is-inside-work-tree"]);
  if (result.code !== 0) {
    die("Not in a Git Repository");
  }
};

// =============================================================================
// Fly.io Execution Provider
// =============================================================================

const createFlyExecutionProvider = (): ExecutionProvider<FlyInstanceConfig> => {
  let _config: FlyInstanceConfig | null = null;

  const getConfig = (): FlyInstanceConfig => {
    if (!_config) throw die("FlyExecutionProvider: prepare() must be called first");
    return _config;
  };

  return {
    name: "Fly.io",
    get config(): FlyInstanceConfig {
      return getConfig();
    },

    async prepare(config: FlyInstanceConfig): Promise<void> {
      _config = config;
      if (!fileExistsSync("fly.toml")) die("fly.toml Not Found \u2014 Run from Repo Root");
      if (!fileExistsSync("Dockerfile")) die("Dockerfile Not Found \u2014 Run from Repo Root");
      if (!(await commandExists("fly"))) {
        die("flyctl Not Found \u2014 Install from https://fly.io/docs/flyctl/");
      }
    },

    async ensureAuth(): Promise<void> {
      const result = await runCommand(["fly", "auth", "whoami", "--json"]);
      if (result.code === 0) {
        const parsed = FlyAuthSchema.safeParse(JSON.parse(result.stdout));
        if (parsed.success) {
          ok(`Logged in to Fly.io as ${parsed.data.email}`);
        } else {
          ok("Logged in to Fly.io");
        }
        return;
      }

      warn("Not Logged in to Fly.io");
      if (!(await confirm("Open Browser to Log In?"))) {
        throw die("Aborted");
      }

      const loginProc = new Deno.Command("fly", {
        args: ["auth", "login"],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await loginProc.output();

      const checkResult = await runCommand(["fly", "auth", "whoami", "--json"]);
      if (checkResult.code !== 0) {
        throw die("Login failed");
      }
      ok("Logged in to Fly.io");
    },

    async instanceExists(): Promise<boolean> {
      const cfg = getConfig();
      const result = await runCommand(["fly", "status", "-a", cfg.appName, "--json"]);
      if (result.code !== 0) return false;
      const parsed = FlyStatusSchema.safeParse(JSON.parse(result.stdout));
      return parsed.success && !!parsed.data.ID;
    },

    async ensureInstance(): Promise<void> {
      const cfg = getConfig();
      if (await this.instanceExists()) {
        ok(`App Exists: ${cfg.appName}`);
        return;
      }

      console.log(bold(`Creating App: ${cfg.appName}`));
      const args = ["fly", "apps", "create", cfg.appName];
      if (cfg.org) {
        args.push("--org", cfg.org);
      }

      const result = await runQuiet("Creating App", args);
      if (!result.success) {
        die(`Failed to Create App '${cfg.appName}'`);
      }
    },

    async setSecrets(secrets: Record<string, string>): Promise<void> {
      const cfg = getConfig();
      const pairs = Object.entries(secrets)
        .filter(([_, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${v}`);

      if (pairs.length === 0) return;

      const result = await runQuiet(
        `Configuring ${pairs.length} Settings`,
        ["fly", "secrets", "set", ...pairs, "-a", cfg.appName]
      );
      if (!result.success) {
        die("Failed to Configure Settings");
      }
    },

    async deploy(): Promise<void> {
      const cfg = getConfig();
      const result = await runQuiet("fly deploy", ["fly", "deploy", "-a", cfg.appName]);
      if (!result.success) {
        die("Deploy Failed \u2014 Check the Output Above for Details");
      }
    },
  };
};

// =============================================================================
// Fly Managed Postgres Database Provider
// =============================================================================

interface FlyDbStatus {
  id: string;
  credentialStatus: string;
  pgbouncerUri?: string;
}

const createFlyPostgresProvider = (): DatabaseProvider<FlyInstanceConfig, FlyDatabaseConfig> => {
  let _instanceConfig: FlyInstanceConfig | null = null;
  let _dbConfig: FlyDatabaseConfig | null = null;
  let _orgSlug: string | null = null;

  const getInstanceConfig = (): FlyInstanceConfig => {
    if (!_instanceConfig) throw die("FlyPostgresProvider: prepare() must be called first");
    return _instanceConfig;
  };

  const getDbConfig = (): FlyDatabaseConfig => {
    if (!_dbConfig) throw die("FlyPostgresProvider: prepare() must be called first");
    return _dbConfig;
  };

  const getOrg = (): string => {
    if (!_orgSlug) throw die("FlyPostgresProvider: prepare() must be called first");
    return _orgSlug;
  };

  const getClusterId = async (): Promise<string | undefined> => {
    const result = await runCommand(["fly", "mpg", "list", "-o", getOrg(), "--json"]);
    if (result.code !== 0) return undefined;

    const parsed = FlyMpgListSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success) return undefined;

    const name = getDbConfig().name;
    const cluster = parsed.data.find((c) => c.name?.toLowerCase() === name.toLowerCase());
    return cluster?.id;
  };

  const getStatus = async (clusterId: string): Promise<FlyDbStatus | undefined> => {
    const result = await runCommand(["fly", "mpg", "status", clusterId, "--json"]);
    if (result.code !== 0) return undefined;

    const parsed = FlyMpgStatusSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success) return undefined;

    return {
      id: parsed.data.id ?? clusterId,
      credentialStatus: parsed.data.credentials?.status ?? "unknown",
      pgbouncerUri: parsed.data.credentials?.pgbouncer_uri,
    };
  };

  return {
    name: "Fly Managed Postgres",

    async prepare(instance: FlyInstanceConfig, database: FlyDatabaseConfig): Promise<void> {
      _instanceConfig = instance;
      _dbConfig = database;

      if (instance.org) {
        _orgSlug = instance.org;
      } else {
        const result = await runCommand(["fly", "orgs", "list", "--json"]);
        if (result.code === 0) {
          // JSON format: { "personal": "Name", "org-slug": "Org Name", ... }
          // Keys are slugs, values are display names
          const parsed = FlyOrgsSchema.safeParse(JSON.parse(result.stdout));
          if (parsed.success) {
            // Prefer "personal" org, otherwise use first available
            if (parsed.data.personal !== undefined) {
              _orgSlug = "personal";
            } else {
              const slugs = Object.keys(parsed.data);
              if (slugs.length > 0) {
                _orgSlug = slugs[0];
              }
            }
          }
        }
      }

      if (!_orgSlug) {
        throw die("Cannot Determine Organization \u2014 Set ORG=<slug>");
      }
    },

    async exists(): Promise<boolean> {
      const clusterId = await getClusterId();
      return clusterId !== undefined;
    },

    async attach(): Promise<void> {
      const cfg = getInstanceConfig();
      const dbCfg = getDbConfig();
      const org = getOrg();

      let clusterId = await getClusterId();

      if (!clusterId) {
        // Create cluster if it doesn't exist
        console.log(bold(`Setting Up Database: ${dbCfg.name}`));
        const result = await runQuiet("Creating Database", [
          "fly",
          "mpg",
          "create",
          "-n",
          dbCfg.name,
          "-o",
          org,
          "-r",
          dbCfg.region,
          "--plan",
          dbCfg.plan,
          "--volume-size",
          String(dbCfg.volumeGb),
        ]);
        if (!result.success) {
          die("Failed to Create Database Cluster");
        }
        clusterId = await getClusterId();
        if (!clusterId) {
          return die("Failed to Find Database Cluster After Creation");
        }
      } else {
        ok(`Database Cluster Exists: ${dbCfg.name}`);
      }

      const result = await runQuiet("Attaching Database to App", [
        "fly",
        "mpg",
        "attach",
        clusterId,
        "-a",
        cfg.appName,
        "--variable-name",
        "DATABASE_URL",
      ]);
      if (!result.success) {
        console.log(dim("  (May Already Be Attached)"));
      }
    },

    async waitForReady(): Promise<string> {
      const dbCfg = getDbConfig();
      const org = getOrg();

      const clusterId = await getClusterId();
      if (!clusterId) {
        return die(`Database Cluster '${dbCfg.name}' Not Found`);
      }

      const initialStatus = await getStatus(clusterId);
      if (!initialStatus) {
        return die("Could not Fetch Database Status \u2014 Check Your Network Connection");
      }

      let status = initialStatus;

      if (status.credentialStatus !== "ready") {
        console.log(bold("Database is Setting Up..."));
        console.log(dim("  This Typically Takes 1-3 Minutes. Safe to Ctrl-C and Re-Run Later."));
        console.log();

        const interval = 5;
        let elapsed = 0;

        while (elapsed < dbCfg.timeoutSeconds) {
          const currentStatus = await getStatus(clusterId);
          if (currentStatus?.credentialStatus === "ready") {
            status = currentStatus;
            break;
          }

          const statusText = currentStatus?.credentialStatus ?? "unknown";
          spinner.start(`Waiting for Database (${elapsed}s Elapsed, Status: ${statusText})`);
          await new Promise((resolve) => setTimeout(resolve, interval * 1000));
          spinner.stop();
          elapsed += interval;
        }

        if (status.credentialStatus !== "ready") {
          warn(`Timed Out Waiting for Database (${dbCfg.timeoutSeconds}s)`);
          console.log(dim("  Re-Run This Script Once the Database is Ready, or Fetch URL Manually:"));
          console.log(dim(`  https://fly.io/dashboard/${org}/managed_postgres/${clusterId}`));
          return die("Database Not Ready");
        }
      }

      ok("Database is ready");

      if (!status.pgbouncerUri) {
        return die("Could Not Extract DATABASE_URL from Backend.");
      }

      return status.pgbouncerUri;
    },
  };
};

// =============================================================================
// Secrets Collector
// =============================================================================

class SecretsCollector {
  private secrets: Record<string, string> = {};

  add(key: string, value?: string): void {
    if (value) {
      this.secrets[key] = value;
    }
  }

  async promptAndAdd(key: string, current?: string): Promise<void> {
    if (current) {
      this.add(key, current);
      return;
    }

    const input = await readSecret(`  ${key} (leave blank to skip): `);
    if (input) {
      this.add(key, input);
    }
  }

  getAll(): Record<string, string> {
    return { ...this.secrets };
  }

  count(): number {
    return Object.keys(this.secrets).length;
  }
}

// =============================================================================
// Orchestration
// =============================================================================

interface FlyDeployContext {
  readonly execution: ExecutionProvider<FlyInstanceConfig>;
  readonly database?: DatabaseProvider<FlyInstanceConfig, FlyDatabaseConfig>;
  readonly instance: FlyInstanceConfig;
  readonly dbConfig: FlyDatabaseConfig;
  readonly flags: DeployFlags;
  readonly secrets: SecretsConfig;
}

const setupDatabase = async (ctx: FlyDeployContext): Promise<void> => {
  const { database } = ctx;
  if (!database) return;

  await database.attach();
  const url = await database.waitForReady();
  if (writeDotenv("DATABASE_URL", url)) {
    console.log(dim("Wrote DATABASE_URL to .env"));
  }
  console.log();
};

const configureSecrets = async (ctx: FlyDeployContext): Promise<void> => {
  const { execution, secrets } = ctx;

  const collector = new SecretsCollector();
  collector.add("RUN_SOCKPUPPET", secrets.runSockpuppet);
  collector.add("ACCOUNT_ID", secrets.accountId);
  await collector.promptAndAdd("DATABASE_URL", secrets.databaseUrl);
  await collector.promptAndAdd("BROWSERBASE_API_KEY", secrets.browserbaseApiKey);
  await collector.promptAndAdd("BROWSERBASE_CONTEXT_ID", secrets.browserbaseContextId);
  await collector.promptAndAdd("BROWSERBASE_PROJECT_ID", secrets.browserbaseProjectId);
  await collector.promptAndAdd("BROWSERBASE_EXTENSION_ID", secrets.browserbaseExtensionId);

  if (collector.count() > 0) {
    await execution.setSecrets(collector.getAll());
  }

  console.log();
};

const runDeploy = async (ctx: FlyDeployContext): Promise<void> => {
  const { execution, instance, dbConfig, flags, secrets, database } = ctx;

  await execution.prepare(instance);
  if (flags.useManagedDatabase && database) {
    await database.prepare(instance, dbConfig);
  }

  await execution.ensureAuth();
  await execution.ensureInstance();
  await checkShouldDeploy(instance.appName, flags);

  if (flags.skipDatabase) {
    console.log(dim("Skipping Database Setup (SKIP_DATABASE=1)"));
  } else if (secrets.databaseUrl) {
    // DATABASE_URL already set
  } else if (flags.useManagedDatabase && database) {
    await setupDatabase(ctx);
  }

  if (!flags.skipSecrets) {
    await configureSecrets(ctx);
  } else {
    console.log(dim("Skipping Secrets (SKIP_SECRETS=1)"));
  }

  await execution.deploy();

  await recordDeploy(instance.appName);

  console.log();
  ok("Deploy Complete!");
  console.log(dim("  View Logs:   bernays logs"));
  console.log(dim("  App Status:  bernays status"));
};

// =============================================================================
// CLI
// =============================================================================

const HELP = `
${bold("deploy.ts")} \u2014 Deploy Your Bernays Bot

${bold("USAGE")}
  bernays deploy [OPTIONS]

${bold("OPTIONS")}
  --app <name>           App Name (default: from fly.toml or APP_NAME env)
  --region <code>        Deploy Region (default: from fly.toml or "iad")
  --org <slug>           Organization Slug
  --force                Deploy Even if No Changes Detected
  --allow-dirty          Deploy With Uncommitted Changes
  --skip-database        Skip Database Setup
  --skip-secrets         Skip Secret Configuration
  --help                 Show This Help
${bold("PROVIDERS")}
  Execution:  Fly.io (default)
  Database:   Fly Managed Postgres (when USE_FLY_POSTGRES=1)

${bold("ENVIRONMENT")}
  See Script Header for Full List of Environment Variables.

${bold("EXAMPLES")}
  bernays deploy
  bernays deploy --force
  USE_FLY_POSTGRES=1 bernays deploy
`.trim();

interface CliArgs {
  help: boolean;
  app?: string;
  region?: string;
  org?: string;
  force: boolean;
  allowDirty: boolean;
  skipDatabase: boolean;
  skipSecrets: boolean;
}

const parseCliArgs = (argv: string[]): CliArgs => {
  const args = parseArgs(argv, {
    string: ["app", "region", "org"],
    boolean: ["help", "force", "allow-dirty", "skip-database", "skip-secrets"],
    default: {
      force: false,
      "allow-dirty": false,
      "skip-database": false,
      "skip-secrets": false,
    },
  });

  return {
    help: args.help,
    app: args.app,
    region: args.region,
    org: args.org,
    force: args.force,
    allowDirty: args["allow-dirty"],
    skipDatabase: args["skip-database"],
    skipSecrets: args["skip-secrets"],
  };
};

// =============================================================================
// Main
// =============================================================================

const main = async (): Promise<void> => {
  globalThis.addEventListener("unload", () => spinner.stop());

  try {
    Deno.addSignalListener("SIGINT", () => {
      spinner.stop();
      Deno.exit(130);
    });
    Deno.addSignalListener("SIGTERM", () => {
      spinner.stop();
      Deno.exit(143);
    });
  } catch {
    // signal listeners may not be available on all platforms
  }

  loadDotenv();

  const argv = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
  const args = parseCliArgs(argv);

  if (args.help) {
    console.log(HELP);
    return;
  }

  requireRepoRoot();
  await requireGit();

  const flyToml = readFlyToml("fly.toml");

  const instance: FlyInstanceConfig = {
    appName: args.app ?? Deno.env.get("APP_NAME") ?? flyToml?.app ?? "",
    region: args.region ?? Deno.env.get("REGION") ?? flyToml?.primary_region ?? "iad",
    org: args.org ?? Deno.env.get("ORG"),
  };

  if (!instance.appName) {
    die("Cannot Determine App Name \u2014 Set APP_NAME or Check fly.toml");
  }

  const flags: DeployFlags = {
    forceDeploy: args.force || Deno.env.get("FORCE_DEPLOY") === "1",
    allowDirtyDeploy: args.allowDirty || Deno.env.get("ALLOW_DIRTY_DEPLOY") === "1",
    skipDatabase: args.skipDatabase || Deno.env.get("SKIP_DATABASE") === "1",
    skipSecrets: args.skipSecrets || Deno.env.get("SKIP_SECRETS") === "1",
    useManagedDatabase: Deno.env.get("USE_FLY_POSTGRES") === "1",
  };

  const dbConfig: FlyDatabaseConfig = {
    name: Deno.env.get("DATABASE_NAME") ?? "bernays-db",
    region: instance.region,
    plan: Deno.env.get("DB_PLAN") ?? "development",
    volumeGb: parseInt(Deno.env.get("DB_VOLUME_GB") ?? "10", 10),
    timeoutSeconds: parseInt(Deno.env.get("DB_READY_TIMEOUT") ?? "300", 10),
  };

  const secrets: SecretsConfig = {
    runSockpuppet: Deno.env.get("RUN_SOCKPUPPET") ?? "1",
    accountId: Deno.env.get("ACCOUNT_ID"),
    browserbaseApiKey: Deno.env.get("BROWSERBASE_API_KEY"),
    browserbaseContextId: Deno.env.get("BROWSERBASE_CONTEXT_ID"),
    browserbaseProjectId: Deno.env.get("BROWSERBASE_PROJECT_ID"),
    browserbaseExtensionId: Deno.env.get("BROWSERBASE_EXTENSION_ID"),
    databaseUrl: Deno.env.get("DATABASE_URL"),
  };

  const execution = createFlyExecutionProvider();
  const database = flags.useManagedDatabase ? createFlyPostgresProvider() : undefined;

  console.log();
  console.log(bold("\u2550".repeat(59)));
  console.log(bold(`  DEPLOY: ${instance.appName}`));
  console.log(bold(`  Provider: ${execution.name}${database ? ` + ${database.name}` : ""}`));
  console.log(bold("\u2550".repeat(59)));
  console.log();

  await runDeploy({
    execution,
    database,
    instance,
    dbConfig,
    flags,
    secrets,
  });
};

// =============================================================================
// Entry
// =============================================================================

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    spinner.stop();
    if (error instanceof Error && error.message !== "exit") {
      err(error.message);
    }
    Deno.exit(1);
  }
}
