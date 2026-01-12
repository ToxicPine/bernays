// packages/browser/src/handlers/reddit/handlers.ts
// Reddit browser-side handlers - compiled to pure JS for injection

type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

declare global {
  interface Window {
    __registerCommand: <TReq, TRes>(
      command: string,
      handler: (payload: TReq) => Promise<CommandResult<TRes>>,
    ) => void;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract Reddit access token from cookies or localStorage.
 */
const extractAccessToken = (): string | undefined => {
  try {
    // Try to get from localStorage first (Reddit stores tokens there)
    const tokenData = localStorage.getItem("token");
    if (tokenData) {
      const parsed = JSON.parse(tokenData);
      return parsed.accessToken;
    }
  } catch {
    // Fall through
  }

  try {
    // Try from cookies
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

    // Try from header username
    const headerUsername = document.querySelector(
      '[id="email-collection-tooltip-id"]',
    );
    if (headerUsername?.textContent) {
      return headerUsername.textContent.trim();
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
    return { isBanned: true, reason: "Account Suspended" };
  }

  if (bodyText.includes("you have been banned")) {
    return { isBanned: true, reason: "Account Banned" };
  }

  if (bodyText.includes("your account has been permanently suspended")) {
    return { isBanned: true, reason: "Permanently Suspended" };
  }

  return { isBanned: false };
};

/**
 * Interact with shadow DOM elements in Reddit's chat interface.
 */
const findInShadowRoot = (
  host: Element,
  selector: string,
): Element | null => {
  const shadowRoot = (host as HTMLElement).shadowRoot;
  if (!shadowRoot) return null;
  return shadowRoot.querySelector(selector);
};

// ============================================================================
// Auth Check
// ============================================================================

window.__registerCommand<
  void,
  { authenticated: boolean; userId?: string; isBanned?: boolean; bannedReason?: string }
>("reddit:checkAuth", async () => {
  try {
    const token = extractAccessToken();
    const username = extractCurrentUsername();
    const banStatus = checkBanStatus();

    const isLoginPage =
      window.location.pathname.includes("/login") ||
      document.querySelector('input[name="username"]') !== null;

    if (isLoginPage || !token) {
      return {
        ok: true,
        value: { authenticated: false },
      };
    }

    return {
      ok: true,
      value: {
        authenticated: true,
        userId: username,
        isBanned: banStatus.isBanned,
        bannedReason: banStatus.reason,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      ok: false,
      error: {
        code: "Unknown",
        message: error.message,
        details: error,
      },
    };
  }
});

// ============================================================================
// Send Message
// ============================================================================

window.__registerCommand<
  { threadId: string; content: string; recipientUsername?: string },
  { messageId: string; roomId: string }
>("reddit:sendMessage", async (payload) => {
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

    // Reddit uses SendBird for chat - we need to interact with their chat UI
    // or use their internal GraphQL API

    // Try to find the chat input in shadow DOM (Reddit chat uses web components)
    const chatContainer = document.querySelector("shreddit-chat-message-input");

    if (chatContainer) {
      // Interact with shadow DOM
      const inputField = findInShadowRoot(chatContainer, "textarea");

      if (inputField instanceof HTMLTextAreaElement) {
        // Set the message content
        inputField.value = payload.content;
        inputField.dispatchEvent(new Event("input", { bubbles: true }));

        // Find and click send button
        const sendButton = findInShadowRoot(chatContainer, 'button[type="submit"]');
        if (sendButton instanceof HTMLButtonElement) {
          sendButton.click();

          // Wait a moment for the message to be sent
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            ok: true,
            value: {
              messageId: crypto.randomUUID(),
              roomId: payload.threadId,
            },
          };
        }
      }
    }

    // Fallback: Try using Reddit's internal chat API
    const response = await fetch(
      "https://s.reddit.com/api/v1/sendbird/me/channels",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          channel_url: payload.threadId,
          message: payload.content,
          message_type: "MESG",
        }),
        credentials: "include",
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return {
          ok: false,
          error: {
            code: "RateLimited",
            message: "Reddit rate limit exceeded",
            details: { status: response.status },
          },
        };
      }

      return {
        ok: false,
        error: {
          code: "NetworkTransient",
          message: `HTTP ${response.status}`,
          details: { status: response.status },
        },
      };
    }

    const data = await response.json();

    return {
      ok: true,
      value: {
        messageId: data.message_id || crypto.randomUUID(),
        roomId: payload.threadId,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      ok: false,
      error: {
        code: "Unknown",
        message: error.message,
        details: error,
      },
    };
  }
});

