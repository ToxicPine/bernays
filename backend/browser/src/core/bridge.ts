// packages/browser/src/core/bridge.ts
// Browser-side bridge - compiled to pure JS for injection

interface ObserverContext {
  configId: string;
  tabId: string;
}

declare global {
  interface Window {
    __bridgeEvent: (message: BridgeMessage) => Promise<void>;
    __bridgeHandler: (command: string, request: BridgeMessage) => Promise<void>;
    __bridgeEmit: (eventType: string, payload: unknown) => Promise<void>;
    __registerCommand: <TReq, TRes>(
      command: string,
      handler: CommandHandler<TReq, TRes>,
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

type CommandHandler<TReq = unknown, TRes = unknown> = (
  payload: TReq,
) => Promise<CommandResult<TRes>>;

// deno-lint-ignore no-explicit-any
const commandHandlers = new Map<string, CommandHandler<any, any>>();

window.__registerCommand = <TReq, TRes>(
  command: string,
  handler: CommandHandler<TReq, TRes>,
): void => {
  commandHandlers.set(command, handler);
};

window.__bridgeHandler = async (
  command: string,
  request: BridgeMessage,
): Promise<void> => {
  const handler = commandHandlers.get(command);

  if (!handler) {
    const response: BridgeMessage = {
      v: 1,
      type: "response",
      requestId: request.requestId,
      error: {
        code: "Unknown",
        message: `Unknown Command: ${command}`,
      },
    };
    await window.__bridgeEvent(response);
    return;
  }

  try {
    const result = await handler(request.payload);

    if (result.ok) {
      const response: BridgeMessage = {
        v: 1,
        type: "response",
        requestId: request.requestId,
        payload: result.value,
      };
      await window.__bridgeEvent(response);
    } else {
      const response: BridgeMessage = {
        v: 1,
        type: "response",
        requestId: request.requestId,
        error: result.error,
      };
      await window.__bridgeEvent(response);
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const response: BridgeMessage = {
      v: 1,
      type: "response",
      requestId: request.requestId,
      error: {
        code: "Unknown",
        message: error.message,
        details: error,
      },
    };
    await window.__bridgeEvent(response);
  }
};

window.__bridgeEmit = async (
  eventType: string,
  payload: unknown,
): Promise<void> => {
  const event: BridgeMessage = {
    v: 1,
    type: "event",
    correlationId: crypto.randomUUID(),
    payload: { eventType, ...(payload as object) },
  };
  await window.__bridgeEvent(event);
};

// Observer Context and Emission

window.__observerContext = {
  configId: "unknown",
  tabId: "unknown",
};

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
    console.error("[bridge] Failed to Emit Bridge Observation:", err);
  });
};

window.__registerCommand<ObserverContext, void>(
  "observe:setContext",
  async (params) => {
    window.__observerContext = params;
    return { ok: true, value: undefined };
  },
);

// Test Command

interface TestEchoParams {
  echoId: string;
}

/**
 * Test command for e2e verification of bidirectional communication.
 * Emits a TestEcho event with the same echoId that was sent in.
 */
window.__registerCommand<TestEchoParams, void>(
  "test:echo",
  async (params) => {
    window.__emitObservation("TestEcho", {
      scope: "test",
      echoId: params.echoId,
    });
    return { ok: true, value: undefined };
  },
);

export {};
