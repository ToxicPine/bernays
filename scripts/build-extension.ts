#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
// =============================================================================
// build.ts — Build browser extension
// =============================================================================
//
// Usage:
//   deno task build              # build JS only
//   deno task build:zip          # build JS + create zip
//   just ext-build               # from repo root
//
// Options:
//   --zip, -z      Create extension zip after building
//   --silent, -s   Suppress non-error output
//
// Environment:
//   ESBUILD        Path to esbuild binary (default: "esbuild")
//   ZIP_TOOL       Path to zip tool (default: "deterministic-zip")
//
// =============================================================================

import { encodeBase32 } from "@std/encoding/base32";
import { parseArgs } from "@std/cli";
import { createLogger, type Logger } from "./lib/log.ts";
import { fileExists, runCommand } from "./lib/shell.ts";

// =============================================================================
// Config
// =============================================================================

const PROJECT_ROOT = new URL("..", import.meta.url).pathname;
const BROWSER_PKG = new URL("../backend/browser", import.meta.url).pathname;
const DIST_DIR = `${PROJECT_ROOT}/.build/extensions`;
const ZIP_DIR = `${PROJECT_ROOT}/.build/injectables`;

const ESBUILD = Deno.env.get("ESBUILD") || "esbuild";
const ZIP_TOOL = Deno.env.get("ZIP_TOOL") || "deterministic-zip";

// =============================================================================
// Types
// =============================================================================

interface Handler {
  name: string;
  src: string;
  matches: string[];
}

interface Manifest {
  manifest_version: number;
  name: string;
  description: string;
  version: string;
  permissions: string[];
  host_permissions: string[];
  content_scripts: {
    matches: string[];
    js: string[];
    run_at: string;
    all_frames: boolean;
  }[];
  background: { service_worker: string };
  web_accessible_resources: { resources: string[]; matches: string[] }[];
}

interface BuildConfig {
  silent: boolean;
  zip: boolean;
}

// =============================================================================
// Handlers
// =============================================================================

const HANDLERS: Handler[] = [
  {
    name: "linkedin",
    src: "src/handlers/linkedin/handlers.ts",
    matches: ["https://www.linkedin.com/*"],
  },
  {
    name: "x",
    src: "src/handlers/x/handlers.ts",
    matches: ["https://www.x.com/*", "https://twitter.com/*"],
  },
  {
    name: "reddit",
    src: "src/handlers/reddit/handlers.ts",
    matches: ["https://www.reddit.com/*", "https://old.reddit.com/*"],
  },
];

// =============================================================================
// Manifest Generation
// =============================================================================

const generateManifest = (handlers: Handler[]): Manifest => {
  const allMatches = new Set<string>();
  const handlerFiles: string[] = [];

  for (const handler of handlers) {
    handler.matches.forEach((m) => allMatches.add(m));
    handlerFiles.push(`${handler.name}-handlers.js`);
  }

  return {
    manifest_version: 3,
    name: "Dubious Manhood",
    description: "???",
    version: "0.1.0",
    permissions: ["storage", "scripting"],
    host_permissions: [...allMatches],
    content_scripts: [
      {
        // loader.js runs in isolated world and injects content.js into MAIN world
        // This is required because MV3 content scripts can't directly modify
        // the page's window object, but Playwright needs to access __bridgeHandler
        matches: [...allMatches],
        js: ["loader.js"],
        run_at: "document_start",
        all_frames: false,
      },
    ],
    background: { service_worker: "background.js" },
    web_accessible_resources: [
      {
        // content.js must be web-accessible so loader.js can inject it via script tag
        resources: ["content.js", "bridge.js", ...handlerFiles],
        matches: [...allMatches],
      },
    ],
  };
};

// =============================================================================
// Build Steps
// =============================================================================

const compileFile = async (
  src: string,
  out: string,
  log: Logger,
): Promise<void> => {
  log.info(`Compiling ${src}`);
  const result = await runCommand([
    ESBUILD,
    src,
    "--bundle",
    "--format=iife",
    "--target=es2022",
    "--platform=browser",
    `--outfile=${out}`,
  ]);

  if (!result.success) {
    throw new Error(`Failed to build ${src}: ${result.stderr || result.stdout || `Exit code ${result.code}`}`);
  }
  log.ok(out);
};

const buildJs = async (log: Logger): Promise<void> => {
  log.section("Building TypeScript → JavaScript");
  await Deno.mkdir(DIST_DIR, { recursive: true });

  // Core files
  const coreFiles = [
    { src: "src/core/bridge.ts", out: `${DIST_DIR}/bridge.js` },
    { src: "src/background.ts", out: `${DIST_DIR}/background.js` },
    { src: "src/loader.ts", out: `${DIST_DIR}/loader.js` },
    { src: "src/content.ts", out: `${DIST_DIR}/content.js` },
  ];

  for (const file of coreFiles) {
    await compileFile(file.src, file.out, log);
  }

  // Handler files
  for (const handler of HANDLERS) {
    if (!(await fileExists(handler.src))) {
      throw new Error(`Handler not found: ${handler.src}`);
    }
    await compileFile(
      handler.src,
      `${DIST_DIR}/${handler.name}-handlers.js`,
      log,
    );
  }

  log.info("Generating manifest.json");
  const manifest = generateManifest(HANDLERS);
  await Deno.writeTextFile(
    `${DIST_DIR}/manifest.json`,
    JSON.stringify(manifest, null, 2),
  );
  log.ok(`${DIST_DIR}/manifest.json`);
};

const buildZip = async (log: Logger): Promise<string> => {
  log.section("Creating Extension Zip");
  await Deno.mkdir(ZIP_DIR, { recursive: true });

  const zipFile = await Deno.makeTempFile({ suffix: ".zip" });
  await Deno.remove(zipFile);

  log.info(`Using ${ZIP_TOOL}`);
  const result = await runCommand([ZIP_TOOL, "-r", zipFile, "."], {
    cwd: DIST_DIR,
  });

  if (!result.success) {
    throw new Error(
      `Zip failed: ${result.stderr || result.stdout}\nMake sure ${ZIP_TOOL} is available.`,
    );
  }

  const data = await Deno.readFile(zipFile);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hash = encodeBase32(new Uint8Array(hashBuffer)).toLowerCase();
  const finalPath = `${ZIP_DIR}/extension-${hash}.zip`;

  await Deno.copyFile(zipFile, finalPath);
  await Deno.remove(zipFile);

  log.ok(finalPath);
  return finalPath;
};

// =============================================================================
// Main
// =============================================================================

export const build = async (config: BuildConfig): Promise<void> => {
  const log = createLogger(config.silent);

  await buildJs(log);

  if (config.zip) {
    await buildZip(log);
  }

  log.section("Done");
};

// =============================================================================
// CLI
// =============================================================================

if (import.meta.main) {
  Deno.chdir(BROWSER_PKG);

  const args = parseArgs(Deno.args, {
    boolean: ["zip", "silent", "help"],
    alias: { z: "zip", s: "silent", h: "help" },
  });

  if (args.help) {
    console.log(`
build.ts — Build browser extension

USAGE
  deno task build [OPTIONS]
  just ext-build [OPTIONS]

OPTIONS
  --zip, -z      Create extension zip after building
  --silent, -s   Suppress non-error output
  --help, -h     Show this help
`.trim());
    Deno.exit(0);
  }

  try {
    await build({ zip: args.zip, silent: args.silent });
  } catch (error) {
    const log = createLogger(false);
    log.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
