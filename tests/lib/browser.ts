// tests/lib/browser.ts
// Browserbase session management for E2E tests

import { type Browser, chromium } from "playwright";
import Browserbase from "@browserbasehq/sdk";
import type { E2EConfig } from "./config.ts";

/**
 * A Browserbase test session with a CDP connection.
 * Pages are obtained by connecting to the browser via CDP.
 */
export interface TestSession {
  readonly sessionId: string;
  readonly browser: Browser;
  readonly cdpUrl: string;
  readonly close: () => Promise<void>;
}

/**
 * Create a Browserbase session and connect via CDP.
 * Returns the session with a browser connected over CDP.
 */
export const createSession = async (
  config: E2EConfig,
): Promise<TestSession> => {
  const client = new Browserbase({ apiKey: config.browserbaseApiKey });

  const session = await client.sessions.create({
    projectId: config.browserbaseProjectId,
    browserSettings: {
      context: { id: config.browserbaseContextId, persist: false },
    },
    keepAlive: true,
  });

  const debug = await client.sessions.debug(session.id);
  const browser = await chromium.connectOverCDP(debug.wsUrl);

  return {
    sessionId: session.id,
    browser,
    cdpUrl: debug.wsUrl,
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
