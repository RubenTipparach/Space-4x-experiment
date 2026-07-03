// Screenshot the 3D galaxy map + hyperspace tunnel (headless Chromium + SwiftShader).
//   PW_PATH="$(npm root -g)/playwright" node scripts/concept/shot_galaxy.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });
await page.waitForTimeout(2000);

// open the 3D galaxy map and frame the cluster from a low angle to show orbiting planets
await page.evaluate(() => {
  const g = window.__game; g.openGalaxy(); g.selectShip(0);
  // scatter a couple of ships so their find-buttons appear away from home
  const s1 = g.ships[1], r1 = g.routeTo(s1.system, 14) || g.routeTo(s1.system, 3); if (r1) g.departTo(s1, r1);
  g.setGalHover(14);   // hover a far star → route preview from the selected ship
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const m = window.__game.galaxy3d; if (!m) return;
  m.camera.position.set(0, 380, 720); m.controls.target.set(0, 0, 0);
});
await page.waitForTimeout(2500);
await page.evaluate(() => window.__game.setGalHover(14));
await page.waitForTimeout(200);
await page.screenshot({ path: 'assets/sprites/galaxy3d.png' });
console.log('wrote assets/sprites/galaxy3d.png');

// close-up on the home system to show planets orbiting a star
await page.evaluate(() => {
  const m = window.__game.galaxy3d; if (!m) return;
  m.camera.position.set(0, 90, 150); m.controls.target.set(0, 0, 0);
});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'assets/sprites/galaxy3d_close.png' });
console.log('wrote assets/sprites/galaxy3d_close.png');

// send the selected ship on a voyage → hyperspace tunnel
await page.evaluate(() => {
  const g = window.__game; const s = g.ships[0];
  const route = g.routeTo(s.system, 7) || g.routeTo(s.system, 3) || g.routeTo(s.system, 1);
  if (route) g.departTo(s, route);
});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'assets/sprites/hyperspace.png' });
console.log('wrote assets/sprites/hyperspace.png');

await browser.close();
