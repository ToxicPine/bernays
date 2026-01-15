// =============================================================================
// Hooks — Reusable navigation and list management hooks for TUI scripts
// =============================================================================

import { useCallback, useMemo, useState } from "react";

// =============================================================================
// List Navigation
// =============================================================================

/**
 * Result of useListNavigation hook.
 */
export interface ListNavigationState<T> {
  /** Currently selected index */
  selectedIndex: number;
  /** Currently selected item (or undefined if list is empty) */
  selectedItem: T | undefined;
  /** Move selection up */
  up: () => void;
  /** Move selection down */
  down: () => void;
  /** Set selection to specific index */
  setIndex: (index: number) => void;
  /** Reset selection to 0 */
  reset: () => void;
}

/**
 * Hook for managing list navigation state.
 * Handles bounds checking and wrapping.
 *
 * @example
 * ```tsx
 * const { selectedIndex, selectedItem, up, down } = useListNavigation(items);
 * ```
 */
export const useListNavigation = <T,>(
  items: readonly T[],
  options?: { initialIndex?: number; wrap?: boolean },
): ListNavigationState<T> => {
  const { initialIndex = 0, wrap = false } = options ?? {};
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  const clampIndex = useCallback(
    (idx: number): number => {
      if (items.length === 0) return 0;
      if (wrap) {
        return ((idx % items.length) + items.length) % items.length;
      }
      return Math.max(0, Math.min(items.length - 1, idx));
    },
    [items.length, wrap],
  );

  const up = useCallback(() => {
    setSelectedIndex((i) => clampIndex(i - 1));
  }, [clampIndex]);

  const down = useCallback(() => {
    setSelectedIndex((i) => clampIndex(i + 1));
  }, [clampIndex]);

  const setIndex = useCallback(
    (index: number) => {
      setSelectedIndex(clampIndex(index));
    },
    [clampIndex],
  );

  const reset = useCallback(() => {
    setSelectedIndex(initialIndex);
  }, [initialIndex]);

  const selectedItem = items[selectedIndex];

  return {
    selectedIndex,
    selectedItem,
    up,
    down,
    setIndex,
    reset,
  };
};

// =============================================================================
// Pagination
// =============================================================================

/**
 * Result of usePagination hook.
 */
export interface PaginationState<T> {
  /** Current page (0-indexed) */
  page: number;
  /** Total number of pages */
  totalPages: number;
  /** Items on current page */
  pageItems: readonly T[];
  /** Start index of current page in original array */
  pageStartIndex: number;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
  /** Go to specific page */
  setPage: (page: number) => void;
  /** Reset to first page */
  reset: () => void;
  /** Whether there's a next page */
  hasNext: boolean;
  /** Whether there's a previous page */
  hasPrev: boolean;
}

/**
 * Hook for managing pagination state.
 *
 * @example
 * ```tsx
 * const { pageItems, page, totalPages, nextPage, prevPage } = usePagination(items, 10);
 * ```
 */
export const usePagination = <T,>(
  items: readonly T[],
  pageSize: number,
): PaginationState<T> => {
  const [page, setPageState] = useState(0);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  const clampPage = useCallback(
    (p: number): number => Math.max(0, Math.min(totalPages - 1, p)),
    [totalPages],
  );

  const pageItems = useMemo(() => {
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const pageStartIndex = page * pageSize;

  const nextPage = useCallback(() => {
    setPageState((p) => clampPage(p + 1));
  }, [clampPage]);

  const prevPage = useCallback(() => {
    setPageState((p) => clampPage(p - 1));
  }, [clampPage]);

  const setPage = useCallback(
    (p: number) => {
      setPageState(clampPage(p));
    },
    [clampPage],
  );

  const reset = useCallback(() => {
    setPageState(0);
  }, []);

  return {
    page,
    totalPages,
    pageItems,
    pageStartIndex,
    nextPage,
    prevPage,
    setPage,
    reset,
    hasNext: page < totalPages - 1,
    hasPrev: page > 0,
  };
};

// =============================================================================
// Combined List + Pagination
// =============================================================================

/**
 * Result of usePaginatedList hook.
 */
export interface PaginatedListState<T> {
  /** Currently selected index within current page */
  selectedIndex: number;
  /** Currently selected item */
  selectedItem: T | undefined;
  /** Absolute index in full list */
  absoluteIndex: number;
  /** Items on current page */
  pageItems: readonly T[];
  /** Current page (0-indexed) */
  page: number;
  /** Total pages */
  totalPages: number;
  /** Move selection up (wraps to prev page) */
  up: () => void;
  /** Move selection down (wraps to next page) */
  down: () => void;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
  /** Reset to first item on first page */
  reset: () => void;
}

/**
 * Hook that combines list navigation with pagination.
 * Moving past the end of a page advances to the next page.
 *
 * @example
 * ```tsx
 * const list = usePaginatedList(items, 10);
 * // Use list.up, list.down for navigation
 * // Use list.nextPage, list.prevPage for pagination
 * ```
 */
export const usePaginatedList = <T,>(
  items: readonly T[],
  pageSize: number,
): PaginatedListState<T> => {
  const [absoluteIndex, setAbsoluteIndex] = useState(0);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.floor(absoluteIndex / pageSize);

  const pageItems = useMemo(() => {
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const selectedIndex = absoluteIndex - page * pageSize;
  const selectedItem = items[absoluteIndex];

  const clampAbsolute = useCallback(
    (idx: number): number => Math.max(0, Math.min(items.length - 1, idx)),
    [items.length],
  );

  const up = useCallback(() => {
    setAbsoluteIndex((i) => clampAbsolute(i - 1));
  }, [clampAbsolute]);

  const down = useCallback(() => {
    setAbsoluteIndex((i) => clampAbsolute(i + 1));
  }, [clampAbsolute]);

  const nextPage = useCallback(() => {
    const newPage = Math.min(totalPages - 1, page + 1);
    setAbsoluteIndex(newPage * pageSize);
  }, [page, totalPages, pageSize]);

  const prevPage = useCallback(() => {
    const newPage = Math.max(0, page - 1);
    setAbsoluteIndex(newPage * pageSize);
  }, [page, pageSize]);

  const reset = useCallback(() => {
    setAbsoluteIndex(0);
  }, []);

  return {
    selectedIndex,
    selectedItem,
    absoluteIndex,
    pageItems,
    page,
    totalPages,
    up,
    down,
    nextPage,
    prevPage,
    reset,
  };
};
