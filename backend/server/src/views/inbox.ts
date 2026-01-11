// src/views/inbox.ts
// Base inbox view type for platform-specific extension

// ============================================================================
// Base Inbox View
// ============================================================================

/**
 * Base inbox view - extensible index over threads.
 * Generic over TThreadSummary to allow platform-specific index fields.
 *
 * Platforms extend this with platform-specific inbox metadata:
 * - LinkedIn: syncedAt, pendingInvitations, weeklyInvitesRemaining
 * - X: unreadDMs, etc.
 */
export interface BaseInboxView<TThreadSummary = Record<string, never>> {
  readonly byThreadId: Readonly<Record<string, TThreadSummary>>;
}
