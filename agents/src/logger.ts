// packages/commandline/src/logger.ts
// Effect-friendly logger + raw logger (for callbacks)

import { Effect } from "effect";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

export const tty = {
  success: (message: string, ...args: unknown[]) => {
    console.log(`${colors.green}[OK]${colors.reset}\t${message}`, ...args);
  },
  info: (message: string, ...args: unknown[]) => {
    console.log(`${colors.cyan}[INFO]${colors.reset}\t${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    console.log(`${colors.yellow}[WARN]${colors.reset}\t${message}`, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`${colors.red}[ERR]${colors.reset}\t${message}`, ...args);
  },
  event: (message: string, ...args: unknown[]) => {
    console.log(`${colors.magenta}[EVENT]${colors.reset}\t${message}`, ...args);
  },
  stats: (message: string, ...args: unknown[]) => {
    console.log(`${colors.blue}[STAT]${colors.reset}\t${message}`, ...args);
  },
};

export const logger = {
  success: (message: string, ...args: unknown[]) =>
    Effect.sync(() => tty.success(message, ...args)),
  info: (message: string, ...args: unknown[]) =>
    Effect.sync(() => tty.info(message, ...args)),
  warn: (message: string, ...args: unknown[]) =>
    Effect.sync(() => tty.warn(message, ...args)),
  error: (message: string, ...args: unknown[]) =>
    Effect.sync(() => tty.error(message, ...args)),
  event: (message: string, ...args: unknown[]) =>
    Effect.sync(() => tty.event(message, ...args)),
  stats: (message: string, ...args: unknown[]) =>
    Effect.sync(() => tty.stats(message, ...args)),
};
