// src/backend/browserbase/pool.ts
// Browserbase pool implementation

import { Effect, Queue, Stream } from "effect";
import {
  type Browser as PlaywrightBrowser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";
import Browserbase from "@browserbasehq/sdk";
import type { BrowserConfigId as BrowserConfigIdType } from "$/core/branded.ts";
import type { Result } from "$/core/result.ts";
import { Err, Ok } from "$/core/result.ts";
import type { ConfigStoreService } from "$/store/config-store.ts";
import {
  type BridgeError,
  BridgeMessageSchema,
  type BrowserError,
  browserError,
  type BrowserPoolService,
  type TaggedBridgeEvent,
} from "../mod.ts";
import { logger } from "$/logger.ts";
import { retry, type RetryOptions } from "@std/async";

// Internal Types

interface BrowserInstance {
  readonly configId: BrowserConfigIdType;
  readonly browser: PlaywrightBrowser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly contextId: string;
  readonly projectId: string;
  readonly extensionId?: string;
  readonly cleanup: () => void;
}

type BridgeEventHandler = (event: unknown) => void;

// Bridge Setup

const setupBridge = async (
  page: Page,
  configId: BrowserConfigIdType,
  eventQueue: Queue.Enqueue<TaggedBridgeEvent>,
): Promise<
  {
    cleanup: () => void;
    sendRequest: (
      cmd: string,
      payload: unknown,
    ) => Promise<Result<unknown, BridgeError>>;
  }
> => {
  const pendingRequests = new Map<
    string,
    {
      resolve: (result: Result<unknown, BridgeError>) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const handler: BridgeEventHandler = (message: unknown) => {
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
      // Parse the payload as a bridge event (scope + type)
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (
        payload && typeof payload.scope === "string" &&
        typeof payload.type === "string"
      ) {
        Queue.unsafeOffer(eventQueue, {
          configId,
          event: payload as {
            scope: string;
            type: string;
            [key: string]: unknown;
          },
        });
      } else {
        logger.warn("Bridge event missing scope/type", { payload });
      }
    }
  };

  await page.exposeFunction("__bridgeEvent", handler);

  const sendRequest = async (
    command: string,
    payload: unknown,
    timeoutMs = 30000,
  ): Promise<Result<unknown, BridgeError>> => {
    const requestId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();

    const request = {
      v: 1 as const,
      type: "request" as const,
      requestId,
      correlationId,
      payload,
    };

    return new Promise<Result<unknown, BridgeError>>((resolve) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        resolve(
          Err({
            code: "Timeout",
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
          { cmd: command, req: request },
        )
        .catch((error: Error) => {
          clearTimeout(timer);
          pendingRequests.delete(requestId);
          resolve(
            Err({
              code: "Unknown",
              message: `Bridge call failed: ${error.message}`,
              details: error,
            }),
          );
        });
    });
  };

  const cleanup = () => {
    for (const [_requestId, pending] of pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(
        Err({
          code: "Unknown",
          message: "Bridge closed",
        }),
      );
    }
    pendingRequests.clear();
  };

  return { cleanup, sendRequest };
};

// Browserbase Pool Implementation

export const createBrowserbasePool = (
  apiKey: string,
  configStore: ConfigStoreService,
): BrowserPoolService => {
  const instances = new Map<string, BrowserInstance>();
  const sendRequestFns = new Map<
    string,
    (cmd: string, payload: unknown) => Promise<Result<unknown, BridgeError>>
  >();

  // Create a bounded queue for events
  const eventQueueEffect = Queue.bounded<TaggedBridgeEvent>(1000);
  let eventQueue: Queue.Queue<TaggedBridgeEvent> | null = null;

  const getClient = (): Browserbase => new Browserbase({ apiKey });

  const getEventQueue = async (): Promise<Queue.Queue<TaggedBridgeEvent>> => {
    if (!eventQueue) {
      eventQueue = await Effect.runPromise(eventQueueEffect);
    }
    return eventQueue;
  };

  const launch = (
    configId: BrowserConfigIdType,
  ): Effect.Effect<void, BrowserError> =>
    Effect.gen(function* () {
      // Check if already running
      if (instances.has(configId)) {
        return;
      }

      const configOpt = yield* configStore.get(configId).pipe(
        Effect.mapError((err) =>
          browserError("NotFound", `Config store error: ${err.message}`, err)
        ),
      );
      if (configOpt._tag === "None") {
        return yield* Effect.fail(
          browserError("NotFound", `Config not found: ${configId}`),
        );
      }
      const config = configOpt.value;

      yield* Effect.tryPromise({
        try: async () => {
          const client = getClient();
          const extensionId = config.extensionIds[0] as string | undefined;
          const contextId = config.context;

          const ctx = await client.contexts.retrieve(contextId);
          const created = await client.sessions.create({
            projectId: ctx.projectId,
            extensionId,
            browserSettings: {
              context: { id: contextId, persist: true },
            },
            keepAlive: true,
          });

          const live = await client.sessions.debug(created.id);
          const browser = await chromium.connectOverCDP(live.wsUrl);
          const context = browser.contexts()[0] ?? (await browser.newContext());
          const page = context.pages()[0] || (await context.newPage());

          const queue = await getEventQueue();
          const { cleanup, sendRequest } = await setupBridge(
            page,
            configId,
            queue,
          );

          const instance: BrowserInstance = {
            configId,
            browser,
            context,
            page,
            contextId,
            projectId: created.projectId,
            extensionId,
            cleanup,
          };

          instances.set(configId, instance);
          sendRequestFns.set(configId, sendRequest);
        },
        catch: (err) =>
          browserError(
            "LaunchFailed",
            err instanceof Error ? err.message : String(err),
            err,
          ),
      });
    });

  const stop = (
    configId: BrowserConfigIdType,
  ): Effect.Effect<void, BrowserError> =>
    Effect.tryPromise({
      try: async () => {
        const instance = instances.get(configId);
        if (!instance) return;

        instance.cleanup();
        await instance.browser.close().catch(() => {});

        const retryOptions: RetryOptions = {
          maxAttempts: 3,
          minTimeout: 1000,
          multiplier: 5,
        };

        const client = getClient();
        await retry(async () => {
          await client.sessions.update(instance.contextId, {
            projectId: instance.projectId,
            status: "REQUEST_RELEASE",
          });
        }, retryOptions);

        instances.delete(configId);
        sendRequestFns.delete(configId);
      },
      catch: (err) =>
        browserError(
          "StopFailed",
          err instanceof Error ? err.message : String(err),
          err,
        ),
    });

  const isRunning = (
    configId: BrowserConfigIdType,
  ): Effect.Effect<boolean> => Effect.sync(() => instances.has(configId));

  const send = (
    configId: BrowserConfigIdType,
    command: { readonly type: string; readonly payload: unknown },
  ): Effect.Effect<unknown, BrowserError | BridgeError> =>
    Effect.gen(function* () {
      const sendRequest = sendRequestFns.get(configId);
      if (!sendRequest) {
        return yield* Effect.fail(
          browserError("NotRunning", `Browser not running: ${configId}`),
        );
      }

      const result = yield* Effect.tryPromise({
        try: () => sendRequest(command.type, command.payload),
        catch: (err) =>
          browserError(
            "SendFailed",
            err instanceof Error ? err.message : String(err),
            err,
          ),
      });

      if (!result.ok) {
        return yield* Effect.fail(result.error);
      }

      return result.value;
    });

  const events: Stream.Stream<TaggedBridgeEvent, BrowserError> = Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Effect.promise(getEventQueue);
      return Stream.fromQueue(queue);
    }),
  );

  return {
    launch,
    stop,
    isRunning,
    send,
    events,
  };
};
