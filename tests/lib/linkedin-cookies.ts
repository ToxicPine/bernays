// tests/lib/linkedin-cookies.ts
// Cookie loading for LinkedIn e2e tests.
//
// Resolution order:
//   1. LINKEDIN_LI_AT + LINKEDIN_JSESSIONID env vars (preferred for CI)
//   2. Cookie file: LINKEDIN_COOKIES_FILE env var or .linkedin-cookies.json

export interface LinkedInCookies {
  readonly li_at: string;
  readonly JSESSIONID: string;
}

/**
 * Load LinkedIn cookies from env vars or file.
 * Throws if neither source is available.
 */
export const loadLinkedInCookies = (): LinkedInCookies => {
  // 1. Direct env vars
  const li_at = Deno.env.get("LINKEDIN_LI_AT");
  const jsessionid = Deno.env.get("LINKEDIN_JSESSIONID");
  if (li_at && jsessionid) {
    return { li_at, JSESSIONID: jsessionid };
  }

  // 2. Cookie file
  const filePath = Deno.env.get("LINKEDIN_COOKIES_FILE") ??
    ".linkedin-cookies.json";
  try {
    const content = JSON.parse(Deno.readTextFileSync(filePath));
    if (!content.li_at || !content.JSESSIONID) {
      throw new Error(
        `Cookie file ${filePath} missing li_at or JSESSIONID fields`,
      );
    }
    return { li_at: content.li_at, JSESSIONID: content.JSESSIONID };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(
        `No LinkedIn cookies found. Set LINKEDIN_LI_AT + LINKEDIN_JSESSIONID env vars, ` +
          `or run: deno run -A tests/scripts/linkedin-auth.ts`,
      );
    }
    throw err;
  }
};
