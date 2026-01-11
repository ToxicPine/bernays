// packages/master/src/logger.ts
// Unified logger for the master package

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

export const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`${colors.cyan}[INFO]${colors.reset}\t${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`${colors.yellow}[WARN]${colors.reset}\t${message}`, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`${colors.red}[ERR]${colors.reset}\t${message}`, ...args);
  },
  debug: (message: string, ...args: unknown[]) => {
    console.log(`${colors.blue}[DEBUG]${colors.reset}\t${message}`, ...args);
  },
};
