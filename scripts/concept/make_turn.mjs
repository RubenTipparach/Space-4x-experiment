// Compose a 4-view (90° yaw) turnaround sheet for one faction's clean render.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', 'assets', 'sprites', 'clean');
const fid = process.argv[2] || 'consortium-galactica';
const title = process.argv[3] || 'Consortium Galactica';
const uri = y => 'data:image/png;base64,' + readFileSync(join(dir, `${fid}_y${y}.png`)).toString('base64');
const views = [['000', '0° (front)'], ['090', '90°'], ['180', '180° (rear)'], ['270', '270°']];
const cards = views.map(([y, lbl]) => `<div class="card"><img src="${uri(y)}"><div class="n">${lbl}</div></div>`).join('');
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:radial-gradient(circle at 50% 25%,#0e1622,#04060b 72%);font-family:'Segoe UI',Arial,sans-serif;color:#cdd6e3">
<div style="padding:22px 30px 2px;font-size:27px;font-weight:600;color:#eaf1fb">${title} — turnaround (90° yaw)</div>
<div style="padding:0 30px 12px;font-size:14px;color:#8290a6">hard-surface model · Blender/Cycles · top-down 3/4</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:6px 24px 24px">${cards}</div>
<style>.card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:8px;text-align:center}
.card img{width:100%;height:auto;display:block}.n{font-size:14px;color:#cdd6e3;margin-top:4px}</style></body>`;
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1500, height: 520 }, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: 'networkidle' });
await (await p.$('body')).screenshot({ path: join(dir, `${fid}_turnaround.png`) });
await b.close();
console.log('wrote', `assets/sprites/clean/${fid}_turnaround.png`);
