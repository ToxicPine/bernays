// src/briefing/client.ts
// Effect-based client for calling remote bernays instances
//
// Makes HTTP calls to another agent's API to request briefings,
// send messages, and end conversations. Includes retries and timeouts.

import { Context, Effect, Schedule } from "effect";
import type { BriefingId } from "$/core/branded.ts";

// =============================================================================
// Error Types
// =============================================================================

export type BriefingClientErrorCode =
  | "NetworkError"
  | "Timeout"
  | "RemoteRejected"
  | "InvalidResponse";

export interface BriefingClientError {
  readonly _tag: "BriefingClientError";
  readonly code: BriefingClientErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const briefingClientError = (
  code: BriefingClientErrorCode,
  message: string,
  cause?: unknown,
): BriefingClientError => ({ _tag: "BriefingClientError", code, message, cause });

// =============================================================================
// Response Types
// =============================================================================

export interface BriefingRequestResponse {
  readonly accepted: boolean;
  readonly briefingId: string;
  readonly reason?: string;
}

export interface BriefingMessageResponse {
  readonly ok: boolean;
}

export interface BriefingEndResponse {
  readonly ok: boolean;
}

// =============================================================================
// Client Interface
// =============================================================================

export interface BriefingClientService {
  /**
   * Request a briefing with a remote agent.
   * Calls POST /briefings/request on the remote agent's API.
   */
  readonly requestBriefing: (
    remoteUrl: string,
    request: {
      readonly briefingId: string;
      readonly fromAgent: string;
      readonly topic: string;
      /** When the briefing is scheduled (ISO 8601). Omit for immediate. */
      readonly scheduledAt?: string;
      readonly context?: Record<string, unknown>;
    },
  ) => Effect.Effect<BriefingRequestResponse, BriefingClientError>;

  /**
   * Send a message within an active briefing.
   * Calls POST /briefings/:id/message on the remote agent's API.
   */
  readonly sendMessage: (
    remoteUrl: string,
    briefingId: string,
    message: {
      readonly sender: string;
      readonly content: string;
    },
  ) => Effect.Effect<BriefingMessageResponse, BriefingClientError>;

  /**
   * End a briefing.
   * Calls POST /briefings/:id/end on the remote agent's API.
   */
  readonly endBriefing: (
    remoteUrl: string,
    briefingId: string,
    request: {
      readonly endedBy: string;
      readonly reason?: string;
      readonly summary?: Record<string, unknown>;
    },
  ) => Effect.Effect<BriefingEndResponse, BriefingClientError>;
}

export class BriefingClient extends Context.Tag("BriefingClient")<
  BriefingClient,
  BriefingClientService
>() {}

// =============================================================================
// Retry Policy
// =============================================================================

const retryPolicy = Schedule.exponential("1 second").pipe(
  Schedule.compose(Schedule.recurs(3)),
);

// =============================================================================
// Implementation
// =============================================================================

const fetchJson = <T>(
  url: string,
  body: unknown,
  timeoutMs = 30_000,
): Effect.Effect<T, BriefingClientError> =>
  Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw Object.assign(
            new Error(`Remote Returned ${res.status}: ${text}`),
            { status: res.status },
          );
        }

        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    },
    catch: (err) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        return briefingClientError("Timeout", "Request Timed Out");
      }
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        return briefingClientError("RemoteRejected", msg, err);
      }
      return briefingClientError("NetworkError", msg, err);
    },
  });

/**
 * Create a BriefingClientService with retries and timeouts.
 *
 * @param timeoutMs - Request timeout in milliseconds (default: 30s)
 */
export const makeBriefingClient = (
  timeoutMs = 30_000,
): BriefingClientService => ({
  requestBriefing: (remoteUrl, request) => {
    const url = `${remoteUrl}/briefings/request`;
    return fetchJson<BriefingRequestResponse>(url, request, timeoutMs).pipe(
      Effect.retry(retryPolicy),
    );
  },

  sendMessage: (remoteUrl, briefingId, message) => {
    const url = `${remoteUrl}/briefings/${encodeURIComponent(briefingId)}/message`;
    return fetchJson<BriefingMessageResponse>(url, message, timeoutMs).pipe(
      Effect.retry(retryPolicy),
    );
  },

  endBriefing: (remoteUrl, briefingId, request) => {
    const url = `${remoteUrl}/briefings/${encodeURIComponent(briefingId)}/end`;
    return fetchJson<BriefingEndResponse>(url, request, timeoutMs).pipe(
      Effect.retry(retryPolicy),
    );
  },
});
