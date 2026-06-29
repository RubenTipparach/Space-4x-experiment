// Render a preview screenshot of the client in the cloud (headless Chromium + SwiftShader).
//
// Prereq: serve the built client first, e.g.
//   npm --prefix client run build && npm --prefix client run preview   # http://localhost:4173
// Run:
//   PW_PATH="$(npm root -g)/playwright" node scripts/concept/screenshot_client.mjs [url] [out.png]
//
// Notes:
// - Headless Chromium has no GPU here, so force software GL with the flags below.
//   (Pixi *renders* fine on SwiftShader; what previously hung was a blocking bulk
//   Assets.load at boot — the client now uses lazy Texture.from, so it boots without it.)
// - The client sets `window.__ready = true` at the end of boot; we wait on that.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');

const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'assets/sprites/slice.png';

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });
await page.waitForTimeout(3000);   // let orbits/sprites settle
await page.screenshot({ path: out });
console.log('wrote', out);
await browser.close();
