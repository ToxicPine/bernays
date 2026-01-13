// src/views/browser.ts
// Base browser view types for platform-specific extension

import { z } from "@zod/zod";
import {
  type AccountId,
  BrowserConfigId,
  type BrowserConfigId as BrowserConfigIdType,
} from "$/core/branded.ts";

// Browser Binding

/**
 * Zod schema for BrowserBinding.
 * Use this to validate data coming from external sources (DB, JSON, etc.)
 */
export const BrowserBindingSchema = z.object({
  configId: z.string().transform((val): BrowserConfigIdType =>
    BrowserConfigId(val)
  ),
  metadata: z.record(z.string(), z.unknown()),
});

/**
 * Links an account to a browser configuration.
 * The metadata allows platforms to attach device-specific info
 * (e.g., { deviceType: "mobile" }, { geo: "us-west" }).
 */
export type BrowserBinding = z.infer<typeof BrowserBindingSchema>;

/**
 * Parse and validate an array of browser bindings.
 * Returns empty array if validation fails.
 */
export const parseBrowserBindings = (
  data: unknown,
): readonly BrowserBinding[] => {
  const result = z.array(BrowserBindingSchema).safeParse(data);
  return result.success ? result.data : [];
};

// Base Account

/**
 * Minimum account structure required by the platform service.
 * Each platform extends this with platform-specific fields.
 */
export interface BaseAccount {
  readonly id: AccountId;
  readonly browserBindings: readonly BrowserBinding[];
}

// Base Bound Browser

/**
 * Base browser view - extensible by platforms.
 * Represents a browser bound to an account with platform-derived status.
 *
 * Platforms extend this with platform-specific status fields:
 * - LinkedIn: authStatus, rateLimitedUntil, weeklyInvitesRemaining
 * - X: authStatus, suspended, etc.
 *
 * The behavior's `deriveBrowsers` function produces platform-specific
 * browser types from events.
 */
export interface BaseBoundBrowser {
  readonly configId: BrowserConfigId;
  readonly isRunning: boolean;
  readonly metadata: Record<string, unknown>;
}
