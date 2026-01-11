#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
// =============================================================================
// sync.ts — Sync extension to Browserbase
// =============================================================================
//
// Usage:
//   deno task sync              # from packages/browser
//   just ext-sync               # from repo root
//
// Options:
//   --silent, -s   Suppress non-error output
//
// What it does:
//   1. Finds the latest extension zip
//   2. If no BROWSERBASE_EXTENSION_ID: uploads as new extension
//   3. If extension exists: compares filename, updates if different
//   4. Writes BROWSERBASE_EXTENSION_ID to .env
//
// Environment:
//   BROWSERBASE_API_KEY       Required
//   BROWSERBASE_EXTENSION_ID  Optional (will be created if missing)
//
// =============================================================================

import { parseArgs } from "jsr:@std/cli@^1.0.25/parse-args";

// =============================================================================
// Config
// =============================================================================

const PROJECT_ROOT = new URL("../../..", import.meta.url).pathname;
const BROWSER_PKG = new URL("..", import.meta.url).pathname;
const API_BASE = "https://www.browserbase.com";

const ZIP_DIR = `${BROWSER_PKG}/injectables`;

// =============================================================================
// Types
// =============================================================================

interface ExtensionInfo {
  id: string;
  createdAt: string;
  updatedAt: string;
  fileName: string;
  projectId: string;
}

interface SyncConfig {
  silent: boolean;
}

// =============================================================================
// Logger
// =============================================================================

const createLogger = (silent: boolean) => {
  const c = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    reset: "\x1b[0m",
  };

  return {
    info: (msg: string) =>
      !silent && console.log(`${c.cyan}[INFO]${c.reset} ${msg}`),
    ok: (msg: string) =>
      !silent && console.log(`${c.green}[OK]${c.reset} ${msg}`),
    warn: (msg: string) =>
      !silent && console.log(`${c.yellow}[WARN]${c.reset} ${msg}`),
    error: (msg: string) => console.error(`${c.red}[ERR]${c.reset} ${msg}`),
    section: (msg: string) => !silent && console.log(`\n==> ${msg}`),
    dim: (msg: string) => !silent && console.log(`${c.dim}${msg}${c.reset}`),
  };
};

// =============================================================================
// Environment
// =============================================================================

const loadEnv = async (): Promise<void> => {
  const envPath = `${PROJECT_ROOT}/.env`;
  try {
    const content = await Deno.readTextFile(envPath);
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).replace(/^["']|["']$/g, "");
      if (key && !Deno.env.get(key)) {
        Deno.env.set(key, value);
      }
    }
  } catch {
    // .env doesn't exist
  }
};

const updateEnvFile = async (
  key: string,
  value: string,
  log: ReturnType<typeof createLogger>,
): Promise<void> => {
  const envPath = `${PROJECT_ROOT}/.env`;
  let lines: string[] = [];

  try {
    lines = (await Deno.readTextFile(envPath)).split("\n");
  } catch {
    // File doesn't exist
  }

  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) {
    lines.push(`${key}="${value}"`);
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  await Deno.writeTextFile(envPath, lines.join("\n") + "\n");
  log.ok(`Updated ${key} in .env`);
};

// =============================================================================
// Zip Discovery
// =============================================================================

const findLatestZip = async (): Promise<{ path: string; name: string }> => {
  try {
    await Deno.stat(ZIP_DIR);
  } catch {
    throw new Error(
      `Zip directory not found: ${ZIP_DIR}\nRun 'just ext-build' first.`,
    );
  }

  let latest: { path: string; name: string; mtime: number } | null = null;

  for await (const entry of Deno.readDir(ZIP_DIR)) {
    if (
      !entry.isFile || !entry.name.startsWith("extension-") ||
      !entry.name.endsWith(".zip")
    ) {
      continue;
    }
    const path = `${ZIP_DIR}/${entry.name}`;
    const stat = await Deno.stat(path);
    const mtime = stat.mtime?.getTime() ?? 0;

    if (!latest || mtime > latest.mtime) {
      latest = { path, name: entry.name, mtime };
    }
  }

  if (!latest) {
    throw new Error(
      `No extension zip found in ${ZIP_DIR}.`,
    );
  }

  return { path: latest.path, name: latest.name };
};

