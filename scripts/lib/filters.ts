// =============================================================================
// Filters — Composable predicates for filtering event data
// =============================================================================

// =============================================================================
// Combinators
// =============================================================================

/**
 * Compose multiple predicates with AND logic.
 */
export const and =
  <T>(...predicates: ((item: T) => boolean)[]) =>
  (item: T): boolean =>
    predicates.every((p) => p(item));

/**
 * Compose multiple predicates with OR logic.
 */
export const or =
  <T>(...predicates: ((item: T) => boolean)[]) =>
  (item: T): boolean =>
    predicates.some((p) => p(item));

/**
 * Negate a predicate.
 */
export const not =
  <T>(predicate: (item: T) => boolean) =>
  (item: T): boolean =>
    !predicate(item);

// =============================================================================
// Predicates
// =============================================================================

/**
 * Match items by scope.
 */
export const byScope =
  <T extends { scope: string }>(scope: string) =>
  (item: T): boolean =>
    item.scope === scope;

/**
 * Match items by type (case-insensitive contains).
 */
export const byType =
  <T extends { type: string }>(typePattern: string) =>
  (item: T): boolean =>
    item.type.toLowerCase().includes(typePattern.toLowerCase());

/**
 * Match items by exact type.
 */
export const byExactType =
  <T extends { type: string }>(type: string) =>
  (item: T): boolean =>
    item.type === type;

// =============================================================================
// Sorting
// =============================================================================

/**
 * Sort by timestamp descending (newest first).
 */
export const sortByTimestampDesc = <T extends { timestamp: string }>(
  items: readonly T[]
): T[] =>
  [...items].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

/**
 * Sort by timestamp ascending (oldest first).
 */
export const sortByTimestampAsc = <T extends { timestamp: string }>(
  items: readonly T[]
): T[] =>
  [...items].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

// =============================================================================
// Pagination
// =============================================================================

/**
 * Get a page slice from an array.
 */
export const paginate = <T>(
  items: readonly T[],
  page: number,
  pageSize: number
): T[] => {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
};
