// tests/lib/linkedin-params.ts
// Test parameters for LinkedIn e2e tests.
//
// Resolution order:
//   1. Environment variables (for CI)
//   2. .linkedin-test-params.json file (for local dev)
//
// All params are required — the test fails with a clear error if missing.

export interface LinkedInTestParams {
  /** LinkedIn member ID of the test account (e.g. "ACoAAD...") */
  readonly selfMemberId: string;

  /** Thread/conversation ID to test sendMessage against */
  readonly threadId: string;

  /** Public identifier or member ID to test viewProfile against */
  readonly profileTarget: string;

  /** Member ID of a 2nd/3rd-degree connection to test sendConnectionRequest */
  readonly connectTarget: string;
}

const PARAM_FILE_DEFAULT = ".linkedin-test-params.json";

/**
 * Load test params from env vars or JSON file.
 * Throws with a descriptive error if any required param is missing.
 */
export const loadLinkedInTestParams = (): LinkedInTestParams => {
  // 1. Try env vars
  const selfMemberId = Deno.env.get("LINKEDIN_TEST_MEMBER_ID");
  const threadId = Deno.env.get("LINKEDIN_TEST_THREAD_ID");
  const profileTarget = Deno.env.get("LINKEDIN_TEST_PROFILE_TARGET");
  const connectTarget = Deno.env.get("LINKEDIN_TEST_CONNECT_TARGET");

  if (selfMemberId && threadId && profileTarget && connectTarget) {
    return { selfMemberId, threadId, profileTarget, connectTarget };
  }

  // 2. Try JSON file (fill in any gaps from env)
  const filePath = Deno.env.get("LINKEDIN_TEST_PARAMS_FILE") ??
    PARAM_FILE_DEFAULT;
  let fileParams: Partial<LinkedInTestParams> = {};
  try {
    fileParams = JSON.parse(Deno.readTextFileSync(filePath));
  } catch {
    // File not found or invalid — that's fine if env vars cover everything
  }

  const merged: LinkedInTestParams = {
    selfMemberId: selfMemberId ?? fileParams.selfMemberId ?? "",
    threadId: threadId ?? fileParams.threadId ?? "",
    profileTarget: profileTarget ?? fileParams.profileTarget ?? "",
    connectTarget: connectTarget ?? fileParams.connectTarget ?? "",
  };

  // Validate
  const missing: string[] = [];
  if (!merged.selfMemberId) missing.push("selfMemberId (LINKEDIN_TEST_MEMBER_ID)");
  if (!merged.threadId) missing.push("threadId (LINKEDIN_TEST_THREAD_ID)");
  if (!merged.profileTarget) missing.push("profileTarget (LINKEDIN_TEST_PROFILE_TARGET)");
  if (!merged.connectTarget) missing.push("connectTarget (LINKEDIN_TEST_CONNECT_TARGET)");

  if (missing.length > 0) {
    throw new Error(
      `Missing LinkedIn test params: ${missing.join(", ")}.\n` +
        `Set env vars or create ${PARAM_FILE_DEFAULT} with:\n` +
        JSON.stringify(
          {
            selfMemberId: "ACoAAD...",
            threadId: "2-...",
            profileTarget: "john-doe-123",
            connectTarget: "ACoAAE...",
          },
          null,
          2,
        ),
    );
  }

  return merged;
};