// ============================================================================
// Sync Conversations
// ============================================================================

window.__registerCommand<
  { since?: string; limit?: number },
  { conversations: unknown[]; nextCursor?: string }
>("reddit:syncConversations", async (payload) => {
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

    // Fetch chat rooms from Reddit's SendBird integration
    const limit = payload.limit ?? 20;
    let url = `https://s.reddit.com/api/v1/sendbird/me/channels?limit=${limit}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });

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
    const conversations = data.channels || [];

    // Transform to our format
    const transformedConversations = conversations.map(
      (channel: {
        channel_url: string;
        name: string;
        members: { user_id: string; nickname: string }[];
        last_message?: { message: string; created_at: number };
        unread_message_count: number;
      }) => ({
        roomId: channel.channel_url,
        name: channel.name,
        participants: channel.members.map((m) => ({
          id: m.user_id,
          username: m.nickname,
        })),
        lastMessage: channel.last_message
          ? {
              content: channel.last_message.message,
              timestamp: new Date(channel.last_message.created_at).toISOString(),
            }
          : undefined,
        unreadCount: channel.unread_message_count,
      }),
    );

    return {
      ok: true,
      value: {
        conversations: transformedConversations,
        nextCursor: data.next_cursor,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      ok: false,
      error: {
        code: "Unknown",
        message: error.message,
        details: error,
      },
    };
  }
});

// ============================================================================
// Discover Users (from thread or subreddit)
// ============================================================================

window.__registerCommand<
  { subreddit?: string; threadUrl?: string; limit?: number },
  { users: { userId: string; username: string; karma?: number }[] }
>("reddit:discoverUsers", async (payload) => {
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

    const users: { userId: string; username: string; karma?: number }[] = [];
    const limit = payload.limit ?? 25;

    if (payload.threadUrl) {
      // Scrape users from a specific thread
      // Navigate to the thread and extract commenters
      const threadId = payload.threadUrl.match(/comments\/(\w+)/)?.[1];
      if (threadId) {
        const response = await fetch(
          `https://oauth.reddit.com/comments/${threadId}?limit=${limit}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (response.ok) {
          const data = await response.json();
          const comments = data[1]?.data?.children || [];

          for (const comment of comments) {
            const author = comment.data?.author;
            if (author && author !== "[deleted]" && author !== "AutoModerator") {
              users.push({
                userId: `t2_${comment.data.author_fullname?.split("_")[1] || author}`,
                username: author,
              });
            }
          }
        }
      }
    } else if (payload.subreddit) {
      // Get users from subreddit posts
      const response = await fetch(
        `https://oauth.reddit.com/r/${payload.subreddit}/hot?limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        const posts = data.data?.children || [];

        for (const post of posts) {
          const author = post.data?.author;
          if (author && author !== "[deleted]" && author !== "AutoModerator") {
            users.push({
              userId: `t2_${post.data.author_fullname?.split("_")[1] || author}`,
              username: author,
            });
          }
        }
      }
    }

    // Deduplicate users
    const uniqueUsers = Array.from(
      new Map(users.map((u) => [u.username, u])).values(),
    );

    return {
      ok: true,
      value: { users: uniqueUsers },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      ok: false,
      error: {
        code: "Unknown",
        message: error.message,
        details: error,
      },
    };
  }
});

export {};
