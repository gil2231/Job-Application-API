// Renders the toolbar icons from the web app's icon. Run once when the icon changes:
// pnpm --filter @autoapply/extension exec tsx scripts/icons.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const svg = readFileSync(resolve(import.meta.dirname, "../../web/src/app/icon.svg"), "utf8");
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: resolve(import.meta.dirname, `../icons/icon${size}.png`), omitBackground: true });
}
await browser.close();
