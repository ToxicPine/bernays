// =============================================================================
// TUI Utilities — Common terminal UI helpers for interactive scripts
// =============================================================================

import { bold, dim } from "./log.ts";

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
export const write = (s: string): void => {
  Deno.stdout.writeSync(encoder.encode(s));
};

/**
 * Write line to stdout.
 */
export const writeln = (s: string = ""): void => {
  write(s + "\n");
};

/**
 * Read a line of user input.
 */
export const readLine = async (prompt: string): Promise<string> => {
  write(prompt);
  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return "";
  return decoder.decode(buf.subarray(0, n)).trim();
};

/**
 * Read a line of user input with hidden characters (for passwords).
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

/**
 * Wait for user to press Enter.
 */
export const waitForEnter = async (prompt: string = "Press Enter to continue..."): Promise<void> => {
  await readLine(dim(prompt));
};

// =============================================================================
// Display Helpers
// =============================================================================

/**
 * Draw a horizontal rule.
 */
export const hr = (width: number = 60, char: string = "\u2500"): string => {
  return char.repeat(width);
};

/**
 * Draw a box header with title.
 */
export const boxHeader = (title: string, width: number = 60): string => {
  const padded = ` ${title} `;
  const side = Math.floor((width - 2 - padded.length) / 2);
  const extra = (width - 2 - padded.length) % 2;
  return [
    bold("\u2554" + "\u2550".repeat(width - 2) + "\u2557"),
    bold("\u2551" + " ".repeat(side) + padded + " ".repeat(side + extra) + "\u2551"),
    bold("\u255A" + "\u2550".repeat(width - 2) + "\u255D"),
  ].join("\n");
};

// =============================================================================
// Text Alignment
// =============================================================================

/**
 * Pad string to width (left-aligned).
 */
export const padRight = (s: string, width: number): string => {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
};

/**
 * Pad string to width (right-aligned).
 */
export const padLeft = (s: string, width: number): string => {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
};

/**
 * Center string within width.
 */
export const center = (s: string, width: number): string => {
  if (s.length >= width) return s;
  const left = Math.floor((width - s.length) / 2);
  const right = width - s.length - left;
  return " ".repeat(left) + s + " ".repeat(right);
};

// =============================================================================
// Menu Rendering
// =============================================================================

export interface MenuItem {
  key: string;
  label: string;
  disabled?: boolean;
}

/**
 * Render menu options in a consistent format.
 */
export const renderMenu = (items: MenuItem[]): string => {
  return items
    .filter((item) => !item.disabled)
    .map((item) => `  ${bold(`[${item.key}]`)} ${item.label}`)
    .join("\n");
};
