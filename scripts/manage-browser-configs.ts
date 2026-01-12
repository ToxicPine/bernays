#!/usr/bin/env -S deno run -A
// =============================================================================
// manage-configs.ts — Browser config registry TUI
// =============================================================================
//
// Usage:
//   deno run -A scripts/manage-configs.ts
//   just configs
//
// Commands:
//   list              List all browser configs
//   view <id>         View a specific config
//   create            Create a new config interactively
//   edit <id>         Edit an existing config
//   delete <id>       Delete a config
//   (no args)         Interactive TUI mode
//
// Environment:
//   DATABASE_URL      Postgres connection string (required)
//
// =============================================================================

import { parseArgs } from "@std/cli";
import { Effect, Option } from "effect";
import {
  createPostgresConfigStore,
  type ConfigStoreService,
} from "@bernays/server/store";
import { BrowserConfigId, ExtensionId } from "@bernays/server/core";
import type { BrowserConfig, ProxyConfig } from "@bernays/server/backend";
import { bold, createLogger, cyan, dim, green, red, yellow } from "./lib/log.ts";
import { boxHeader, clearScreen, confirm, hr, readLine, readSecret, waitForEnter, writeln } from "./lib/tui.ts";

// =============================================================================
// Types
// =============================================================================

type Command =
  | { type: "interactive" }
  | { type: "list" }
  | { type: "view"; id: string }
  | { type: "create" }
  | { type: "edit"; id: string }
  | { type: "delete"; id: string };

// =============================================================================
// Display Helpers
// =============================================================================

const formatConfig = (config: BrowserConfig, detailed: boolean = false): string => {
  const lines: string[] = [];

  lines.push(`${bold("ID:")}       ${cyan(config.id)}`);
  lines.push(`${bold("Context:")}  ${config.context}`);

  if (config.extensionIds.length > 0) {
    lines.push(`${bold("Extensions:")}`);
    for (const extId of config.extensionIds) {
      lines.push(`  - ${extId}`);
    }
  } else {
    lines.push(`${bold("Extensions:")} ${dim("(none)")}`);
  }

  if (config.proxy) {
    lines.push(`${bold("Proxy:")}`);
    lines.push(`  Server:   ${config.proxy.server}`);
    if (detailed) {
      lines.push(`  Username: ${config.proxy.username ?? dim("(none)")}`);
      lines.push(`  Password: ${config.proxy.password ? dim("[set]") : dim("(none)")}`);
    } else {
      if (config.proxy.username) {
        lines.push(`  Auth:     ${green("configured")}`);
      }
    }
  } else {
    lines.push(`${bold("Proxy:")}    ${dim("(none)")}`);
  }

  return lines.join("\n");
};

const formatConfigRow = (config: BrowserConfig, index: number): string => {
  const extCount = config.extensionIds.length;
  const proxyStatus = config.proxy ? green("yes") : dim("no");
  const extStatus = extCount > 0 ? `${extCount}` : dim("0");

  return `  ${dim(`[${index + 1}]`)} ${cyan(config.id.padEnd(24))} ${dim("ctx:")} ${config.context.slice(0, 20).padEnd(20)} ${dim("ext:")} ${extStatus.padEnd(3)} ${dim("proxy:")} ${proxyStatus}`;
};

// =============================================================================
// Commands
// =============================================================================

const listConfigs = async (store: ConfigStoreService): Promise<void> => {
  const result = await Effect.runPromise(store.list());

  if (result.length === 0) {
    writeln(yellow("No browser configs found."));
    writeln(dim("Use 'create' to add a new config."));
    return;
  }

  writeln(bold("\nBrowser Configs\n"));
  writeln(dim(hr(80)));

  for (let i = 0; i < result.length; i++) {
    writeln(formatConfigRow(result[i], i));
  }

  writeln(dim(hr(80)));
  writeln(dim(`\nTotal: ${result.length} config(s)`));
};

