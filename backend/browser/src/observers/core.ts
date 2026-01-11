// packages/browser/src/observers/core.ts

declare global {
  interface Window {
    __bridgeEvent: (message: BridgeMessage) => Promise<void>;
    __registerCommand: <TReq, TRes>(
      command: string,
      handler: (payload: TReq) => Promise<CommandResult<TRes>>,
    ) => void;
    __emitObservation: (type: string, payload: unknown) => void;
    __observerContext: ObserverContext;
  }
}

type BridgeMessage = {
  v: 1;
  type: "request" | "response" | "event";
  requestId?: string;
  correlationId?: string;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

// ============================================================================
// Observer Context
// ============================================================================

export interface ObserverContext {
  browserId: string;
  tabId: string;
}

// Initialize Observer Context (set by master when injecting)
window.__observerContext = {
  browserId: "unknown",
  tabId: "unknown",
};

// ============================================================================
// Proactive Event Emission
// ============================================================================

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
      browserId: window.__observerContext.browserId,
      tabId: window.__observerContext.tabId,
      timestamp: new Date().toISOString(),
      ...(payload as object),
    },
  };

  window.__bridgeEvent(event).catch((err) => {
    console.error("[observer] Failed to emit:", err);
  });
};

// ============================================================================
// Observer Commands (Nudge Pattern)
// ============================================================================

export interface AuthObserveParams {
  platform: string;
}

export interface AuthObserveResult {
  accountId: string;
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

// ============================================================================
// Context Setter Command
// ============================================================================

window.__registerCommand<ObserverContext, void>(
  "observe:setContext",
  async (params) => {
    window.__observerContext = params;
    return { ok: true, value: undefined };
  },
);

export {};
