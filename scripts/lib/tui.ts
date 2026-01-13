// =============================================================================
// TUI Utilities — Terminal I/O helpers for CLI scripts
// =============================================================================
//
// Note: Display/layout functions have been removed in favor of Ink components.
// This module provides only low-level terminal I/O for non-Ink scripts.
// =============================================================================

// =============================================================================
// Text Encoding
// =============================================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// =============================================================================
// Terminal I/O
// =============================================================================

/**
 * Write string to stdout without newline.
 */
const write = (s: string): void => {
  Deno.stdout.writeSync(encoder.encode(s));
};

/**
 * Write line to stdout.
 */
const writeln = (s: string = ""): void => {
  write(s + "\n");
};

/**
 * Read a line of user input.
 */
const readLine = async (prompt: string): Promise<string> => {
  write(prompt);
  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return "";
  return decoder.decode(buf.subarray(0, n)).trim();
};

/**
 * Read a line of user input with hidden characters (for passwords/secrets).
 */
export const readSecret = async (prompt: string): Promise<string> => {
  write(prompt);
  try {
    await new Deno.Command("stty", { args: ["-echo"], stdin: "inherit" }).output();
    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);
    await new Deno.Command("stty", { args: ["echo"], stdin: "inherit" }).output();
    writeln();
    if (n === null) return "";
    return decoder.decode(buf.subarray(0, n)).trim();
  } catch {
    return readLine("");
  }
};

/**
 * Ask for yes/no confirmation.
 */
export const confirm = async (prompt: string): Promise<boolean> => {
  const answer = await readLine(`${prompt} [y/N] `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
};

/**
 * Clear the terminal screen.
 */
export const clearScreen = (): void => {
  write("\x1b[2J\x1b[H");
};
