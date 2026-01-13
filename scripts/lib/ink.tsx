// =============================================================================
// Ink Components — Shared React components for TUI scripts
// =============================================================================

import { type FC, type ReactNode, useState, useEffect, useCallback } from "react";
import { render, Box, Text, useStdout } from "ink";
import { clearScreen } from "./tui.ts";

// =============================================================================
// Terminal Size Hook
// =============================================================================

export interface TerminalSize {
  rows: number;
  columns: number;
}

/**
 * Hook to get dynamic terminal dimensions.
 * Automatically updates when the terminal is resized.
 */
export const useTerminalSize = (): TerminalSize => {
  const { stdout } = useStdout();

  const getSize = useCallback((): TerminalSize => ({
    rows: stdout.rows || 24,
    columns: stdout.columns || 80,
  }), [stdout]);

  const [size, setSize] = useState<TerminalSize>(getSize);

  useEffect(() => {
    const handleResize = () => {
      setSize(getSize());
    };

    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout, getSize]);

  return size;
};

/**
 * Calculate available content height, accounting for UI chrome.
 * @param chromeLines - Number of lines used by headers, footers, status bars, etc.
 */
export const useContentHeight = (chromeLines: number): number => {
  const { rows } = useTerminalSize();
  return Math.max(3, rows - chromeLines);
};

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
// Error Handling
// =============================================================================

/**
 * Unified error representation for TUI display.
 */
export interface AppError {
  title: string;
  message: string;
  details?: string;
  recoverable: boolean;
}

/**
 * Convert various error types to AppError.
 */
export const toAppError = (e: unknown, title: string): AppError => {
  // Handle Effect-style errors with _tag
  if (e && typeof e === "object" && "_tag" in e) {
    const tagged = e as { _tag: string; message?: string; code?: string; cause?: unknown };
    return {
      title,
      message: tagged.message || tagged.code || tagged._tag,
      details: tagged.cause ? String(tagged.cause) : undefined,
      recoverable: true,
    };
  }

  // Handle Result-style errors with code/message
  if (e && typeof e === "object" && "code" in e) {
    const coded = e as { code: string; message?: string; cause?: unknown };
    return {
      title,
      message: coded.message || coded.code,
      details: coded.cause ? String(coded.cause) : undefined,
      recoverable: coded.code !== "NotFound",
    };
  }

  // Handle standard Error
  if (e instanceof Error) {
    return {
      title,
      message: e.message,
      details: e.stack,
      recoverable: true,
    };
  }

  // Handle AppError passthrough
  if (e && typeof e === "object" && "title" in e && "message" in e && "recoverable" in e) {
    return e as AppError;
  }

  // Fallback for strings or unknown
  return {
    title,
    message: String(e),
    recoverable: true,
  };
};

/**
 * Async operation state returned by useAsyncOperation.
 */
export interface AsyncOperationState<T> {
  data: T | null;
  error: AppError | null;
  loading: boolean;
  run: (fn: () => Promise<T>, errorTitle?: string) => Promise<void>;
  setError: (error: AppError | null) => void;
  clearError: () => void;
  reset: () => void;
}

/**
 * Hook to manage async operation state with error handling.
 */
export const useAsyncOperation = <T,>(initialData: T | null = null): AsyncOperationState<T> => {
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (fn: () => Promise<T>, errorTitle = "Operation Failed") => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      setData(result);
    } catch (e) {
      setError(toAppError(e, errorTitle));
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const reset = useCallback(() => {
    setData(initialData);
    setError(null);
    setLoading(false);
  }, [initialData]);

  return { data, error, loading, run, setError, clearError, reset };
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
 * Error banner for displaying errors in the TUI.
 * Shows a red-bordered box with error details and optional dismiss hint.
 */
export const ErrorBanner: FC<{
  error: AppError;
  onDismiss?: () => void;
}> = ({ error, onDismiss }) => (
  <Box
    flexDirection="column"
    borderStyle="single"
    borderColor="red"
    paddingX={1}
    marginBottom={1}
  >
    <Text bold color="red">{error.title}</Text>
    <Text color="red">{error.message}</Text>
    {error.details && (
      <Text dimColor>{truncate(error.details, 80)}</Text>
    )}
    {onDismiss && error.recoverable && (
      <Text dimColor italic>Press any key to dismiss</Text>
    )}
  </Box>
);

/**
 * Standard status bar at bottom of screen.
 */
export const StatusBar: FC<{ children: ReactNode }> = ({ children }) => (
  <Box borderStyle="single" borderColor="gray" paddingX={1}>
    <Text dimColor>{children}</Text>
  </Box>
);

/**
 * Full-height layout that pins the status bar at the bottom of the terminal.
 * Uses flexbox to ensure the nav hints are always at the bottom regardless of content height.
 */
export const FullHeightLayout: FC<{
  header: ReactNode;
  statusBar: ReactNode;
  children: ReactNode;
}> = ({ header, statusBar, children }) => {
  const { rows } = useTerminalSize();
  return (
    <Box flexDirection="column" height={rows}>
      {header}
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
      {statusBar}
    </Box>
  );
};

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
 * Returns the Ink instance for lifecycle management.
 */
export const renderApp = (element: ReactNode) => {
  clearScreen();
  return render(element);
};

/**
 * Run an Ink app with proper exit code handling and signal support.
 * - Exits with 0 on normal exit
 * - Exits with 1 if exit(error) was called
 * - Handles Ctrl+C (SIGINT) gracefully with exit code 130
 */
export const runApp = async (element: ReactNode): Promise<never> => {
  clearScreen();
  const instance = render(element);

  // Handle Ctrl+C gracefully
  const handleSignal = () => {
    instance.unmount();
    // Clear any partial render and show cursor
    Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25h\n"));
    Deno.exit(130); // 128 + SIGINT(2) = 130, conventional exit code
  };

  Deno.addSignalListener("SIGINT", handleSignal);
  Deno.addSignalListener("SIGTERM", handleSignal);

  try {
    await instance.waitUntilExit();
    Deno.exit(0);
  } catch (error) {
    // exit(error) was called - this is a fatal error
    if (error instanceof Error) {
      console.error(error.message);
    }
    Deno.exit(1);
  }
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
