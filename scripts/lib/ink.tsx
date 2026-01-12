// =============================================================================
// Ink Components — Shared React components for TUI scripts
// =============================================================================

import { type FC, type ReactNode } from "react";
import { render, Box, Text } from "ink";
import { clearScreen } from "./tui.ts";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a timestamp as relative time (e.g., "5m ago", "2h ago").
 */
export const relativeTime = (ts: string): string => {
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return "";
  }
};

/**
 * Format a timestamp for display.
 */
export const formatTimestamp = (ts: string): string => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
};

/**
 * Truncate string to max length with ellipsis.
 */
export const truncate = (s: string, maxLen: number): string =>
  s.length <= maxLen ? s : s.slice(0, maxLen - 1) + "...";

/**
 * Get color for a scope.
 */
export const scopeColor = (scope: string): string => {
  switch (scope) {
    case "linkedin": return "cyan";
    case "x": return "magenta";
    case "journal": return "yellow";
    default: return "white";
  }
};

// =============================================================================
// Components
// =============================================================================

/**
 * Standard header with title in a double-bordered box.
 */
export const Header: FC<{ title: string }> = ({ title }) => (
  <Box marginBottom={1}>
    <Box borderStyle="double" paddingX={2}>
      <Text bold color="cyan">{title}</Text>
    </Box>
  </Box>
);

/**
 * Standard status bar at bottom of screen.
 */
export const StatusBar: FC<{ children: ReactNode }> = ({ children }) => (
  <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
    <Text dimColor>{children}</Text>
  </Box>
);

/**
 * Standard menu item with index number.
 */
export const MenuItem: FC<{
  idx: number;
  label: string;
  selected: boolean;
  color?: string;
}> = ({ idx, label, selected, color }) => (
  <Box>
    <Text color={selected ? "green" : "white"}>
      {selected ? "> " : "  "}
      <Text bold>[{idx + 1}]</Text>{" "}
      <Text color={color}>{label}</Text>
    </Text>
  </Box>
);

/**
 * Loading indicator.
 */
export const Loading: FC<{ message?: string }> = ({ message = "Loading..." }) => (
  <Box>
    <Text color="cyan">{message}</Text>
  </Box>
);

/**
 * Empty state message.
 */
export const Empty: FC<{ message?: string }> = ({ message = "No items found." }) => (
  <Text dimColor>{message}</Text>
);

// =============================================================================
// App Runner
// =============================================================================

/**
 * Render an Ink app with screen clearing.
 */
export const renderApp = (element: ReactNode): void => {
  clearScreen();
  render(element);
};

/**
 * Get database URL from environment or exit with error.
 */
export const requireDatabaseUrl = (): string => {
  const url = Deno.env.get("DATABASE_URL");
  if (!url) {
    console.error("DATABASE_URL is not set.");
    Deno.exit(1);
  }
  return url;
};

/**
 * Run main function with standard error handling.
 */
export const runMain = (main: () => Promise<void>): void => {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  });
};
