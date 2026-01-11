// src/bridge/master.ts
// MasterBridge implementation for Playwright communication
import type { Page } from "playwright";
import {
  type BridgeError,
  type BridgeEvent,
  BridgeMessageSchema,
  type BridgeRequest,
} from "./messages.ts";
import type { Result } from "$/core/result.ts";
import { Err, Ok } from "$/core/result.ts";
import { logger } from "$/logger.ts";

// ============================================================================
// Types
// ============================================================================

export type BridgeEventHandler = (event: BridgeEvent) => void;

export interface MasterBridge {
  readonly sendRequest: <TReq>(
    command: string,
    payload: TReq,
    timeoutMs?: number,
  ) => Promise<Result<unknown, BridgeError>>;

  readonly onEvent: (handler: BridgeEventHandler) => void;

  readonly offEvent: (handler: BridgeEventHandler) => void;

  readonly close: () => Promise<void>;
}

interface PendingRequest {
  readonly resolve: (result: Result<unknown, BridgeError>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

// ============================================================================
// Implementation
// ============================================================================

export const createMasterBridge = async (page: Page): Promise<MasterBridge> => {
  const pendingRequests = new Map<string, PendingRequest>();
  const eventHandlers = new Set<BridgeEventHandler>();

  await page.exposeFunction("__bridgeEvent", (message: unknown) => {
    const parseResult = BridgeMessageSchema.safeParse(message);
    if (!parseResult.success) {
      logger.error("Invalid Bridge Message:", parseResult.error);
      return;
    }

    const msg = parseResult.data;

    if (msg.type === "response" && msg.requestId) {
      const pending = pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(msg.requestId);

        if (msg.error) {
          pending.resolve(Err(msg.error));
        } else {
          pending.resolve(Ok(msg.payload));
        }
      }
    } else if (msg.type === "event") {
      // Dispatch to All Event Handlers
      const event: BridgeEvent = {
        v: 1,
        type: "event",
        correlationId: msg.correlationId ?? crypto.randomUUID(),
        payload: msg.payload,
      };
      for (const handler of eventHandlers) {
        try {
          handler(event);
        } catch {
          // Ignore handler errors
        }
      }
    }
  });

  const sendRequest = async <TReq>(
    command: string,
    payload: TReq,
    timeoutMs = 30000,
  ): Promise<Result<unknown, BridgeError>> => {
    const requestId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();

    const request: BridgeRequest<TReq> = {
      v: 1,
      type: "request",
      requestId,
      correlationId,
      payload,
    };

    return new Promise<Result<unknown, BridgeError>>((resolve) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        resolve(
          Err({
            code: "Timeout" as const,
            message: `Request ${command} timed out after ${timeoutMs}ms`,
          }),
        );
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, timer });

      page
        .evaluate(
          (args: { cmd: string; req: unknown }) => {
            // @ts-expect-error - __bridgeHandler is injected by browser extension
            // deno-lint-ignore no-undef
            return window.__bridgeHandler(args.cmd, args.req);
          },
          { cmd: command, req: request satisfies BridgeRequest<TReq> },
        )
        .catch((error: Error) => {
          clearTimeout(timer);
          pendingRequests.delete(requestId);
          resolve(
            Err({
              code: "Unknown" as const,
              message: `Bridge call failed: ${error.message}`,
              details: error,
            }),
          );
        });
    });
  };

  const onEvent = (handler: BridgeEventHandler): void => {
    eventHandlers.add(handler);
  };

  const offEvent = (handler: BridgeEventHandler): void => {
    eventHandlers.delete(handler);
  };

  const close = async () => {
    for (const [_requestId, pending] of pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(
        Err({
          code: "Unknown" as const,
          message: "Bridge closed",
        }),
      );
    }
    pendingRequests.clear();
    eventHandlers.clear();
  };

  return { sendRequest, onEvent, offEvent, close };
};
