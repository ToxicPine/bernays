// =============================================================================
// Filters — Composable filter and transform utilities for event data
// =============================================================================

// =============================================================================
// Filter Combinators
// =============================================================================

/**
 * Compose multiple predicates with AND logic.
 * Returns a predicate that returns true only if all predicates return true.
 */
export const and =
  <T>(...predicates: ((item: T) => boolean)[]) =>
  (item: T): boolean =>
    predicates.every((p) => p(item));

/**
 * Compose multiple predicates with OR logic.
 * Returns a predicate that returns true if any predicate returns true.
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
// Common Predicates
// =============================================================================

/**
 * Create a predicate that matches items by scope.
 */
export const byScope =
  <T extends { scope: string }>(scope: string) =>
  (item: T): boolean =>
    item.scope === scope;

/**
 * Create a predicate that matches items by type (case-insensitive contains).
 */
export const byType =
  <T extends { type: string }>(typePattern: string) =>
  (item: T): boolean =>
    item.type.toLowerCase().includes(typePattern.toLowerCase());

/**
 * Create a predicate that matches items by exact type.
 */
export const byExactType =
  <T extends { type: string }>(type: string) =>
  (item: T): boolean =>
    item.type === type;

/**
 * Create a predicate that matches items since a timestamp.
 */
export const since =
  <T extends { timestamp: string }>(ts: string | Date) =>
  (item: T): boolean => {
    const threshold = typeof ts === "string" ? new Date(ts) : ts;
    return new Date(item.timestamp) >= threshold;
  };

/**
 * Create a predicate that matches items before a timestamp.
 */
export const before =
  <T extends { timestamp: string }>(ts: string | Date) =>
  (item: T): boolean => {
    const threshold = typeof ts === "string" ? new Date(ts) : ts;
    return new Date(item.timestamp) < threshold;
  };

/**
 * Create a predicate that matches items within a time range.
 */
export const inTimeRange =
  <T extends { timestamp: string }>(start: string | Date, end: string | Date) =>
  (item: T): boolean =>
    and(since<T>(start), before<T>(end))(item);

/**
 * Create a predicate that matches items by id.
 */
export const byId =
  <T extends { id: string }>(id: string) =>
  (item: T): boolean =>
    item.id === id;

/**
 * Create a predicate that matches items containing text in a field.
 */
export const containsText =
  <T>(getter: (item: T) => string, text: string, caseSensitive = false) =>
  (item: T): boolean => {
    const value = getter(item);
    if (caseSensitive) {
      return value.includes(text);
    }
    return value.toLowerCase().includes(text.toLowerCase());
  };

// =============================================================================
// Array Operations
// =============================================================================

/**
 * Apply multiple filters to an array.
 * Filters are applied in sequence (AND logic).
 */
export const applyFilters = <T>(
  items: readonly T[],
  ...predicates: ((item: T) => boolean)[]
): T[] => items.filter(and(...predicates));

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

/**
 * Group items by a key function.
 */
export const groupBy = <T, K extends string | number>(
  items: readonly T[],
  keyFn: (item: T) => K
): Record<K, T[]> => {
  const result = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
};

/**
 * Count items matching a predicate.
 */
export const countMatching = <T>(
  items: readonly T[],
  predicate: (item: T) => boolean
): number => items.filter(predicate).length;

/**
 * Take first N items.
 */
export const take = <T>(items: readonly T[], n: number): T[] => items.slice(0, n);

/**
 * Skip first N items.
 */
export const skip = <T>(items: readonly T[], n: number): T[] => items.slice(n);

/**
 * Get unique items by a key function.
 */
export const uniqueBy = <T, K>(items: readonly T[], keyFn: (item: T) => K): T[] => {
  const seen = new Set<K>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
};

// =============================================================================
// Pipeline Helper
// =============================================================================

/**
 * Create a pipeline of transformations.
 * Each function takes the result of the previous.
 *
 * @example
 * ```ts
 * const processEvents = pipe(
 *   (events: Event[]) => events.filter(byScope('linkedin')),
 *   sortByTimestampDesc,
 *   (events) => take(events, 100),
 * );
 * const result = processEvents(allEvents);
 * ```
 */
export function pipe<A, B>(fn1: (a: A) => B): (a: A) => B;
export function pipe<A, B, C>(fn1: (a: A) => B, fn2: (b: B) => C): (a: A) => C;
export function pipe<A, B, C, D>(
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D
): (a: A) => D;
export function pipe<A, B, C, D, E>(
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E
): (a: A) => E;
export function pipe<A, B, C, D, E, F>(
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E,
  fn5: (e: E) => F
): (a: A) => F;
export function pipe(
  // deno-lint-ignore no-explicit-any
  ...fns: ((arg: any) => any)[]
  // deno-lint-ignore no-explicit-any
): (arg: any) => any {
  return (arg) => fns.reduce((acc, fn) => fn(acc), arg);
}