const viewConfig = async (store: ConfigStoreService, id: string): Promise<void> => {
  const result = await Effect.runPromise(store.get(BrowserConfigId(id)));

  if (Option.isNone(result)) {
    writeln(red(`Config not found: ${id}`));
    return;
  }

  writeln(bold("\nBrowser Config\n"));
  writeln(dim(hr(50)));
  writeln(formatConfig(result.value, true));
  writeln(dim(hr(50)));
};

const createConfig = async (store: ConfigStoreService): Promise<void> => {
  writeln(bold("\nCreate Browser Config\n"));
  writeln(dim(hr(50)));

  // ID
  const id = await readLine(`${bold("ID")} (unique identifier): `);
  if (!id) {
    writeln(red("ID is required."));
    return;
  }

  // Check if exists
  const existing = await Effect.runPromise(store.get(BrowserConfigId(id)));
  if (Option.isSome(existing)) {
    writeln(red(`Config with ID '${id}' already exists.`));
    return;
  }

  // Context
  const context = await readLine(`${bold("Context")} (browserbase context or profile): `);
  if (!context) {
    writeln(red("Context is required."));
    return;
  }

  // Extensions
  writeln(dim("\nExtension IDs (comma-separated, or empty for none):"));
  const extInput = await readLine(`${bold("Extensions")}: `);
  const extensionIds = extInput
    ? extInput.split(",").map((s) => ExtensionId(s.trim())).filter((s) => s)
    : [];

  // Proxy
  const useProxy = await confirm(`\n${bold("Configure proxy?")}`);
  let proxy: ProxyConfig | undefined;

  if (useProxy) {
    const server = await readLine(`  ${bold("Proxy server")} (host:port): `);
    if (server) {
      const username = await readLine(`  ${bold("Username")} (optional): `);
      const password = username ? await readSecret(`  ${bold("Password")} (optional): `) : "";

      proxy = {
        server,
        username: username || undefined,
        password: password || undefined,
      };
    }
  }

  const config: BrowserConfig = {
    id: BrowserConfigId(id),
    context,
    extensionIds,
    proxy,
  };

  writeln(dim("\n" + hr(50)));
  writeln(bold("\nReview:\n"));
  writeln(formatConfig(config, true));
  writeln();

  if (await confirm("Save this config?")) {
    await Effect.runPromise(store.upsert(config));
    writeln(green("\nConfig created successfully."));
  } else {
    writeln(yellow("\nCancelled."));
  }
};

