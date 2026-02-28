import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
console.log(await p.evaluate(() => 2 + 2));
await b.close();
