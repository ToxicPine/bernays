// packages/browser/src/handlers/linkedin/handlers.ts
// LinkedIn browser-side handlers - compiled to pure JS for injection

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
    const profileLink = document.querySelector('a[href*="/in/"]');
    if (profileLink instanceof HTMLAnchorElement) {
      const match = profileLink.href.match(/\/in\/([^/]+)/);
      return match ? match[1] : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

// ============================================================================
// Auth Check
// ============================================================================

window.__registerCommand<
  void,
  { authenticated: boolean; userId?: string }
>("linkedin:checkAuth", async () => {
  try {
    const cookies = document.cookie;
    const hasAuthCookie = cookies.includes("li_at");

    if (!hasAuthCookie) {
      return {
        ok: true,
        value: { authenticated: false },
      };
    }

    const userId = extractCurrentUserId();

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
// Send Message
// ============================================================================

window.__registerCommand<
  { recipientId: string; content: string },
  { messageId: string; conversationId: string }
>("linkedin:sendMessage", async (payload) => {
  try {
    const response = await fetch(
      "https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "csrf-token": extractCsrfToken(),
        },
        body: JSON.stringify({
          conversationCreate: {
            eventCreate: {
              value: {
                "com.linkedin.voyager.messaging.create.MessageCreate": {
                  body: payload.content,
                  attachments: [],
                },
              },
            },
            recipients: [payload.recipientId],
          },
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
            message: "LinkedIn rate limit exceeded",
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
        messageId: data.value?.eventUrn || crypto.randomUUID(),
        conversationId: data.value?.conversationUrn || "",
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
  { memberId: string; since?: string; cursor?: string },
  { conversations: unknown[]; nextCursor?: string }
>("linkedin:syncConversations", async (payload) => {
  try {
    let url =
      `https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=conversationsQuery&variables=(mailboxUrn:urn:li:fsd_profile:${payload.memberId},count:20`;

    if (payload.cursor) {
      url += `,nextCursor:${payload.cursor}`;
    }

    url += ")";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "csrf-token": extractCsrfToken(),
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
    const conversations = data.data?.conversations?.elements || [];
    const nextCursor = data.data?.conversations?.paging?.nextCursor;

    return {
      ok: true,
      value: { conversations, nextCursor },
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
// People Search
// ============================================================================

window.__registerCommand<
  { query: string; filters?: Record<string, unknown>; cursor?: string },
  { results: unknown[]; nextCursor?: string }
>("linkedin:peopleSearch", async (payload) => {
  try {
    let url =
      `https://www.linkedin.com/voyager/api/search/dash/clusters?keywords=${
        encodeURIComponent(
          payload.query,
        )
      }&origin=GLOBAL_SEARCH_HEADER&q=all`;

    if (payload.cursor) {
      url += `&start=${payload.cursor}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "csrf-token": extractCsrfToken(),
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
    const results = data.elements || [];

    return {
      ok: true,
      value: {
        results,
        nextCursor: results.length > 0 ? String(results.length) : undefined,
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
// Follow
// ============================================================================

window.__registerCommand<
  { targetUserId: string },
  { success: boolean }
>("linkedin:follow", async (payload) => {
  try {
    const response = await fetch(
      "https://www.linkedin.com/voyager/api/feed/follows?action=follow",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "csrf-token": extractCsrfToken(),
        },
        body: JSON.stringify({
          urn: `urn:li:fsd_profile:${payload.targetUserId}`,
        }),
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
// Connect
// ============================================================================

window.__registerCommand<
  { targetUserId: string; note?: string },
  { success: boolean }
>("linkedin:connect", async (payload) => {
  try {
    const requestBody: Record<string, unknown> = {
      invitee: {
        "com.linkedin.voyager.growth.invitation.InviteeProfile": {
          profileId: payload.targetUserId,
        },
      },
    };

    if (payload.note) {
      requestBody.message = payload.note;
    }

    const response = await fetch(
      "https://www.linkedin.com/voyager/api/growth/normInvitations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "csrf-token": extractCsrfToken(),
        },
        body: JSON.stringify(requestBody),
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
// Withdraw Invitation
// ============================================================================

window.__registerCommand<
  { invitationId: string; targetUserId: string },
  { success: boolean }
>("linkedin:withdrawInvitation", async (payload) => {
  try {
    const response = await fetch(
      `https://www.linkedin.com/voyager/api/relationships/invitations/${payload.invitationId}`,
      {
        method: "DELETE",
        headers: {
          "csrf-token": extractCsrfToken(),
        },
        credentials: "include",
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return {
          ok: false,
          error: {
            code: "RateLimited",
            message: "LinkedIn rate limit exceeded",
            details: { status: response.status },
          },
        };
      }

      return {
        ok: false,
        error: {
          code: "NetworkTransient",
          message: `HTTP ${response.status}`,
        },
      };
    }

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
// View Profile
// ============================================================================

window.__registerCommand<
  { targetUserId: string; profileUrl?: string; fetchData?: boolean },
  { success: boolean; profileData?: unknown }
>("linkedin:viewProfile", async (payload) => {
  try {
    const profileUrl =
      payload.profileUrl ||
      `https://www.linkedin.com/in/${payload.targetUserId}/`;

    // Navigate to profile to register view
    window.location.href = profileUrl;

    // If fetchData is requested, fetch profile data via API
    if (payload.fetchData) {
      const response = await fetch(
        `https://www.linkedin.com/voyager/api/identity/profiles/${payload.targetUserId}`,
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

      const profileData = await response.json();
      return {
        ok: true,
        value: { success: true, profileData },
      };
    }

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
// Accept Invitation
// ============================================================================

window.__registerCommand<
  { invitationId: string; userId: string },
  { success: boolean }
>("linkedin:acceptInvitation", async (payload) => {
  try {
    const response = await fetch(
      `https://www.linkedin.com/voyager/api/relationships/invitations/${payload.invitationId}?action=accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "csrf-token": extractCsrfToken(),
        },
        credentials: "include",
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return {
          ok: false,
          error: {
            code: "RateLimited",
            message: "LinkedIn rate limit exceeded",
            details: { status: response.status },
          },
        };
      }

      return {
        ok: false,
        error: {
          code: "NetworkTransient",
          message: `HTTP ${response.status}`,
        },
      };
    }

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
// Reject Invitation
// ============================================================================

window.__registerCommand<
  { invitationId: string; userId: string },
  { success: boolean }
>("linkedin:rejectInvitation", async (payload) => {
  try {
    const response = await fetch(
      `https://www.linkedin.com/voyager/api/relationships/invitations/${payload.invitationId}?action=ignore`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "csrf-token": extractCsrfToken(),
        },
        credentials: "include",
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return {
          ok: false,
          error: {
            code: "RateLimited",
            message: "LinkedIn rate limit exceeded",
            details: { status: response.status },
          },
        };
      }

      return {
        ok: false,
        error: {
          code: "NetworkTransient",
          message: `HTTP ${response.status}`,
        },
      };
    }

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

export {};
