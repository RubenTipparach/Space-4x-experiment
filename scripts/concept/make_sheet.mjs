// Compose a labeled contact sheet PNG from the per-faction sprite PNGs.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', 'assets', 'sprites');

const FACTIONS = [
  ['consortium-galactica', 'Consortium Galactica', 'Galactic Council · Order'],
  ['kareth-nara', 'Kareth Nara', 'Karisen Natives · Nature'],
  ['terra-nexum', 'Terra Nexum', 'Terran · Frontier'],
  ['illumaria', 'Illumaria', 'Benefactor · Shadow'],
  ['astryn-vel', "Astryn'Vel", 'Rebels · Defiance'],
  ['ezrathi', 'Ezrathi', 'Cultists · Void'],
  ['krithul', "Kri'thul", 'Plague · Corruption'],
  ['shadur-kai', "Shadur'kai", 'Rogue · Stealth'],
];
const uri = f => 'data:image/png;base64,' + readFileSync(join(dir, `${f}.png`)).toString('base64');
const cards = FACTIONS.map(([id, n, s]) =>
  `<div class="card"><img src="${uri(id)}"><div class="n">${n}</div><div class="s">${s}</div></div>`).join('');
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:radial-gradient(circle at 50% 22%,#0e1622,#04060b 72%);font-family:'Segoe UI',Arial,sans-serif;color:#cdd6e3">
<div style="padding:24px 30px 4px;font-size:29px;font-weight:600;color:#eaf1fb">Stellar Frontier — Faction Ships (Blender / Cycles)</div>
<div style="padding:0 30px 14px;font-size:15px;color:#8290a6">Thallian Nebula · procedural greebled hulls, PBR materials, top-down 3/4 render</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:8px 26px 28px">${cards}</div>
<style>.card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:10px;text-align:center}
.card img{width:100%;height:auto;display:block}.n{font-size:17px;font-weight:600;color:#f2f6fc;margin-top:4px}.s{font-size:12.5px;color:#8fa0ba}</style></body>`;
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: 'networkidle' });
await (await p.$('body')).screenshot({ path: join(dir, 'sprite-sheet.png') });
await b.close();
console.log('wrote assets/sprites/sprite-sheet.png');
