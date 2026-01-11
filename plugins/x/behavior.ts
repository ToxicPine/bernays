// src/platforms/x/behavior.ts
// X (Twitter) platform behavior

import { Effect } from "effect";
import { BrowserPool } from "@bernays/server/backend";
import {
  executeError,
  type PlatformBehavior,
} from "@bernays/server/platforms";
import {
  X_SCOPE,
  type XAnchor,
  type XEvent,
  type XIntent,
  type XScope,
} from "./schemas.ts";
import type { XInbox, XThread } from "./views.ts";
import type { XAuthStatus, XBrowser } from "./browser.ts";
import type { XAccount } from "./account.ts";

// ============================================================================
// X Behavior (stub implementation)
// ============================================================================

export const xBehavior: PlatformBehavior<
  XScope,
  XEvent,
  XIntent,
  XAnchor,
  XThread,
  XInbox,
  XAccount,
  XBrowser
> = {
  scope: X_SCOPE,

  deriveInbox: (_events, _accountId) => ({
    byThreadId: {},
    syncedAt: new Date().toISOString(),
  }),

  deriveThread: (_events, _threadId) => undefined,

  deriveBrowsers: (_events, account, runningConfigIds) =>
    account.browserBindings.map((binding) => ({
      configId: binding.configId,
      isRunning: runningConfigIds.has(binding.configId),
      metadata: binding.metadata,
      authStatus: "unknown" as XAuthStatus,
      suspended: false,
    })),

  execute: (_intent, browsers, preferConfigId) =>
    Effect.gen(function* () {
      yield* BrowserPool;

      const selected = preferConfigId
        ? browsers.find((b) => b.configId === preferConfigId && b.isRunning)
        : browsers.find((b) => b.isRunning);

      if (!selected) {
        return yield* Effect.fail(
          executeError("NoBrowserAvailable", "No running browser available"),
        );
      }

      // Stub: just return the config ID
      return { usedConfigId: selected.configId };
    }),
};
