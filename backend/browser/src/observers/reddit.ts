// packages/browser/src/observers/reddit.ts
// Reddit-specific observer for auth status and message detection.

type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

declare global {
  interface Window {
    __registerCommand: <TReq, TRes>(
      command: string,
      handler: (payload: TReq) => Promise<CommandResult<TRes>>,
    ) => void;
    __emitObservation: (type: string, payload: unknown) => void;
    __observerContext: { browserId: string; tabId: string };
  }
}

// Helpers

/**
 * Extract Reddit access token from cookies or localStorage.
 */
const extractAccessToken = (): string | undefined => {
  try {
    const tokenData = localStorage.getItem("token");
    if (tokenData) {
      const parsed = JSON.parse(tokenData);
      return parsed.accessToken;
    }
  } catch {
    // Fall through
  }

  try {
    const cookies = document.cookie.split("; ");
    for (const cookie of cookies) {
      if (cookie.startsWith("token_v2=")) {
        return cookie.split("=")[1];
      }
    }
  } catch {
    // Fall through
  }

  return undefined;
};

/**
 * Extract current Reddit username from the page.
 */
const extractCurrentUsername = (): string | undefined => {
  try {
    // Try from user dropdown
    const userDropdown = document.querySelector(
      '[data-testid="user-drawer-content"] span',
    );
    if (userDropdown?.textContent) {
      const match = userDropdown.textContent.match(/u\/(\w+)/);
      if (match) return match[1];
    }

    // Try from profile link
    const profileLink = document.querySelector('a[href*="/user/"]');
    if (profileLink instanceof HTMLAnchorElement) {
      const match = profileLink.href.match(/\/user\/(\w+)/);
      if (match) return match[1];
    }

    // Try from header username element
    const headerUsername = document.querySelector(
      '[id="email-collection-tooltip-id"]',
    );
    if (headerUsername?.textContent) {
      return headerUsername.textContent.trim();
    }

    // Try from karma display (new Reddit)
    const karmaElement = document.querySelector('[data-testid="karma"]');
    if (karmaElement) {
      const parent = karmaElement.closest('a[href*="/user/"]');
      if (parent instanceof HTMLAnchorElement) {
        const match = parent.href.match(/\/user\/(\w+)/);
        if (match) return match[1];
      }
    }
  } catch {
    // Ignore
  }
  return undefined;
};

/**
 * Check if the account appears to be banned or suspended.
 */
const checkBanStatus = (): {
  isBanned: boolean;
  reason?: string;
} => {
  const bodyText = document.body.textContent?.toLowerCase() ?? "";

  if (bodyText.includes("this account has been suspended")) {
    return { isBanned: true, reason: "Account suspended" };
  }

  if (bodyText.includes("you have been banned")) {
    return { isBanned: true, reason: "Account banned" };
  }

  if (bodyText.includes("your account has been permanently suspended")) {
    return { isBanned: true, reason: "Permanently suspended" };
  }

  // Check for shadowban indicator
  if (
    bodyText.includes("your posts are not visible") ||
    bodyText.includes("shadowbanned")
  ) {
    return { isBanned: true, reason: "Shadowbanned" };
  }

  return { isBanned: false };
};

/**
 * Check for rate limiting indicators.
 */
const checkRateLimit = (): { isLimited: boolean; retryAfter?: string } => {
  const bodyText = document.body.textContent?.toLowerCase() ?? "";

  if (
    bodyText.includes("you are doing that too much") ||
    bodyText.includes("try again in")
  ) {
    // Try to extract retry time
    const match = bodyText.match(/try again in (\d+) (second|minute|hour)/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const ms =
        unit === "hour"
          ? value * 3600000
          : unit === "minute"
            ? value * 60000
            : value * 1000;
      const retryAfter = new Date(Date.now() + ms).toISOString();
      return { isLimited: true, retryAfter };
    }
    return { isLimited: true };
  }

  return { isLimited: false };
};

