// packages/browser/src/observers/x.ts
// X/Twitter-specific observer for auth status and DM detection.
// Uses DOM observation since X doesn't have a clean API.

import { wrapCommandError } from "../core/types.ts";

// Selectors

const SELECTORS = {
  // Auth Indicators
  accountSwitcher: '[data-testid="AccountSwitcher"]',
  profileLink: '[data-testid="AppTabBar_Profile_Link"]',
  loginButton: '[data-testid="loginButton"]',

  // DM Indicators
  dmDrawer: '[data-testid="DMDrawer"]',
  dmConversation: '[data-testid="conversation"]',
  dmMessage: '[data-testid="messageEntry"]',
} as const;

// Helpers

const extractCurrentUserId = (): string | undefined => {
  const profileLink = document.querySelector(SELECTORS.profileLink);
  if (profileLink instanceof HTMLAnchorElement) {
    const match = profileLink.href.match(/\/([^/]+)$/);
    if (match) return match[1];
  }
  return undefined;
};

const isLoggedIn = (): boolean => {
  return (
    document.querySelector(SELECTORS.accountSwitcher) !== null ||
    document.querySelector(SELECTORS.profileLink) !== null
  );
};

// Auth Observer

interface XAuthParams {
  platform: string;
}

interface XAuthResult {
  participantId: string;
  canRead: boolean;
  canWrite: boolean;
  issue?: string;
}

window.__registerCommand<XAuthParams, XAuthResult>(
  "observe:auth:x",
  async (_params) => {
    try {
      const loggedIn = isLoggedIn();

      if (!loggedIn) {
        window.__emitObservation("AuthObserved", {
          platform: "x",
          participantId: "x:",
          canRead: false,
          canWrite: false,
          issue: "signed-out",
        });

        return {
          ok: true,
          value: {
            participantId: "x:",
            canRead: false,
            canWrite: false,
            issue: "signed-out",
          },
        };
      }

      const userId = extractCurrentUserId() ?? "unknown";
      const participantId = `x:${userId}`;

      // Check for Suspension Notice
      const isSuspended = document.body.textContent?.toLowerCase().includes(
        "your account is suspended",
      ) ??
        false;

      if (isSuspended) {
        window.__emitObservation("AuthObserved", {
          platform: "x",
          participantId,
          canRead: false,
          canWrite: false,
          issue: "suspended",
        });

        return {
          ok: true,
          value: {
            participantId,
            canRead: false,
            canWrite: false,
            issue: "suspended",
          },
        };
      }

      const isRateLimited = document.body.textContent?.toLowerCase().includes(
        "rate limit exceeded",
      ) ?? false;

      if (isRateLimited) {
        window.__emitObservation("AuthObserved", {
          platform: "x",
          participantId,
          canRead: true,
          canWrite: false,
          issue: "rate-limited",
        });

        return {
          ok: true,
          value: {
            participantId,
            canRead: true,
            canWrite: false,
            issue: "rate-limited",
          },
        };
      }

      window.__emitObservation("AuthObserved", {
        platform: "x",
        participantId,
        canRead: true,
        canWrite: true,
      });

      return {
        ok: true,
        value: {
          participantId,
          canRead: true,
          canWrite: true,
        },
      };
    } catch (err) {
      return wrapCommandError(err);
    }
  },
);

// Messages Observer

interface XMessagesParams {
  platform: string;
  since?: string;
}

interface XMessagesResult {
  messageCount: number;
}

window.__registerCommand<XMessagesParams, XMessagesResult>(
  "observe:messages:x",
  async (_params) => {
    try {
      // X doesn't have a clean API for DMs, so we need to observe the DOM
      // This is a best-effort approach

      const dmDrawer = document.querySelector(SELECTORS.dmDrawer);

      if (!dmDrawer) {
        // DM Drawer Not Visible, Can't Observe
        return {
          ok: true,
          value: { messageCount: 0 },
        };
      }

      const messages = Array.from(
        dmDrawer.querySelectorAll(SELECTORS.dmMessage),
      );
      let messageCount = 0;

      for (const msgElement of messages) {
        // Extract Message Data from DOM
        const content = msgElement.textContent?.trim() ?? "";

        if (content) {
          messageCount++;

          // Generate IDs - X Doesn't Expose These Cleanly
          const platformId = `x-dm-${Date.now()}-${messageCount}`;
          const threadId = window.location.pathname.includes("/messages/")
            ? window.location.pathname.split("/").pop() ?? "unknown"
            : "unknown";

          window.__emitObservation("MessageObserved", {
            platform: "x",
            canonicalId: platformId,
            platformId,
            threadId,
            senderId: "x:unknown", // Hard to Extract Reliably
            content,
            timestamp: new Date().toISOString(),
            own: false,
          });
        }
      }

      return {
        ok: true,
        value: { messageCount },
      };
    } catch (err) {
      return wrapCommandError(err);
    }
  },
);

// Proactive Auth Monitoring

const setupAuthMonitor = (): void => {
  let lastAuthState = isLoggedIn();

  // Use MutationObserver to Detect DOM Changes That Might Indicate Logout
  const observer = new MutationObserver(() => {
    const currentAuthState = isLoggedIn();
    if (currentAuthState !== lastAuthState) {
      lastAuthState = currentAuthState;

      if (!currentAuthState) {
        window.__emitObservation("AuthObserved", {
          platform: "x",
          participantId: "x:",
          canRead: false,
          canWrite: false,
          issue: "signed-out",
        });
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also Check Periodically as a Fallback
  setInterval(() => {
    const currentAuthState = isLoggedIn();
    if (currentAuthState !== lastAuthState) {
      lastAuthState = currentAuthState;

      if (!currentAuthState) {
        window.__emitObservation("AuthObserved", {
          platform: "x",
          participantId: "x:",
          canRead: false,
          canWrite: false,
          issue: "signed-out",
        });
      }
    }
  }, 10000); // Check Every 10 Seconds
};

// Initialize Monitoring if We're on X
if (
  window.location.hostname.includes("x.com") ||
  window.location.hostname.includes("twitter.com")
) {
  setupAuthMonitor();
}

export {};
