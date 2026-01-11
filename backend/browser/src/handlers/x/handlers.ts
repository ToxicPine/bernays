// packages/browser/src/handlers/x/handlers.ts
// X/Twitter browser-side handlers - compiled to pure JS for injection
// Uses DOM manipulation for all operations

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

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const waitForSelector = async (
  selector: string,
  timeout = 5000,
): Promise<Element | null> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const element = document.querySelector(selector);
    if (element) return element;
    await wait(100);
  }
  return null;
};

const clickElement = async (element: Element): Promise<void> => {
  if (element instanceof HTMLElement) {
    element.click();
    await wait(300);
  }
};

const typeText = async (element: Element, text: string): Promise<void> => {
  if (element instanceof HTMLElement) {
    element.focus();
    // Use execCommand for contenteditable elements
    if (element.getAttribute("contenteditable") === "true") {
      element.innerText = text;
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      element.value = text;
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    await wait(100);
  }
};

// X uses React and complex DOM - these selectors need maintenance
const SELECTORS = {
  // Auth indicators
  accountSwitcher: '[data-testid="AccountSwitcher"]',
  loginButton: '[data-testid="loginButton"]',
  userAvatar: '[data-testid="AppTabBar_Profile_Link"]',

  // Follow button on profile pages
  followButton:
    '[data-testid="placementTracking"] [role="button"]:not([data-testid="userActions"])',
  unfollowButton: '[data-testid="placementTracking"] [data-testid*="unfollow"]',

  // Tweet actions
  retweetButton: '[data-testid="retweet"]',
  confirmRetweet: '[data-testid="retweetConfirm"]',
  likeButton: '[data-testid="like"]',
  unlikeButton: '[data-testid="unlike"]',

  // DM composing
  dmButton: '[data-testid="sendDMFromProfile"]',
  dmTextbox: '[data-testid="dmComposerTextInput"]',
  dmSendButton: '[data-testid="dmComposerSendButton"]',

  // Reply/compose
  replyButton: '[data-testid="reply"]',
  tweetTextarea: '[data-testid="tweetTextarea_0"]',
  tweetButton: '[data-testid="tweetButton"]',
} as const;

// ============================================================================
// Auth Check
// ============================================================================

window.__registerCommand<
  void,
  { authenticated: boolean; userId?: string }
>("x:checkAuth", async () => {
  try {
    // Check for account switcher which only appears when logged in
    const accountSwitcher = document.querySelector(SELECTORS.accountSwitcher);
    const profileLink = document.querySelector(SELECTORS.userAvatar);

    if (!accountSwitcher && !profileLink) {
      return {
        ok: true,
        value: { authenticated: false },
      };
    }

    // Try to extract user ID from profile link
    let userId: string | undefined;
    if (profileLink instanceof HTMLAnchorElement) {
      const match = profileLink.href.match(/\/([^/]+)$/);
      if (match) {
        userId = match[1];
      }
    }

    return {
      ok: true,
      value: { authenticated: true, userId },
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
// Send Message (DM)
// ============================================================================

window.__registerCommand<
  { recipientId: string; content: string },
  { messageId: string }
>("x:sendMessage", async (payload) => {
  try {
    // Navigate to the user's profile first if not already there
    const currentUrl = window.location.href;
    const targetProfileUrl = `https://x.com/${payload.recipientId}`;

    if (!currentUrl.includes(`/${payload.recipientId}`)) {
      window.location.href = targetProfileUrl;
      await wait(2000);
    }

    // Find and click the DM button
    const dmButton = await waitForSelector(SELECTORS.dmButton);
    if (!dmButton) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "DM button not found on profile",
          details: { selector: SELECTORS.dmButton },
        },
      };
    }

    await clickElement(dmButton);
    await wait(500);

    // Find the DM text input
    const dmTextbox = await waitForSelector(SELECTORS.dmTextbox);
    if (!dmTextbox) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "DM textbox not found",
          details: { selector: SELECTORS.dmTextbox },
        },
      };
    }

    await typeText(dmTextbox, payload.content);
    await wait(300);

    // Click send button
    const sendButton = await waitForSelector(SELECTORS.dmSendButton);
    if (!sendButton) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "DM send button not found",
          details: { selector: SELECTORS.dmSendButton },
        },
      };
    }

    await clickElement(sendButton);
    await wait(500);

    // Generate a message ID since X doesn't expose it easily
    const messageId = `x-dm-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    return {
      ok: true,
      value: { messageId },
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
// Follow User
// ============================================================================

window.__registerCommand<
  { targetUserId: string },
  { success: boolean }
>("x:follow", async (payload) => {
  try {
    // Navigate to user profile if not already there
    const currentUrl = window.location.href;
    const targetProfileUrl = `https://x.com/${payload.targetUserId}`;

    if (!currentUrl.includes(`/${payload.targetUserId}`)) {
      window.location.href = targetProfileUrl;
      await wait(2000);
    }

    // Wait for page to load
    await wait(1000);

    // Check if already following (unfollow button present)
    const unfollowButton = document.querySelector(SELECTORS.unfollowButton);
    if (unfollowButton) {
      // Already following
      return {
        ok: true,
        value: { success: true },
      };
    }

    // Find the follow button
    // X uses various button styles, we look for the primary follow action
    const buttons = Array.from(document.querySelectorAll('[role="button"]'));
    let followButton: Element | null = null;

    for (const button of buttons) {
      const text = button.textContent?.toLowerCase() || "";
      if (text === "follow" && !text.includes("following")) {
        followButton = button;
        break;
      }
    }

    if (!followButton) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "Follow button not found on profile",
          details: { attemptedSelector: "button containing 'Follow'" },
        },
      };
    }

    await clickElement(followButton);
    await wait(500);

    return {
      ok: true,
      value: { success: true },
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
// Retweet
// ============================================================================

window.__registerCommand<
  { tweetId: string },
  { success: boolean }
>("x:retweet", async (payload) => {
  try {
    // Navigate to the tweet if not already there
    const currentUrl = window.location.href;
    if (!currentUrl.includes(`/status/${payload.tweetId}`)) {
      // Find the tweet URL - need to navigate to it
      window.location.href = `https://x.com/i/status/${payload.tweetId}`;
      await wait(2000);
    }

    // Find the retweet button
    const retweetButton = await waitForSelector(SELECTORS.retweetButton);
    if (!retweetButton) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "Retweet button not found",
          details: { selector: SELECTORS.retweetButton },
        },
      };
    }

    await clickElement(retweetButton);
    await wait(300);

    // Click the confirm retweet option in the dropdown
    const confirmRetweet = await waitForSelector(SELECTORS.confirmRetweet);
    if (!confirmRetweet) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "Retweet confirm button not found",
          details: { selector: SELECTORS.confirmRetweet },
        },
      };
    }

    await clickElement(confirmRetweet);
    await wait(500);

    return {
      ok: true,
      value: { success: true },
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
// Like Tweet
// ============================================================================

window.__registerCommand<
  { tweetId: string },
  { success: boolean }
>("x:likeTweet", async (payload) => {
  try {
    // Navigate to the tweet if not already there
    const currentUrl = window.location.href;
    if (!currentUrl.includes(`/status/${payload.tweetId}`)) {
      window.location.href = `https://x.com/i/status/${payload.tweetId}`;
      await wait(2000);
    }

    // Check if already liked
    const unlikeButton = document.querySelector(SELECTORS.unlikeButton);
    if (unlikeButton) {
      // Already liked
      return {
        ok: true,
        value: { success: true },
      };
    }

    // Find the like button
    const likeButton = await waitForSelector(SELECTORS.likeButton);
    if (!likeButton) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "Like button not found",
          details: { selector: SELECTORS.likeButton },
        },
      };
    }

    await clickElement(likeButton);
    await wait(300);

    return {
      ok: true,
      value: { success: true },
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
// Reply to Tweet
// ============================================================================

window.__registerCommand<
  { tweetId: string; content: string },
  { success: boolean; replyId?: string }
>("x:replyToTweet", async (payload) => {
  try {
    // Navigate to the tweet
    const currentUrl = window.location.href;
    if (!currentUrl.includes(`/status/${payload.tweetId}`)) {
      window.location.href = `https://x.com/i/status/${payload.tweetId}`;
      await wait(2000);
    }

    // Find the reply button
    const replyButton = await waitForSelector(SELECTORS.replyButton);
    if (!replyButton) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "Reply button not found",
          details: { selector: SELECTORS.replyButton },
        },
      };
    }

    await clickElement(replyButton);
    await wait(500);

    // Find the tweet textarea
    const textarea = await waitForSelector(SELECTORS.tweetTextarea);
    if (!textarea) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "Tweet textarea not found",
          details: { selector: SELECTORS.tweetTextarea },
        },
      };
    }

    await typeText(textarea, payload.content);
    await wait(300);

    // Click the tweet/reply button
    const tweetButton = await waitForSelector(SELECTORS.tweetButton);
    if (!tweetButton) {
      return {
        ok: false,
        error: {
          code: "UIChanged",
          message: "Tweet button not found",
          details: { selector: SELECTORS.tweetButton },
        },
      };
    }

    await clickElement(tweetButton);
    await wait(500);

    return {
      ok: true,
      value: {
        success: true,
        replyId: `x-reply-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
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

export {};
