// tests/lib/browser.ts
// Browserbase session management for E2E tests

import { chromium, type Browser, type Page } from "playwright";
import Browserbase from "@browserbasehq/sdk";
import type { E2EConfig } from "./config.ts";

export interface TestSession {
  sessionId: string;
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
}

export interface BridgeMessage {
  v: 1;
  type: "request" | "response" | "event";
  requestId?: string;
  correlationId?: string;
  payload?: unknown;
  error?: { code: string; message: string };
}

export const createSession = async (config: E2EConfig): Promise<TestSession> => {
  const client = new Browserbase({ apiKey: config.browserbaseApiKey });

  const session = await client.sessions.create({
    projectId: config.browserbaseProjectId,
    extensionId: config.browserbaseExtensionId,
    browserSettings: {
      context: { id: config.browserbaseContextId, persist: false },
    },
    keepAlive: true,
  });

  const debug = await client.sessions.debug(session.id);
  const browser = await chromium.connectOverCDP(debug.wsUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    sessionId: session.id,
    browser,
    page,
    close: async () => {
      try {
        await browser.close();
      } catch { /* ignore */ }
      try {
        await client.sessions.update(session.id, {
          projectId: config.browserbaseProjectId,
          status: "REQUEST_RELEASE",
        });
      } catch { /* ignore */ }
    },
  };
};

export const waitForExtension = async (
  page: Page,
  url: string,
  timeout = 30000,
): Promise<void> => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForFunction(
    () => typeof (window as unknown as Record<string, unknown>).__bridgeHandler === "function",
    { timeout },
  );
};

export const setupBridge = async (page: Page): Promise<{
  send: (cmd: string, payload: unknown, timeout?: number) => Promise<unknown>;
  events: BridgeMessage[];
  cleanup: () => void;
}> => {
  const events: BridgeMessage[] = [];
  const pending = new Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  await page.exposeFunction("__bridgeEvent", (msg: BridgeMessage) => {
    events.push(msg);
    if (msg.type === "response" && msg.requestId) {
      const p = pending.get(msg.requestId);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.requestId);
        if (msg.error) {
          p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        } else {
          p.resolve(msg.payload);
        }
      }
    }
  });

  const send = (cmd: string, payload: unknown, timeout = 30000): Promise<unknown> => {
    const requestId = crypto.randomUUID();
    const req: BridgeMessage = {
      v: 1,
      type: "request",
      requestId,
      correlationId: crypto.randomUUID(),
      payload,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`${cmd} timed out`));
      }, timeout);

      pending.set(requestId, { resolve, reject, timer });

      page.evaluate(
        (args: { cmd: string; req: BridgeMessage }) => {
          const handler = (window as unknown as Record<string, unknown>).__bridgeHandler as
            | ((cmd: string, req: BridgeMessage) => unknown)
            | undefined;
          return handler?.(args.cmd, args.req);
        },
        { cmd, req },
      ).catch((e: Error) => {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(e);
      });
    });
  };

  const cleanup = () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("cleanup"));
    }
    pending.clear();
  };

  return { send, events, cleanup };
};
