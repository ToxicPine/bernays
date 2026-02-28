import { chromium } from "playwright";
const executablePath = Deno.env.get("PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH");
console.log("executablePath:", executablePath);

// Test 1: chromium.launch() with executablePath — known working from messageboard
console.log("--- Test 1: chromium.launch() ---");
const b = await chromium.launch({
  headless: true,
  ...(executablePath && { executablePath }),
});
const p = await b.newPage();
console.log("launch() result:", await p.evaluate(() => 2 + 2));
await b.close();
console.log("launch() OK");

// Test 2: chromium.launchServer() with executablePath
console.log("--- Test 2: chromium.launchServer() ---");
try {
  const server = await chromium.launchServer({
    headless: true,
    ...(executablePath && { executablePath }),
  });
  const wsEndpoint = server.wsEndpoint();
  console.log("launchServer() wsEndpoint:", wsEndpoint);

  const b2 = await chromium.connectOverCDP(wsEndpoint);
  const ctx = b2.contexts()[0] ?? await b2.newContext();
  const p2 = await ctx.newPage();
  console.log("launchServer() result:", await p2.evaluate(() => 3 + 3));
  await b2.close();
  await server.close();
  console.log("launchServer() OK");
} catch (err) {
  console.error("launchServer() FAILED:", err instanceof Error ? err.message.slice(0, 200) : err);
}
