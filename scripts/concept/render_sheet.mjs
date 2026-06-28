// Render a labeled concept-art contact sheet PNG from the faction SVGs.
// Uses the globally-installed Playwright + preinstalled Chromium.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const art = join(here, '..', '..', 'assets', 'concept-art');

const ships = [
  ['consortium-galactica', 'Consortium Galactica', 'Galactic Council · Universal Order'],
  ['kareth-nara', 'Kareth Nara', 'Karisen Natives · Natural Sovereignty'],
  ['terra-nexum', 'Terra Nexum', 'Terran · Human Ascendancy'],
  ['illumaria', 'Illumaria', 'Benefactor · Guided Enlightenment'],
  ['astryn-vel', "Astryn'Vel", 'Rebels · Freedom Through Defiance'],
  ['ezrathi', 'Ezrathi', 'Cultists · Void Reverence'],
  ['krithul', "Kri'thul", 'Plague · Inevitable Corruption'],
  ['shadur-kai', "Shadur'kai", 'Rogue · Shadowed Autonomy'],
];

const cards = ships.map(([file, name, sub]) => {
  const svg = readFileSync(join(art, `${file}.svg`), 'utf8');
  return `<div class="card">
    <div class="ship">${svg}</div>
    <div class="name">${name}</div>
    <div class="sub">${sub}</div>
  </div>`;
}).join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:radial-gradient(circle at 50% 30%,#101826,#05070d 70%);
       font-family:'Segoe UI',Arial,sans-serif;color:#cdd6e3;}
  .title{padding:26px 30px 6px;font-size:30px;font-weight:600;letter-spacing:.5px;color:#eaf1fb;}
  .tag{padding:0 30px 18px;font-size:15px;color:#8290a6;}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;padding:8px 26px 30px;}
  .card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);
        border-radius:14px;padding:14px 10px 16px;text-align:center;}
  .ship{height:210px;display:flex;align-items:center;justify-content:center;}
  .ship svg{height:200px;width:auto;filter:drop-shadow(0 6px 14px rgba(0,0,0,.5));}
  .name{margin-top:8px;font-size:18px;font-weight:600;color:#f2f6fc;}
  .sub{font-size:12.5px;color:#8fa0ba;margin-top:2px;}
</style></head><body>
  <div class="title">Stellar Frontier — Faction Starship Concepts</div>
  <div class="tag">Thallian Nebula · top-down SVG signature hulls · concept pass for approval</div>
  <div class="grid">${cards}</div>
</body></html>`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
const el = await page.$('body');
await el.screenshot({ path: join(art, 'concept-sheet.png') });
await browser.close();
console.log('wrote', join(art, 'concept-sheet.png'));
