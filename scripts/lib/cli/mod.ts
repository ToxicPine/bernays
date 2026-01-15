// =============================================================================
// CLI Utilities — Barrel export for CLI script utilities
// =============================================================================
//
// This module provides utilities for non-TUI CLI scripts:
// - Logging with colors and spinners
// - Environment variable handling (.env files)
// - Shell command execution
//
// Usage:
//   import { createLogger, die, loadDotenv, runCommand } from "./lib/cli/mod.ts";
//
// =============================================================================

export {
  bold,
  // Colors
  colors,
  // Logging
  createLogger,
  cyan,
  die,
  dim,
  green,
  isTty,
  type Logger,
  magenta,
  red,
  Spinner,
  statusErr,
  statusOk,
  statusWarn,
  yellow,
} from "./log.ts";

export {
  getEnv,
  // Environment
  loadDotenv,
  requireEnv,
  writeDotenv,
} from "./env.ts";

export {
  commandExists,
  type CommandOptions,
  type CommandResult,
  fileExists,
  fileExistsSync,
  // Shell
  runCommand,
  runWithSpinner,
} from "./shell.ts";
