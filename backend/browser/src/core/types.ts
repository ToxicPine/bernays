// packages/browser/src/core/types.ts

// Observer Context

export interface ObserverContext {
  configId: string;
  tabId: string;
}

// Bridge Message Types

export type BridgeMessage = {
  v: 1;
  type: "request" | "response" | "event";
  requestId?: string;
  correlationId?: string;
  payload?: unknown;
  error?: BridgeError;
};

export interface BridgeError {
  code: string;
  message: string;
  details?: unknown;
}

// Command Types

export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BridgeError };

export type CommandHandler<TReq = unknown, TRes = unknown> = (
  payload: TReq,
) => Promise<CommandResult<TRes>>;

// Error Handling Utility

export const wrapCommandError = (err: unknown): CommandResult<never> => {
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    ok: false,
    error: { code: "Unknown", message: error.message },
  };
};

// Window Globals Declaration

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
