#!/usr/bin/env -S deno run --allow-all
// tests/scripts/linkedin-auth.ts
// Interactive auth acquisition — NOT a Deno.test.
//
// Launches headed Chromium, navigates to LinkedIn login, optionally pre-fills
// credentials from env, then waits for the human to complete login + 2FA.
// Once li_at cookie is present, writes cookies to .linkedin-cookies.json.
//
// Usage:
//   deno run -A tests/scripts/linkedin-auth.ts
//   LINKEDIN_TEST_EMAIL=you@example.com deno run -A tests/scripts/linkedin-auth.ts
//   deno run -A tests/scripts/linkedin-auth.ts --output /path/to/cookies.json

import { chromium } from "playwright";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: Deno.args,
  options: {
    output: { type: "string", default: ".linkedin-cookies.json" },
  },
});

const outputPath = values.output!;
const email = Deno.env.get("LINKEDIN_TEST_EMAIL");
const password = Deno.env.get("LINKEDIN_TEST_PASSWORD");

console.log("LinkedIn Auth Acquisition");
console.log("=========================");
console.log(`Output: ${outputPath}`);
if (email) console.log(`Email: ${email} (from env)`);
console.log();

// Launch headed browser (must be visible for human to complete login)
const executablePath = Deno.env.get("PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH");
const browser = await chromium.launch({
  headless: false,
  ...(executablePath && { executablePath }),
});
const context = await browser.newContext();
const page = await context.newPage();

// Navigate to login
await page.goto("https://www.linkedin.com/login");

// Pre-fill credentials if available
if (email) {
  await page.fill("#username", email);
}
if (password) {
  await page.fill("#password", password);
}

console.log("Complete login in the browser window.");
console.log("If 2FA is required, complete that too.");
console.log("Waiting for li_at cookie (timeout: 5 minutes)...");
console.log();

// Poll for li_at cookie
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
    jsessionid = jsessionidCookie?.value ?? "";
    break;
  }

  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}

if (!li_at) {
  console.error("Timed out waiting for li_at cookie.");
  await browser.close();
  Deno.exit(1);
}

// Verify auth by navigating to /feed
console.log("li_at cookie found. Verifying auth...");
await page.goto("https://www.linkedin.com/feed/");
const url = page.url();
if (url.includes("/login") || url.includes("/checkpoint")) {
  console.error(`Auth verification failed — redirected to: ${url}`);
  await browser.close();
  Deno.exit(1);
}

// Write cookies
const output = {
  li_at,
  JSESSIONID: jsessionid,
  extracted_at: new Date().toISOString(),
  email: email ?? "unknown",
};

Deno.writeTextFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");

console.log(`Cookies written to ${outputPath}`);
console.log(`  li_at: ${li_at.slice(0, 20)}...`);
console.log(`  JSESSIONID: ${jsessionid}`);
console.log(`  extracted_at: ${output.extracted_at}`);

await browser.close();