const editConfig = async (store: ConfigStoreService, id: string): Promise<void> => {
  const result = await Effect.runPromise(store.get(BrowserConfigId(id)));

  if (Option.isNone(result)) {
    writeln(red(`Config not found: ${id}`));
    return;
  }

  const config = result.value;

  writeln(bold("\nEdit Browser Config\n"));
  writeln(dim(hr(50)));
  writeln(formatConfig(config, true));
  writeln(dim(hr(50)));
  writeln(dim("\nPress Enter to keep current value.\n"));

  // Context
  const contextInput = await readLine(`${bold("Context")} [${config.context}]: `);
  const context = contextInput || config.context;

  // Extensions
  const currentExt = config.extensionIds.join(", ") || "(none)";
  writeln(dim(`\nCurrent extensions: ${currentExt}`));
  const extInput = await readLine(`${bold("Extensions")} (comma-separated, '-' to clear): `);
  let extensionIds: readonly ExtensionId[];
  if (extInput === "-") {
    extensionIds = [];
  } else if (extInput) {
    extensionIds = extInput.split(",").map((s) => ExtensionId(s.trim())).filter((s) => s);
  } else {
    extensionIds = config.extensionIds;
  }

  // Proxy
  writeln();
  let proxy: ProxyConfig | undefined = config.proxy;

  if (config.proxy) {
    writeln(dim(`Current proxy: ${config.proxy.server}`));
    const proxyAction = await readLine(`${bold("Proxy")} [k]eep / [e]dit / [r]emove: `);

    if (proxyAction.toLowerCase() === "r") {
      proxy = undefined;
    } else if (proxyAction.toLowerCase() === "e") {
      const server = await readLine(`  ${bold("Server")} [${config.proxy.server}]: `);
      const username = await readLine(`  ${bold("Username")} [${config.proxy.username || "(none)"}]: `);
      const changePass = await confirm(`  ${bold("Change password?")}`);
      const password = changePass ? await readSecret(`  ${bold("Password")}: `) : config.proxy.password;

      proxy = {
        server: server || config.proxy.server,
        username: username || config.proxy.username,
        password: password,
      };
    }
  } else {
    if (await confirm(`${bold("Add proxy?")}`)) {
      const server = await readLine(`  ${bold("Server")} (host:port): `);
      if (server) {
        const username = await readLine(`  ${bold("Username")} (optional): `);
        const password = username ? await readSecret(`  ${bold("Password")} (optional): `) : "";
        proxy = {
          server,
          username: username || undefined,
          password: password || undefined,
        };
      }
    }
  }

  const updated: BrowserConfig = {
    id: config.id,
    context,
    extensionIds,
    proxy,
  };

  writeln(dim("\n" + hr(50)));
  writeln(bold("\nUpdated config:\n"));
  writeln(formatConfig(updated, true));
  writeln();

  if (await confirm("Save changes?")) {
    await Effect.runPromise(store.upsert(updated));
    writeln(green("\nConfig updated successfully."));
  } else {
    writeln(yellow("\nCancelled."));
  }
};

const deleteConfig = async (store: ConfigStoreService, id: string): Promise<void> => {
  const result = await Effect.runPromise(store.get(BrowserConfigId(id)));

  if (Option.isNone(result)) {
    writeln(red(`Config not found: ${id}`));
    return;
  }

  writeln(bold("\nDelete Browser Config\n"));
  writeln(dim(hr(50)));
  writeln(formatConfig(result.value));
  writeln(dim(hr(50)));

  if (await confirm(`\n${red("Delete this config?")} This cannot be undone.`)) {
    const deleted = await Effect.runPromise(store.remove(BrowserConfigId(id)));
    if (deleted) {
      writeln(green("\nConfig deleted successfully."));
    } else {
      writeln(red("\nFailed to delete config."));
    }
  } else {
    writeln(yellow("\nCancelled."));
  }
};

// =============================================================================
// Interactive TUI
// =============================================================================

/**
 * Resolve a config ID from user input (can be index number or actual ID).
 */
const resolveConfigId = async (
  configs: readonly BrowserConfig[],
  prompt: string,
): Promise<string | null> => {
  const input = await readLine(prompt);
  if (!input) return null;

  const idx = parseInt(input) - 1;
  if (idx >= 0 && idx < configs.length) {
    return configs[idx].id;
  }
  return input;
};

/**
 * Execute an action on a config with common error handling.
 */
const withConfigAction = async (
  configs: readonly BrowserConfig[],
  emptyMessage: string,
  action: (id: string) => Promise<void>,
): Promise<void> => {
  if (configs.length === 0) {
    writeln(yellow(`\n${emptyMessage}`));
    return;
  }

  const id = await resolveConfigId(configs, "  Enter config number or ID: ");
  if (id) {
    await action(id);
  }
};

