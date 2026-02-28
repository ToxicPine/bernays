import { chromium } from "playwright";
const executablePath = Deno.env.get("PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH");
console.log("executablePath:", executablePath);
const b = await chromium.launch({
  headless: true,
  ...(executablePath && { executablePath }),
});
const p = await b.newPage();
console.log(await p.evaluate(() => 2 + 2));
await b.close();