const hasAuthToken = (): boolean => {
  return extractAccessToken() !== undefined;
};

// Auth Observer

interface RedditAuthParams {
  platform: string;
}

interface RedditAuthResult {
  accountId: string;
  canRead: boolean;
  canWrite: boolean;
  issue?: string;
}

window.__registerCommand<RedditAuthParams, RedditAuthResult>(
  "observe:auth:reddit",
  async (_params) => {
    try {
      const hasToken = hasAuthToken();
      const username = extractCurrentUsername();
      const banStatus = checkBanStatus();
      const rateLimit = checkRateLimit();

      // Check for login page
      const isLoginPage =
        window.location.pathname.includes("/login") ||
        document.querySelector('input[name="username"]') !== null;

      if (isLoginPage || !hasToken) {
        // Emit signed-out observation
        window.__emitObservation("AuthObserved", {
          platform: "reddit",
          accountId: "",
          canRead: false,
          canWrite: false,
          issue: "signed-out",
        });

        return {
          ok: true,
          value: {
            accountId: "",
            canRead: false,
            canWrite: false,
            issue: "signed-out",
          },
        };
      }

      const userId = username ?? "unknown";

      // Check for ban
      if (banStatus.isBanned) {
        window.__emitObservation("AuthObserved", {
          platform: "reddit",
          accountId: userId,
          canRead: false,
          canWrite: false,
          issue: "banned",
          isBanned: true,
          bannedReason: banStatus.reason,
        });

        return {
          ok: true,
          value: {
            accountId: userId,
            canRead: false,
            canWrite: false,
            issue: "banned",
          },
        };
      }

      // Check for rate limiting
      if (rateLimit.isLimited) {
        window.__emitObservation("AuthObserved", {
          platform: "reddit",
          accountId: userId,
          canRead: true,
          canWrite: false,
          issue: "rate-limited",
        });

        // Also emit rate limit event
        window.__emitObservation("RateLimitObserved", {
          platform: "reddit",
          browserId: window.__observerContext?.browserId ?? "unknown",
          retryAfter: rateLimit.retryAfter,
          limitType: "general",
        });

        return {
          ok: true,
          value: {
            accountId: userId,
            canRead: true,
            canWrite: false,
            issue: "rate-limited",
          },
        };
      }

      // Check for CAPTCHA
      const hasCaptcha =
        document.querySelector('[data-testid="captcha"]') !== null ||
        document.querySelector(".g-recaptcha") !== null;

      if (hasCaptcha) {
        window.__emitObservation("AuthObserved", {
          platform: "reddit",
          accountId: userId,
          canRead: false,
          canWrite: false,
          issue: "captcha",
        });

        return {
          ok: true,
          value: {
            accountId: userId,
            canRead: false,
            canWrite: false,
            issue: "captcha",
          },
        };
      }

      // Normal authenticated state
      window.__emitObservation("AuthObserved", {
        platform: "reddit",
        accountId: userId,
        canRead: true,
        canWrite: true,
      });

      return {
        ok: true,
        value: {
          accountId: userId,
          canRead: true,
          canWrite: true,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        ok: false,
        error: {
          code: "Unknown",
          message: error.message,
        },
      };
    }
  },
);

// Messages Observer

interface RedditMessagesParams {
  platform: string;
  since?: string;
}

interface RedditMessagesResult {
  messageCount: number;
}

window.__registerCommand<RedditMessagesParams, RedditMessagesResult>(
  "observe:messages:reddit",
  async (params) => {
    try {
      const token = extractAccessToken();
      if (!token) {
        return {
          ok: false,
          error: {
            code: "NotAuthenticated",
            message: "No access token found",
          },
        };
      }

      // Fetch chat messages from Reddit's SendBird integration
      const response = await fetch(
        "https://s.reddit.com/api/v1/sendbird/me/channels?limit=20",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
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
      const channels = data.channels ?? [];

      let messageCount = 0;
      const currentUser = extractCurrentUsername();

      // Process each chat channel and emit message events
      for (const channel of channels) {
        const lastMessage = channel.last_message;
        if (!lastMessage) continue;

        // Filter by timestamp if since is provided
        const eventTime = lastMessage.created_at;
        if (params.since && eventTime < new Date(params.since).getTime()) {
          continue;
        }

        const messageContent = lastMessage.message ?? "";
        const senderId = lastMessage.user?.user_id ?? "unknown";
        const senderUsername = lastMessage.user?.nickname ?? "unknown";

        if (messageContent) {
          messageCount++;

          // Determine if this is an anchor (first message) or reply
          const isOwn = senderUsername === currentUser;
          const roomId = channel.channel_url;
          const participants = (channel.members ?? []).map(
            (m: { nickname: string }) => m.nickname,
          );

          // Generate canonical ID
          const platformId = lastMessage.message_id ?? crypto.randomUUID();
          const canonicalId = `reddit-${platformId}`;

          // Check if this is the first message in the thread (anchor)
          const isAnchor = channel.message_count === 1;

          if (isAnchor) {
            window.__emitObservation("DirectMessageObserved", {
              platform: "reddit",
              kind: "anchor",
              canonicalId,
              platformId,
              threadId: roomId,
              senderId,
              content: messageContent,
              timestamp: new Date(eventTime).toISOString(),
              own: isOwn,
              anchor: {
                roomId,
                participants,
              },
            });
          } else {
            window.__emitObservation("MessageObserved", {
              platform: "reddit",
              kind: "reply",
              canonicalId,
              platformId,
              threadId: roomId,
              senderId,
              content: messageContent,
              timestamp: new Date(eventTime).toISOString(),
              own: isOwn,
            });
          }
        }
      }

      return {
        ok: true,
        value: { messageCount },
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        ok: false,
        error: {
          code: "Unknown",
          message: error.message,
        },
      };
    }
  },
);

// Proactive Auth Monitoring

// Set up monitoring for auth state changes
const setupAuthMonitor = (): void => {
  let lastAuthState = hasAuthToken();
  let lastBanState = checkBanStatus().isBanned;

  // Check periodically for auth/ban state changes
  setInterval(() => {
    const currentAuthState = hasAuthToken();
    const currentBanState = checkBanStatus().isBanned;

    // Auth state changed
    if (currentAuthState !== lastAuthState) {
      lastAuthState = currentAuthState;

      if (!currentAuthState) {
        window.__emitObservation("AuthObserved", {
          platform: "reddit",
          accountId: "",
          canRead: false,
          canWrite: false,
          issue: "signed-out",
        });
      }
    }

    // Ban state changed
    if (currentBanState !== lastBanState) {
      lastBanState = currentBanState;

      if (currentBanState) {
        const banStatus = checkBanStatus();
        const username = extractCurrentUsername() ?? "unknown";

        window.__emitObservation("AccountBanned", {
          platform: "reddit",
          accountId: username,
          banType: banStatus.reason?.toLowerCase().includes("shadowban")
            ? "shadowbanned"
            : "suspended",
          reason: banStatus.reason,
        });
      }
    }
  }, 5000); // Check every 5 seconds
};

// Set up monitoring for new chat notifications
const setupChatNotificationMonitor = (): void => {
  // Monitor for chat notification badge changes
  const observer = new MutationObserver(() => {
    const chatBadge = document.querySelector(
      '[data-testid="chat-count-badge"]',
    );
    if (chatBadge) {
      const count = parseInt(chatBadge.textContent ?? "0", 10);
      if (count > 0) {
        // New chat messages available - could trigger a sync
        // For now just log it; actual fetching is done via observe:messages:reddit
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
};

// Initialize monitoring if we're on Reddit
if (window.location.hostname.includes("reddit.com")) {
  setupAuthMonitor();
  setupChatNotificationMonitor();
}

export {};
