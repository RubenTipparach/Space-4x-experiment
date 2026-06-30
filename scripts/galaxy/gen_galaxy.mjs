// Generate the local star cluster (100 systems) connected by a Delaunay graph, and
// cache it to client/public/data/galaxy.json so it can be hand-edited later.
//
// Run: node scripts/galaxy/gen_galaxy.mjs
//
// Output schema:
//   { meta, systems: [{ id, name, x, y, star:{class,color}, planets }], links: [[i,j],...] }
// Coordinates are in light-year-ish units centered on (0,0); the home system is id 0.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const COUNT = 100;
const RADIUS = 1000;          // cluster radius
const MIN_DIST = 90;          // min separation between systems
const SEED = 1337;

// deterministic RNG so re-runs reproduce the same cluster
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const pick = (arr) => arr[(rnd() * arr.length) | 0];

// star classes (color + rough rarity); cooler dwarfs are common, hot giants rare
const STARS = [
  { class: 'M', color: 0xff6a4a, w: 40 }, { class: 'K', color: 0xffb070, w: 22 },
  { class: 'G', color: 0xfff2c0, w: 16 }, { class: 'F', color: 0xfff6e6, w: 9 },
  { class: 'A', color: 0xdfe6ff, w: 6 }, { class: 'B', color: 0xbcd2ff, w: 4 },
  { class: 'O', color: 0x9fb8ff, w: 2 }, { class: 'N', color: 0x86f7ff, w: 1 }, // N = neutron/exotic
];
const starPick = () => { const tot = STARS.reduce((s, x) => s + x.w, 0); let r = rnd() * tot; for (const s of STARS) { if ((r -= s.w) <= 0) return s; } return STARS[0]; };

const SYL_A = ['Tha', 'Vor', 'Kry', 'Ze', 'Nyx', 'Cal', 'Dra', 'Eri', 'Fen', 'Hel', 'Ix', 'Jor', 'Lum', 'Mor', 'Os', 'Per', 'Qul', 'Ryn', 'Syr', 'Vel', 'Xan', 'Yth', 'Zad'];
const SYL_B = ['llian', 'dara', 'mos', 'phon', 'ven', 'tara', 'gish', 'mira', 'nox', 'lis', 'thar', 'qua', 'rios', 'dun', 'vash', 'pex', 'lune', 'gard', 'sira'];
const usedNames = new Set();
function makeName() { for (let i = 0; i < 50; i++) { const n = pick(SYL_A) + pick(SYL_B); if (!usedNames.has(n)) { usedNames.add(n); return n; } } return pick(SYL_A) + pick(SYL_B) + '-' + ((rnd() * 90 + 10) | 0); }

// --- sample positions in a disc with a minimum separation (rejection sampling) ---
const pts = [{ x: 0, y: 0 }];   // home system at the cluster center
let guard = 0;
while (pts.length < COUNT && guard++ < 200000) {
  const a = rnd() * Math.PI * 2, r = RADIUS * Math.sqrt(rnd());
  const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
  if (pts.every((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 > MIN_DIST * MIN_DIST)) pts.push(p);
}

// --- Delaunay triangulation (Bowyer-Watson) → unique edges ---
function circum(a, b, c) {
  const [ax, ay] = a, [bx, by] = b, [cx, cy] = c;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return { x: 0, y: 0, r2: Infinity };
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
}
function delaunay(points) {
  const n = points.length;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of points) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
  const dmax = Math.max(maxx - minx, maxy - miny) * 10, mx = (minx + maxx) / 2, my = (miny + maxy) / 2;
  const v = points.map((p) => [p.x, p.y]);
  v.push([mx - 2 * dmax, my - dmax], [mx, my + 2 * dmax], [mx + 2 * dmax, my - dmax]);
  let tris = [[n, n + 1, n + 2]];
  for (let i = 0; i < n; i++) {
    const px = v[i][0], py = v[i][1];
    const bad = tris.filter((t) => { const cc = circum(v[t[0]], v[t[1]], v[t[2]]); return (px - cc.x) ** 2 + (py - cc.y) ** 2 < cc.r2; });
    const edgeCount = new Map();
    for (const t of bad) for (const e of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const k = Math.min(e[0], e[1]) + '_' + Math.max(e[0], e[1]); edgeCount.set(k, (edgeCount.get(k) || 0) + 1); }
    tris = tris.filter((t) => !bad.includes(t));
    for (const [k, c] of edgeCount) if (c === 1) { const [a, b] = k.split('_').map(Number); tris.push([a, b, i]); }
  }
  tris = tris.filter((t) => t.every((x) => x < n));
  const set = new Set(), links = [];
  for (const t of tris) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const lo = Math.min(a, b), hi = Math.max(a, b), k = lo + '_' + hi; if (!set.has(k)) { set.add(k); links.push([lo, hi]); } }
  return links;
}

const links = delaunay(pts);
const systems = pts.map((p, i) => {
  const s = starPick();
  return { id: i, name: i === 0 ? 'Thallian Reach' : makeName(), x: Math.round(p.x), y: Math.round(p.y), star: { class: s.class, color: s.color }, planets: 3 + ((rnd() * 12) | 0) };
});

const out = { meta: { seed: SEED, count: COUNT, radius: RADIUS, generated: 'gen_galaxy.mjs', home: 0 }, systems, links };
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'public', 'data');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'galaxy.json'), JSON.stringify(out));
console.log(`galaxy.json: ${systems.length} systems, ${links.length} links`);