// =============================================================================
// Browserbase API
// =============================================================================

const getExtension = async (
  id: string,
  apiKey: string,
): Promise<ExtensionInfo | null> => {
  const res = await fetch(`${API_BASE}/v1/extensions/${id}`, {
    headers: { "X-BB-API-Key": apiKey },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Failed to get extension: ${res.status} ${await res.text()}`,
    );
  }

  return res.json();
};

const deleteExtension = async (
  id: string,
  apiKey: string,
  log: ReturnType<typeof createLogger>,
): Promise<void> => {
  const res = await fetch(`${API_BASE}/v1/extensions/${id}`, {
    method: "DELETE",
    headers: { "X-BB-API-Key": apiKey },
  });

  if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
    log.warn(`Delete returned unexpected status: ${res.status}`);
  }
};

const uploadExtension = async (
  zipPath: string,
  fileName: string,
  apiKey: string,
): Promise<ExtensionInfo> => {
  const zipData = await Deno.readFile(zipPath);
  const blob = new Blob([zipData], { type: "application/zip" });

  const form = new FormData();
  form.append("file", blob, fileName);

  const res = await fetch(`${API_BASE}/v1/extensions`, {
    method: "POST",
    headers: { "X-BB-API-Key": apiKey },
    body: form,
  });

  if (!res.ok) {
    throw new Error(
      `Failed to upload extension: ${res.status} ${await res.text()}`,
    );
  }

  return res.json();
};

// =============================================================================
// Main
// =============================================================================

export const sync = async (config: SyncConfig): Promise<void> => {
  const log = createLogger(config.silent);

  await loadEnv();

  const apiKey = Deno.env.get("BROWSERBASE_API_KEY");
  if (!apiKey) {
    throw new Error(
      "BROWSERBASE_API_KEY is not set.\nSet it in .env or as an environment variable.",
    );
  }

  const existingId = Deno.env.get("BROWSERBASE_EXTENSION_ID");

  // Find zip
  log.section("Finding Latest Extension Zip");
  const zip = await findLatestZip();
  log.info(`Zip: ${zip.name}`);

  // Check existing
  let existingExt: ExtensionInfo | null = null;
  if (existingId) {
    log.section("Checking Existing Extension");
    try {
      existingExt = await getExtension(existingId, apiKey);
      if (existingExt) {
        log.info(`Current: ${existingExt.fileName}`);
      } else {
        log.warn(`Extension ${existingId} not found in Browserbase`);
      }
    } catch (e) {
      log.warn(
        `Could not fetch extension: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  // Check if up to date
  if (existingExt && existingExt.fileName === zip.name) {
    log.ok("Extension is up to date");
    return;
  }

  // Upload
  log.section("Syncing Extension");

  if (existingExt) {
    log.info("Deleting old extension...");
    await deleteExtension(existingExt.id, apiKey, log);
  }

  log.info("Uploading...");
  const uploaded = await uploadExtension(zip.path, zip.name, apiKey);
  log.ok(`Uploaded: ${uploaded.id}`);

  if (uploaded.id !== existingId) {
    await updateEnvFile("BROWSERBASE_EXTENSION_ID", uploaded.id, log);
  }

  log.section("Done");
  log.dim(`  ID: ${uploaded.id}`);
  log.dim(`  File: ${uploaded.fileName}`);
};

// =============================================================================
// CLI
// =============================================================================

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["silent", "help"],
    alias: { s: "silent", h: "help" },
  });

  if (args.help) {
    console.log(`
sync.ts — Sync extension to Browserbase

USAGE
  deno task sync [OPTIONS]
  just ext-sync [OPTIONS]

OPTIONS
  --silent, -s   Suppress non-error output
  --help, -h     Show this help
`.trim());
    Deno.exit(0);
  }

  try {
    await sync({ silent: args.silent });
  } catch (error) {
    const log = createLogger(false);
    log.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
