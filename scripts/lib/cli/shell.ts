// =============================================================================
// Shell Utilities — Centralized command execution helpers
// =============================================================================

import { Spinner, statusErr, statusOk } from "./log.ts";

// =============================================================================
// Types
// =============================================================================

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  success: boolean;
}

export interface CommandOptions
  extends Omit<Deno.CommandOptions, "stdout" | "stderr"> {
  /** Capture output (default: true) */
  capture?: boolean;
}

// =============================================================================
// Command Execution
// =============================================================================

/**
 * Run a command and capture its output.
 */
export const runCommand = async (
  command: string[],
  options?: CommandOptions,
): Promise<CommandResult> => {
  const { capture = true, ...denoOptions } = options ?? {};

  const proc = new Deno.Command(command[0], {
    args: command.slice(1),
    stdout: capture ? "piped" : "inherit",
    stderr: capture ? "piped" : "inherit",
    ...denoOptions,
  });

  const { code, stdout, stderr } = await proc.output();
  const decoder = new TextDecoder();

  return {
    code,
    stdout: capture ? decoder.decode(stdout) : "",
    stderr: capture ? decoder.decode(stderr) : "",
    success: code === 0,
  };
};

/**
 * Run a command with a spinner, showing success/failure status.
 */
export const runWithSpinner = async (
  label: string,
  command: string[],
  options?: CommandOptions,
): Promise<CommandResult> => {
  const spinner = new Spinner();
  spinner.start(label);

  try {
    const result = await runCommand(command, options);
    spinner.stop();

    if (result.success) {
      statusOk(label);
    } else {
      if (result.stdout || result.stderr) {
        console.error(result.stdout + result.stderr);
      }
      statusErr(label);
    }

    return result;
  } catch (error) {
    spinner.stop();
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    statusErr(label);
    return {
      code: 1,
      stdout: "",
      stderr: message,
      success: false,
    };
  }
};

// =============================================================================
// File System Helpers
// =============================================================================

/**
 * Check if a command exists in PATH.
 */
export const commandExists = async (cmd: string): Promise<boolean> => {
  try {
    const proc = new Deno.Command("which", {
      args: [cmd],
      stdout: "null",
      stderr: "null",
    });
    const { code } = await proc.output();
    return code === 0;
  } catch {
    return false;
  }
};

/**
 * Check if a file or directory exists.
 */
export const fileExists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Synchronous version of fileExists.
 */
export const fileExistsSync = (path: string): boolean => {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
};
