// tests/lib/linkedin-params.ts
// LinkedIn e2e test configuration — cookies + test params from JSON files.
//
// Cookies: .linkedin-cookies.json (written by tests/scripts/linkedin-auth.ts)
// Params:  .linkedin-test-params.json (hand-written, account-specific values)
//
// Validated with Zod at load time — parse errors surface immediately with
// clear messages about what's missing.

import { z } from "@zod/zod";

// =============================================================================
// Schemas
// =============================================================================

/** Strip surrounding double-quotes that LinkedIn puts on JSESSIONID values. */
const stripQuotes = (s: string) =>
  s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;

export const LinkedInCookiesSchema = z.object({
  /** LinkedIn session token */
  li_at: z.string().min(1, "li_at must be a non-empty string"),
  /** LinkedIn CSRF token (bare value, no surrounding quotes) */
  JSESSIONID: z.string().min(1, "JSESSIONID must be a non-empty string")
    .transform(stripQuotes),
});

export const LinkedInTestParamsSchema = z.object({
  /** LinkedIn member ID of the test account (e.g. "ACoAAD...") */
  selfMemberId: z.string().min(1, "selfMemberId is required"),
  /** Thread/conversation ID to test sendMessage against */
  threadId: z.string().min(1, "threadId is required"),
  /** Public identifier or member ID to test viewProfile against */
  profileTarget: z.string().min(1, "profileTarget is required"),
  /** Member ID of a 2nd/3rd-degree connection to test sendConnectionRequest */
  connectTarget: z.string().min(1, "connectTarget is required"),
});

export const LinkedInTestConfigSchema = z.object({
  cookies: LinkedInCookiesSchema,
  params: LinkedInTestParamsSchema,
});

export type LinkedInCookies = z.infer<typeof LinkedInCookiesSchema>;
export type LinkedInTestParams = z.infer<typeof LinkedInTestParamsSchema>;
export type LinkedInTestConfig = z.infer<typeof LinkedInTestConfigSchema>;

// =============================================================================
// File Paths
// =============================================================================

const COOKIES_FILE = ".linkedin-cookies.json";
const PARAMS_FILE = ".linkedin-test-params.json";

// =============================================================================
// Loader
// =============================================================================

/** Read and parse a JSON file. Throws with a clear message if not found. */
const readJsonFile = (path: string): Record<string, unknown> => {
  try {
    return JSON.parse(Deno.readTextFileSync(path));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(
        `Required file not found: ${path}\n` +
          (path === COOKIES_FILE
            ? "Run: deno run -A tests/scripts/linkedin-auth.ts"
            : "Create it with your test account values — see LINKEDIN_TESTING.md"),
      );
    }
    throw err;
  }
};

/**
 * Load and validate the full LinkedIn test config from JSON files.
 *
 * Reads .linkedin-cookies.json and .linkedin-test-params.json from the
 * project root. Throws immediately if either file is missing or if Zod
 * validation fails.
 */
export const loadLinkedInTestConfig = (): LinkedInTestConfig => {
  const cookieFile = readJsonFile(COOKIES_FILE);
  const paramsFile = readJsonFile(PARAMS_FILE);

  return LinkedInTestConfigSchema.parse({
    cookies: cookieFile,
    params: paramsFile,
  });
};