const interactiveMenu = async (store: ConfigStoreService): Promise<void> => {
  while (true) {
    clearScreen();
    writeln(boxHeader("Browser Config Manager", 62));
    writeln();

    // List configs
    const configs = await Effect.runPromise(store.list());

    if (configs.length === 0) {
      writeln(dim("  No configs found.\n"));
    } else {
      writeln(dim("  Configs:\n"));
      for (let i = 0; i < configs.length; i++) {
        writeln(formatConfigRow(configs[i], i));
      }
      writeln();
    }

    writeln(dim(hr(62)));
    writeln();
    writeln("  " + bold("[c]") + " Create new config");
    if (configs.length > 0) {
      writeln("  " + bold("[v]") + " View config details");
      writeln("  " + bold("[e]") + " Edit config");
      writeln("  " + bold("[d]") + " Delete config");
    }
    writeln("  " + bold("[q]") + " Quit");
    writeln();

    const choice = await readLine(bold("  > "));

    switch (choice.toLowerCase()) {
      case "q":
      case "quit":
      case "exit":
        writeln(dim("\nGoodbye."));
        return;

      case "c":
      case "create":
        await createConfig(store);
        await waitForEnter();
        break;

      case "v":
      case "view":
        await withConfigAction(configs, "No configs to view.", (id) => viewConfig(store, id));
        await waitForEnter();
        break;

      case "e":
      case "edit":
        await withConfigAction(configs, "No configs to edit.", (id) => editConfig(store, id));
        await waitForEnter();
        break;

      case "d":
      case "delete":
        await withConfigAction(configs, "No configs to delete.", (id) => deleteConfig(store, id));
        await waitForEnter();
        break;

      default: {
        // Check if it's a number to view directly
        const num = parseInt(choice) - 1;
        if (num >= 0 && num < configs.length) {
          await viewConfig(store, configs[num].id);
          await waitForEnter();
        }
        break;
      }
    }
  }
};

// =============================================================================
// CLI
// =============================================================================

const HELP = `
${bold("manage-configs.ts")} — Browser config registry TUI

${bold("USAGE")}
  deno run -A scripts/manage-configs.ts [COMMAND]
  just configs [COMMAND]

${bold("COMMANDS")}
  (none)            Interactive TUI mode
  list              List all browser configs
  view <id>         View a specific config
  create            Create a new config interactively
  edit <id>         Edit an existing config
  delete <id>       Delete a config

${bold("EXAMPLES")}
  just configs                    # Interactive mode
  just configs list               # List all configs
  just configs view my-browser    # View specific config
  just configs create             # Create new config
`.trim();

const parseCommand = (argv: string[]): Command => {
  const args = parseArgs(argv, {
    boolean: ["help"],
    alias: { h: "help" },
  });

  if (args.help) {
    console.log(HELP);
    Deno.exit(0);
  }

  const [cmd, ...rest] = args._;

  switch (cmd) {
    case "list":
      return { type: "list" };
    case "view":
      if (!rest[0]) {
        console.error(red("Error: 'view' requires a config ID"));
        Deno.exit(1);
      }
      return { type: "view", id: String(rest[0]) };
    case "create":
      return { type: "create" };
    case "edit":
      if (!rest[0]) {
        console.error(red("Error: 'edit' requires a config ID"));
        Deno.exit(1);
      }
      return { type: "edit", id: String(rest[0]) };
    case "delete":
      if (!rest[0]) {
        console.error(red("Error: 'delete' requires a config ID"));
        Deno.exit(1);
      }
      return { type: "delete", id: String(rest[0]) };
    default:
      return { type: "interactive" };
  }
};

// =============================================================================
// Main
// =============================================================================

const main = async (): Promise<void> => {
  const log = createLogger(false);

  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    log.error(`DATABASE_URL is not set.

To set up the database, run:

    ${bold("just deploy")}

This will create a managed Postgres database and write DATABASE_URL to .env.
`);
    Deno.exit(1);
  }

  const store = await createPostgresConfigStore({ connectionString: databaseUrl });
  const command = parseCommand(Deno.args);

  switch (command.type) {
    case "interactive":
      await interactiveMenu(store);
      break;
    case "list":
      await listConfigs(store);
      break;
    case "view":
      await viewConfig(store, command.id);
      break;
    case "create":
      await createConfig(store);
      break;
    case "edit":
      await editConfig(store, command.id);
      break;
    case "delete":
      await deleteConfig(store, command.id);
      break;
  }
};

// =============================================================================
// Entry
// =============================================================================

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const log = createLogger(false);
    log.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
