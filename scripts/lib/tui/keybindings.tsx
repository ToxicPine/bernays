// =============================================================================
// Keybindings — Declarative keybinding system for TUI scripts
// =============================================================================

import { useCallback, useMemo } from "react";
import { type Key, useInput } from "ink";

// =============================================================================
// Types
// =============================================================================

/**
 * A single keybinding definition.
 */
export interface KeyBinding {
  /** Key to match (single character or special key name) */
  key: string;
  /** Human-readable label for status bar */
  label: string;
  /** Handler function */
  handler: () => void;
  /** Match special keys like return, escape, etc. */
  special?: keyof Key;
  /** Whether this binding is currently active */
  enabled?: boolean;
}

/**
 * Standard navigation actions for list views.
 */
export interface NavigationActions {
  onUp?: () => void;
  onDown?: () => void;
  onPageUp?: () => void;
  onPageDown?: () => void;
  onSelect?: () => void;
  onBack?: () => void;
  onQuit?: () => void;
  onRefresh?: () => void;
}

/**
 * Options for creating a binding set.
 */
export interface BindingOptions extends NavigationActions {
  /** Additional custom bindings */
  custom?: KeyBinding[];
  /** Whether navigation (j/k) is enabled */
  navigation?: boolean;
  /** Whether pagination (n/p) is enabled */
  pagination?: boolean;
}

/**
 * Result of createBindings - contains bindings array and hint string.
 */
export interface BindingSet {
  bindings: KeyBinding[];
  hints: string;
}

// =============================================================================
// Hint Formatting
// =============================================================================

/**
 * Format a single binding as a hint string.
 */
const formatBinding = (b: KeyBinding): string => {
  const key = b.special === "return" ? "Enter" : b.key;
  return `[${key}] ${b.label}`;
};

/**
 * Format an array of bindings as a space-separated hint string.
 */
export const formatHints = (bindings: KeyBinding[]): string =>
  bindings
    .filter((b) => b.enabled !== false)
    .map(formatBinding)
    .join("  ");

// =============================================================================
// Binding Builder
// =============================================================================

/**
 * Create a set of keybindings from options.
 * Generates both the binding array and the hint string for status bar.
 *
 * @example
 * ```tsx
 * const bindings = createBindings({
 *   navigation: true,
 *   pagination: true,
 *   onUp: () => setIdx(i => i - 1),
 *   onDown: () => setIdx(i => i + 1),
 *   onSelect: () => handleSelect(),
 *   onQuit: () => exit(),
 * });
 *
 * useKeyHandler(bindings);
 * <StatusBar>{bindings.hints}</StatusBar>
 * ```
 */
export const createBindings = (options: BindingOptions): BindingSet => {
  const bindings: KeyBinding[] = [];

  // Navigation bindings (j/k or arrow keys)
  if (options.navigation) {
    if (options.onDown) {
      bindings.push({
        key: "j",
        label: "down",
        handler: options.onDown,
        special: "downArrow",
      });
    }
    if (options.onUp) {
      bindings.push({
        key: "k",
        label: "up",
        handler: options.onUp,
        special: "upArrow",
      });
    }
  }

  // Pagination bindings
  if (options.pagination) {
    if (options.onPageDown) {
      bindings.push({
        key: "n",
        label: "next",
        handler: options.onPageDown,
      });
    }
    if (options.onPageUp) {
      bindings.push({
        key: "p",
        label: "prev",
        handler: options.onPageUp,
      });
    }
  }

  // Select (Enter)
  if (options.onSelect) {
    bindings.push({
      key: "Enter",
      label: "select",
      handler: options.onSelect,
      special: "return",
    });
  }

  // Back
  if (options.onBack) {
    bindings.push({
      key: "b",
      label: "back",
      handler: options.onBack,
    });
  }

  // Refresh
  if (options.onRefresh) {
    bindings.push({
      key: "r",
      label: "refresh",
      handler: options.onRefresh,
    });
  }

  // Quit
  if (options.onQuit) {
    bindings.push({
      key: "q",
      label: "quit",
      handler: options.onQuit,
    });
  }

  // Custom bindings
  if (options.custom) {
    bindings.push(...options.custom);
  }

  return {
    bindings,
    hints: formatHints(bindings),
  };
};

// =============================================================================
// Key Handler Hook
// =============================================================================

/**
 * Hook that applies a binding set to useInput.
 * Handles both character keys and special keys (arrows, enter, etc.).
 *
 * @example
 * ```tsx
 * const bindings = createBindings({ ... });
 * useKeyHandler(bindings);
 * ```
 */
export const useKeyHandler = (
  bindingSet: BindingSet,
  deps: readonly unknown[] = [],
): void => {
  const handler = useCallback(
    (input: string, key: Key) => {
      for (const binding of bindingSet.bindings) {
        if (binding.enabled === false) continue;

        // Check special key match
        if (binding.special && key[binding.special]) {
          binding.handler();
          return;
        }

        // Check character match
        if (input === binding.key) {
          binding.handler();
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bindingSet, ...deps],
  );

  useInput(handler);
};

// =============================================================================
// Preset Binding Sets
// =============================================================================

/**
 * Create bindings for a simple list view with navigation and quit.
 */
export const listBindings = (
  onUp: () => void,
  onDown: () => void,
  onSelect: () => void,
  onQuit: () => void,
  options?: { onBack?: () => void; onRefresh?: () => void },
): BindingSet =>
  createBindings({
    navigation: true,
    onUp,
    onDown,
    onSelect,
    onQuit,
    ...options,
  });

/**
 * Create bindings for a paginated list view.
 */
export const paginatedListBindings = (
  onUp: () => void,
  onDown: () => void,
  onPageUp: () => void,
  onPageDown: () => void,
  onSelect: () => void,
  onQuit: () => void,
  options?: { onBack?: () => void; onRefresh?: () => void },
): BindingSet =>
  createBindings({
    navigation: true,
    pagination: true,
    onUp,
    onDown,
    onPageUp,
    onPageDown,
    onSelect,
    onQuit,
    ...options,
  });

/**
 * Create bindings for a detail view with just back and quit.
 */
export const detailBindings = (
  onBack: () => void,
  onQuit: () => void,
  custom?: KeyBinding[],
): BindingSet =>
  createBindings({
    onBack,
    onQuit,
    custom,
  });

// =============================================================================
// Hint Utilities
// =============================================================================

/**
 * Create a memoized hint string from bindings.
 * Useful when you need to customize hints beyond standard formatting.
 */
export const useHints = (bindings: KeyBinding[]): string =>
  useMemo(() => formatHints(bindings), [bindings]);

/**
 * Combine multiple hint strings with separator.
 */
export const combineHints = (...hints: (string | undefined | null)[]): string =>
  hints.filter(Boolean).join("  ");

// =============================================================================
// Number Key Utilities
// =============================================================================

/**
 * Parse number key input (1-9) to index (0-8).
 * Returns -1 if not a valid number key.
 */
export const parseNumberKey = (input: string): number => {
  const num = parseInt(input, 10);
  if (num >= 1 && num <= 9) {
    return num - 1;
  }
  return -1;
};

/**
 * Check if input is a valid number key for selecting from a list.
 */
export const isValidNumberKey = (input: string, itemCount: number): boolean => {
  const idx = parseNumberKey(input);
  return idx >= 0 && idx < itemCount;
};
