// =============================================================================
// TUI Utilities — Barrel export for Ink-based TUI utilities
// =============================================================================
//
// This module provides utilities for Ink-based TUI scripts:
// - Ink components (Header, StatusBar, FullHeightLayout, etc.)
// - React hooks for navigation and pagination
// - Keybinding system
// - Data filtering utilities
// - Low-level terminal I/O
//
// Usage:
//   import { Header, StatusBar, useListNavigation, createBindings } from "./lib/tui/mod.ts";
//
// =============================================================================

// Ink components and helpers
export {
  type AppError,
  ErrorBanner,
  formatTimestamp,
  FullHeightLayout,
  // Components
  Header,
  MenuItem,
  // Helpers
  relativeTime,
  requireDatabaseUrl,
  // App lifecycle
  runApp,
  runMain,
  scopeColor,
  StatusBar,
  // Types
  type TerminalSize,
  toAppError,
  truncate,
  useAsyncOperation,
  useContentHeight,
  // Hooks
  useTerminalSize,
} from "./ink.tsx";

// React hooks for navigation/pagination
export {
  type ListNavigationState,
  type PaginatedListState,
  type PaginationState,
  useListNavigation,
  usePaginatedList,
  usePagination,
} from "./hooks.tsx";

// Keybinding system
export {
  type BindingOptions,
  type BindingSet,
  combineHints,
  createBindings,
  detailBindings,
  formatHints,
  isValidNumberKey,
  type KeyBinding,
  listBindings,
  type NavigationActions,
  paginatedListBindings,
  parseNumberKey,
  useHints,
  useKeyHandler,
} from "./keybindings.tsx";

// Data filtering
export {
  and,
  byExactType,
  byScope,
  byType,
  not,
  or,
  paginate,
  sortByTimestampAsc,
  sortByTimestampDesc,
} from "./filters.ts";

// Low-level terminal I/O
export { clearScreen, confirm, readSecret } from "./terminal.ts";
