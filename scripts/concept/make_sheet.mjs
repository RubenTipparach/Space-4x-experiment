// Compose a labeled comparison sheet from the per-faction hero renders in clean/.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', 'assets', 'sprites', 'clean');

const F = [
  ['consortium-galactica', 'Consortium Galactica', 'Order'],
  ['kareth-nara', 'Kareth Nara', 'Nature'],
  ['terra-nexum', 'Terra Nexum', 'Frontier'],
  ['illumaria', 'Illumaria', 'Shadow'],
  ['astryn-vel', "Astryn'Vel", 'Rebels'],
  ['ezrathi', 'Ezrathi', 'Void'],
  ['krithul', "Kri'thul", 'Plague'],
  ['shadur-kai', "Shadur'kai", 'Stealth'],
];
const uri = f => 'data:image/png;base64,' + readFileSync(join(dir, `${f}.png`)).toString('base64');
const cards = F.map(([id, n, s]) => `<div class="card"><img src="${uri(id)}"><div class="n">${n}</div><div class="s">${s}</div></div>`).join('');
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:radial-gradient(circle at 50% 22%,#0e1622,#04060b 72%);font-family:'Segoe UI',Arial,sans-serif;color:#cdd6e3">
<div style="padding:22px 30px 2px;font-size:27px;font-weight:600;color:#eaf1fb">Stellar Frontier — Faction Cruisers (hard-surface samples)</div>
<div style="padding:0 30px 12px;font-size:14px;color:#8290a6">Blender/Cycles · one sample hull per faction · hero 3/4 view (full set = 24 yaw angles each)</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:6px 24px 24px">${cards}</div>
<style>.card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:8px;text-align:center}
.card img{width:100%;height:auto;display:block}.n{font-size:16px;font-weight:600;color:#f2f6fc;margin-top:4px}.s{font-size:12px;color:#8fa0ba}</style></body>`;
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: 'networkidle' });
await (await p.$('body')).screenshot({ path: join(dir, 'faction-samples.png') });
await b.close();
console.log('wrote assets/sprites/clean/faction-samples.png');
