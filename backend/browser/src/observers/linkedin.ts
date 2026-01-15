// packages/browser/src/observers/linkedin.ts
// LinkedIn-specific observer for auth status and message detection.

import { wrapCommandError } from "../core/types.ts";

// Helpers

const extractCsrfToken = (): string => {
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    if (cookie.startsWith("JSESSIONID=")) {
      return cookie.split("=")[1].replace(/"/g, "");
    }
  }
  return "";
};

const extractCurrentUserId = (): string | undefined => {
  try {
    // Try to get from profile link
    const profileLink = document.querySelector('a[href*="/in/"]');
    if (profileLink instanceof HTMLAnchorElement) {
      const match = profileLink.href.match(/\/in\/([^/]+)/);
      if (match) return match[1];
    }

    // Try to get from feed identity
    const feedIdentity = document.querySelector(
      '[data-control-name="identity_welcome_message"]',
    );
    if (feedIdentity) {
      const link = feedIdentity.querySelector("a");
      if (link instanceof HTMLAnchorElement) {
        const match = link.href.match(/\/in\/([^/]+)/);
        if (match) return match[1];
      }
    }
  } catch {
    // Ignore
  }
  return undefined;
};

const checkAuthCookie = (): boolean => {
  return document.cookie.includes("li_at");
};

// Auth Observer

interface LinkedInAuthParams {
  platform: string;
}

interface LinkedInAuthResult {
  participantId: string;
  canRead: boolean;
  canWrite: boolean;
  issue?: string;
}

window.__registerCommand<LinkedInAuthParams, LinkedInAuthResult>(
  "observe:auth:linkedin",
  async (_params) => {
    try {
      const hasAuthCookie = checkAuthCookie();

      if (!hasAuthCookie) {
        // Emit signed-out observation
        window.__emitObservation("AuthObserved", {
          platform: "linkedin",
          participantId: "linkedin:",
          canRead: false,
          canWrite: false,
          issue: "signed-out",
        });

        return {
          ok: true,
          value: {
            participantId: "linkedin:",
            canRead: false,
            canWrite: false,
            issue: "signed-out",
          },
        };
      }

      const userId = extractCurrentUserId() ?? "unknown";
      const participantId = `linkedin:${userId}`;

      // Check for rate limiting indicators
      const isRateLimited =
        document.body.textContent?.includes("you've reached the limit") ??
          false;

      if (isRateLimited) {
        window.__emitObservation("AuthObserved", {
          platform: "linkedin",
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

      // Check for captcha
      const hasCaptcha =
        document.querySelector('[data-test-id="challenge"]') !== null;

      if (hasCaptcha) {
        window.__emitObservation("AuthObserved", {
          platform: "linkedin",
          participantId,
          canRead: false,
          canWrite: false,
          issue: "captcha",
        });

        return {
          ok: true,
          value: {
            participantId,
            canRead: false,
            canWrite: false,
            issue: "captcha",
          },
        };
      }

      // Normal authenticated state
      window.__emitObservation("AuthObserved", {
        platform: "linkedin",
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

interface LinkedInMessagesParams {
  platform: string;
  since?: string;
}

interface LinkedInMessagesResult {
  messageCount: number;
}

window.__registerCommand<LinkedInMessagesParams, LinkedInMessagesResult>(
  "observe:messages:linkedin",
  async (params) => {
    try {
      // Fetch recent conversations via API
      const response = await fetch(
        "https://www.linkedin.com/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX",
        {
          method: "GET",
          headers: {
            "csrf-token": extractCsrfToken(),
          },
          credentials: "include",
        },
      );

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "NetworkTransient",
            message: `HTTP ${response.status}`,
          },
        };
      }

      const data = await response.json();
      const conversations = data.elements ?? [];

      let messageCount = 0;

      // Process each conversation and emit MessageObserved events
      for (const conv of conversations) {
        const lastEvent = conv.events?.[0];
        if (!lastEvent) continue;

        // Filter by timestamp if since is provided
        const eventTime = lastEvent.createdAt;
        if (params.since && eventTime < new Date(params.since).getTime()) {
          continue;
        }

        // Extract message content
        const messageContent = lastEvent.eventContent
          ?.["com.linkedin.voyager.messaging.event.MessageEvent"]?.body ?? "";

        if (messageContent) {
          messageCount++;

          // Generate a simple canonical ID based on available data
          const platformId = lastEvent.dashEntityUrn ?? lastEvent.entityUrn ??
            crypto.randomUUID();
          const threadId = conv.entityUrn ?? conv.dashEntityUrn ?? "unknown";
          const senderPlatformId =
            lastEvent.from?.["com.linkedin.voyager.messaging.MessagingMember"]
              ?.miniProfile?.publicIdentifier ?? "unknown";

          window.__emitObservation("MessageObserved", {
            platform: "linkedin",
            canonicalId: `li-${platformId}`,
            platformId,
            threadId,
            senderId: `linkedin:${senderPlatformId}`,
            content: messageContent,
            timestamp: new Date(eventTime).toISOString(),
            own: false, // Would need to compare with current user
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

// Set up a MutationObserver to detect auth state changes
const setupAuthMonitor = (): void => {
  let lastAuthState = checkAuthCookie();

  // Check periodically for auth cookie changes
  setInterval(() => {
    const currentAuthState = checkAuthCookie();
    if (currentAuthState !== lastAuthState) {
      lastAuthState = currentAuthState;

      // Emit auth change
      if (!currentAuthState) {
        window.__emitObservation("AuthObserved", {
          platform: "linkedin",
          participantId: "linkedin:",
          canRead: false,
          canWrite: false,
          issue: "signed-out",
        });
      }
    }
  }, 5000); // Check every 5 seconds
};

// Initialize monitoring if we're on LinkedIn
if (window.location.hostname.includes("linkedin.com")) {
  setupAuthMonitor();
}

export {};
