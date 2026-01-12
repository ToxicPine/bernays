// =============================================================================
// Environment Utilities — Centralized .env file handling
// =============================================================================

import { existsSync } from "@std/fs";

// =============================================================================
// Load .env
// =============================================================================

/**
 * Load environment variables from a .env file.
 * Does not override existing environment variables.
 */
export const loadDotenv = (envPath: string = ".env"): void => {
  if (!existsSync(envPath)) return;

  const content = Deno.readTextFileSync(envPath);
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1);

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only set if not already defined
    if (Deno.env.get(key) === undefined) {
      Deno.env.set(key, value);
    }
  }
};

// =============================================================================
// Write .env
// =============================================================================

/**
 * Write or update a key-value pair in a .env file.
 * Creates the file if it doesn't exist.
 * Returns true if the file was modified.
 */
export const writeDotenv = (
  key: string,
  value: string,
  envPath: string = ".env",
): boolean => {
  if (!value) return false;

  let lines: string[] = [];

  if (existsSync(envPath)) {
    const content = Deno.readTextFileSync(envPath);
    lines = content.split("\n");

    // Check if key already exists with same value
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${key}=`)) {
        const existingValue = trimmed.slice(key.length + 1).replace(/^["']|["']$/g, "");
        if (existingValue === value) {
          return false; // No change needed
        }
      }
    }

    // Filter out existing key
    lines = lines.filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith(`${key}=`);
    });
  }

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  // Add the new key-value pair
  lines.push(`${key}=${value}`);

  Deno.writeTextFileSync(envPath, lines.join("\n") + "\n");
  return true;
};

// =============================================================================
// Get Required Env
// =============================================================================

/**
 * Get a required environment variable. Throws if not set.
 */
export const requireEnv = (key: string, errorMessage?: string): string => {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(errorMessage ?? `Environment variable ${key} is required`);
  }
  return value;
};

/**
 * Get an optional environment variable with a default value.
 */
export const getEnv = (key: string, defaultValue: string = ""): string => {
  return Deno.env.get(key) ?? defaultValue;
};
