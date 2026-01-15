// packages/browser/src/observers/core.ts

import type { BridgeMessage, ObserverContext } from "../core/types.ts";

// Initialize Observer Context (set by master when injecting)
window.__observerContext = {
  configId: "unknown",
  tabId: "unknown",
};

// Proactive Event Emission

/**
 * Emit an observation event proactively.
 * Browser code can call this whenever it detects something noteworthy.
 */
window.__emitObservation = (type: string, payload: unknown): void => {
  const event: BridgeMessage = {
    v: 1,
    type: "event",
    correlationId: crypto.randomUUID(),
    payload: {
      type,
      configId: window.__observerContext.configId,
      tabId: window.__observerContext.tabId,
      timestamp: new Date().toISOString(),
      ...(payload as object),
    },
  };

  window.__bridgeEvent(event).catch((err) => {
    console.error("[observer] Failed to emit:", err);
  });
};

// Observer Commands (Nudge Pattern)

export interface AuthObserveParams {
  platform: string;
}

export interface AuthObserveResult {
  participantId: string;
  canRead: boolean;
  canWrite: boolean;
  issue?: string;
}

export interface MessagesObserveParams {
  platform: string;
  since?: string;
}

export interface MessagesObserveResult {
  messageCount: number;
}

// Register Placeholder Commands - Platform-specific Files Will Override
window.__registerCommand<AuthObserveParams, AuthObserveResult>(
  "observe:auth",
  async (params) => {
    return {
      ok: false,
      error: {
        code: "Unknown",
        message: `No observer registered for platform: ${params.platform}`,
      },
    };
  },
);

window.__registerCommand<MessagesObserveParams, MessagesObserveResult>(
  "observe:messages",
  async (params) => {
    return {
      ok: false,
      error: {
        code: "Unknown",
        message: `No observer registered for platform: ${params.platform}`,
      },
    };
  },
);

// Context Setter Command

window.__registerCommand<ObserverContext, void>(
  "observe:setContext",
  async (params) => {
    window.__observerContext = params;
    return { ok: true, value: undefined };
  },
);

export {};
