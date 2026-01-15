// =============================================================================
// Centralized Logging Utility
// =============================================================================

// =============================================================================
// Colors
// =============================================================================

export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
} as const;

// =============================================================================
// Text Formatting
// =============================================================================

export const bold = (s: string): string => `${colors.bold}${s}${colors.reset}`;
export const dim = (s: string): string => `${colors.dim}${s}${colors.reset}`;
export const red = (s: string): string => `${colors.red}${s}${colors.reset}`;
export const green = (s: string): string =>
  `${colors.green}${s}${colors.reset}`;
export const yellow = (s: string): string =>
  `${colors.yellow}${s}${colors.reset}`;
export const cyan = (s: string): string => `${colors.cyan}${s}${colors.reset}`;
export const magenta = (s: string): string =>
  `${colors.magenta}${s}${colors.reset}`;

// =============================================================================
// Logger Factory
// =============================================================================

export interface Logger {
  info: (msg: string) => void;
  ok: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  section: (msg: string) => void;
  dim: (msg: string) => void;
}

export const createLogger = (silent: boolean = false): Logger => ({
  info: (msg: string) => !silent && console.log(`${cyan("[INFO]")} ${msg}`),
  ok: (msg: string) => !silent && console.log(`${green("[OK]")} ${msg}`),
  warn: (msg: string) => !silent && console.log(`${yellow("[WARN]")} ${msg}`),
  error: (msg: string) => console.error(`${red("[ERR]")} ${msg}`),
  section: (msg: string) =>
    !silent && console.log(`\n${magenta("==>")} ${msg}`),
  dim: (msg: string) => !silent && console.log(dim(msg)),
});

// =============================================================================
// TTY Detection
// =============================================================================

export const isTty = (): boolean => Deno.stdout.isTerminal();

// =============================================================================
// Spinner
// =============================================================================

export class Spinner {
  private frames =
    "\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F";
  private intervalId?: number;
  private frameIndex = 0;

  start(label: string): void {
    if (!isTty()) return;
    this.stop();

    this.intervalId = setInterval(() => {
      const frame = this.frames[this.frameIndex % this.frames.length];
      Deno.stdout.writeSync(
        new TextEncoder().encode(
          `\r${colors.cyan}${frame}${colors.reset} ${label}\x1b[K`,
        ),
      );
      this.frameIndex++;
    }, 100);
  }

  stop(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      if (isTty()) {
        Deno.stdout.writeSync(new TextEncoder().encode("\r\x1b[K"));
      }
    }
  }
}

// =============================================================================
// Fatal Error
// =============================================================================

export const die = (message: string): never => {
  console.error(`${red("\u2717")} ${message}`);
  Deno.exit(1);
};

// =============================================================================
// Status Line Helpers (for deploy-style output)
// =============================================================================

export const statusOk = (msg: string): void =>
  console.log(`${green("\u2713")} ${msg}`);
export const statusWarn = (msg: string): void =>
  console.log(`${yellow("\u26A0")} ${msg}`);
export const statusErr = (msg: string): void =>
  console.error(`${red("\u2717")} ${msg}`);
