#!/usr/bin/env -S deno run --allow-all
// tests/scripts/linkedin-auth.ts
// Interactive auth acquisition — NOT a Deno.test.
//
// Launches headed Chromium, navigates to LinkedIn login, waits for the human
// to complete login + 2FA. Once li_at cookie is present, writes a
// LinkedInCookieFile to .linkedin-cookies.json.
//
// Usage:
//   deno run -A tests/scripts/linkedin-auth.ts
//   deno run -A tests/scripts/linkedin-auth.ts --output /path/to/cookies.json

import { chromium } from "playwright";
import { parseArgs } from "node:util";

// =============================================================================
// Output Type
// =============================================================================

/** Shape written to the cookie file. li_at + JSESSIONID are consumed by
 *  loadLinkedInTestConfig(); extractedAt is metadata for humans. */
interface LinkedInCookieFile {
  readonly li_at: string;
  readonly JSESSIONID: string;
  readonly extractedAt: string;
}

// =============================================================================
// Args
// =============================================================================

const { values } = parseArgs({
  args: Deno.args,
  options: {
    output: { type: "string", default: ".linkedin-cookies.json" },
  },
});

const outputPath = values.output!;

console.log("LinkedIn Auth Acquisition");
console.log("=========================");
console.log(`Output: ${outputPath}`);
console.log();

// =============================================================================
// Browser Launch
// =============================================================================

const executablePath = Deno.env.get(
  "PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH",
);
const browser = await chromium.launch({
  headless: false,
  ...(executablePath && { executablePath }),
});
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("https://www.linkedin.com/login");

console.log("Complete Login in the Browser Window.");
console.log("If 2FA Is Required, Complete That Too.");
console.log("Waiting for li_at Cookie (Timeout: 5 Minutes)...");
console.log();

// =============================================================================
// Cookie Polling
// =============================================================================

const TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;
const start = Date.now();

let li_at: string | undefined;
let jsessionid: string | undefined;

while (Date.now() - start < TIMEOUT_MS) {
  const allCookies = await context.cookies("https://www.linkedin.com");
  const liAtCookie = allCookies.find((c) => c.name === "li_at");
  const jsessionidCookie = allCookies.find((c) => c.name === "JSESSIONID");

  if (liAtCookie?.value) {
    li_at = liAtCookie.value;
    // LinkedIn sets JSESSIONID with surrounding quotes: "ajax:123456789"
    // Strip them — the bare value is the CSRF token used in API headers.
    const raw = jsessionidCookie?.value ?? "";
    jsessionid = raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1)
      : raw;
    break;
  }

  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}

if (!li_at) {
  console.error("Timed Out Waiting for li_at Cookie.");
  await browser.close();
  Deno.exit(1);
}

// =============================================================================
// Verification
// =============================================================================

console.log("Cookie Found. Verifying Auth...");
await page.goto("https://www.linkedin.com/feed/");
const url = page.url();
if (url.includes("/login") || url.includes("/checkpoint")) {
  console.error(`Auth Verification Failed — Redirected to: ${url}`);
  await browser.close();
  Deno.exit(1);
}

// =============================================================================
// Write Output
// =============================================================================

const output: LinkedInCookieFile = {
  li_at,
  JSESSIONID: jsessionid!,
  extractedAt: new Date().toISOString(),
};

Deno.writeTextFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");

console.log(`Cookies Written to ${outputPath}`);
console.log(`  li_at:        ${li_at.slice(0, 20)}...`);
console.log(`  JSESSIONID:   ${jsessionid}`);
console.log(`  Extracted At: ${output.extractedAt}`);

await browser.close();
