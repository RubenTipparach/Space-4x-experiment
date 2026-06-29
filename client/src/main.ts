import { Application, Container, Graphics, Sprite, Text, Texture, Assets } from 'pixi.js';
import {
  FACTIONS, PLANETS, GAS_NODES, RES_COLOR, RESOURCE_LABEL, type ResourceTag,
} from './data.ts';

const BASE = import.meta.env.BASE_URL;
const ANGLES = 24;
const SHIP_SCALE = 0.16;
const SHIP_SPEED = 150;      // world units / sec
const MINE_RATE = 22;        // cargo units / sec
const CARGO_CAP = 100;
const HQ = { x: 70, y: -150 };

const frameUrl = (fid: string, idx: number) =>
  `${BASE}sprites/${fid}_y${String(((idx % ANGLES) + ANGLES) % ANGLES * 15).padStart(3, '0')}.png`;

// ---------- runtime types ----------
interface MineTarget {
  name: string; resource: ResourceTag; radius: number; node: Container;
  pos(): { x: number; y: number };
}
type Vec = { x: number; y: number };

interface Ship {
  def: typeof FACTIONS[number];
  sprite: Sprite; frames: Texture[]; ring: Graphics;
  pos: Vec; state: 'idle' | 'moving' | 'mining' | 'returning';
  moveTo: Vec | null; mine: MineTarget | null; cargo: number; cargoRes: ResourceTag | null;
  heading: number;
}

const resources: Record<ResourceTag, number> = {
  animals: 0, plants: 0, underwater: 0, minerals: 0, tourism: 0, ore: 0, crystal: 0, gas: 0,
};

const mineTargets: MineTarget[] = [];
let ships: Ship[] = [];
let selected = 0;

// ---------- boot ----------
// surface any startup error in the hint bar instead of failing silently
const showErr = (m: string) => { const h = document.getElementById('hint'); if (h) h.textContent = m; };
window.addEventListener('error', (e) => showErr('Error: ' + e.message));
window.addEventListener('unhandledrejection', (e: any) => showErr('Error: ' + (e.reason?.message || e.reason)));

// renderer preference: WebGL by default (universal); ?r=webgpu to opt in
const pref = (new URLSearchParams(location.search).get('r') as 'webgl' | 'webgpu') || 'webgl';
const app = new Application();
await app.init({ background: 0x04060b, resizeTo: window, antialias: true, preference: pref });
document.getElementById('game')!.appendChild(app.canvas);

// camera world container
const world = new Container();
app.stage.addChild(world);

// fullscreen background for pan / click-to-move
const bg = new Graphics().rect(0, 0, 10, 10).fill({ color: 0x000000, alpha: 0.001 });
bg.eventMode = 'static';
app.stage.addChildAt(bg, 0);
const sizeBg = () => bg.clear().rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x000000, alpha: 0.001 });
sizeBg();

// starfield (parallax-ish, in world space)
const stars = new Graphics();
for (let i = 0; i < 600; i++) {
  const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 1400;
  stars.circle(Math.cos(a) * r, Math.sin(a) * r, Math.random() * 1.4)
    .fill({ color: 0xffffff, alpha: 0.06 + Math.random() * 0.22 });
}
world.addChild(stars);

// central star
const sun = new Graphics();
sun.circle(0, 0, 120).fill({ color: 0xffd9a0, alpha: 0.06 });
sun.circle(0, 0, 70).fill({ color: 0xffcf86, alpha: 0.12 });
sun.circle(0, 0, 36).fill({ color: 0xfff0c8 });
world.addChild(sun);

// ---------- build planets / moons / gas nodes ----------
const tip = document.getElementById('tooltip')!;
function hoverable(node: Container, html: string) {
  node.eventMode = 'static'; node.cursor = 'pointer';
  node.on('pointerover', () => { tip.innerHTML = html; tip.hidden = false; });
  node.on('pointerout', () => { tip.hidden = true; });
}
function tagsHtml(tags: ResourceTag[]) {
  return tags.map((t) => RESOURCE_LABEL[t]).join(', ');
}

interface Orbiter { c: Container; orbit: number; angle: number; speed: number; }
const orbiters: Orbiter[] = [];
interface Spinner { c: Container; parent: Container; dist: number; angle: number; speed: number; }
const spinners: Spinner[] = [];

for (const p of PLANETS) {
  // orbit ring
  world.addChild(new Graphics().circle(0, 0, p.orbit).stroke({ width: 1, color: 0x2a3a52, alpha: 0.5 }));

  const pc = new Container();
  pc.x = Math.cos(p.angle0) * p.orbit; pc.y = Math.sin(p.angle0) * p.orbit;
  world.addChild(pc);
  orbiters.push({ c: pc, orbit: p.orbit, angle: p.angle0, speed: p.speed });

  const body = new Graphics();
  if (p.type === 'gas') body.circle(0, 0, p.size + 6).fill({ color: p.color, alpha: 0.18 });
  body.circle(0, 0, p.size).fill({ color: p.color });
  body.circle(-p.size * 0.3, -p.size * 0.3, p.size * 0.55).fill({ color: 0xffffff, alpha: 0.08 });
  pc.addChild(body);

  const label = new Text({ text: p.name, style: { fill: 0xc9d4e3, fontSize: 12, fontFamily: 'Segoe UI' } });
  label.anchor.set(0.5, 0); label.y = p.size + 6; pc.addChild(label);

  // resource tag dots under the name
  p.tags.forEach((t, i) => {
    const dot = new Graphics().circle(0, 0, 3).fill({ color: RES_COLOR[t] });
    dot.x = (i - (p.tags.length - 1) / 2) * 9; dot.y = p.size + 22; pc.addChild(dot);
  });

  const tagText = `<div class="t-name">${p.name}${p.type === 'gas' ? ' (gas giant)' : ''}</div>` +
    `<div class="t-tags">${tagsHtml(p.tags)}</div>`;
  hoverable(body, tagText);

  if (p.type === 'gas') {
    // atmosphere mining nodes (Lagrange points) — the mineable gas spots
    for (let n = 0; n < GAS_NODES; n++) {
      const nc = new Container();
      const na = (n / GAS_NODES) * Math.PI * 2;
      const nd = p.size + 26;
      nc.x = Math.cos(na) * nd; nc.y = Math.sin(na) * nd;
      const g = new Graphics().circle(0, 0, 6).fill({ color: RES_COLOR.gas })
        .circle(0, 0, 10).stroke({ width: 1.5, color: RES_COLOR.gas, alpha: 0.5 });
      nc.addChild(g); pc.addChild(nc);
      const mt: MineTarget = {
        name: `${p.name} node ${n + 1}`, resource: 'gas', radius: 12, node: nc,
        pos: () => worldPos(nc),
      };
      mineTargets.push(mt);
      hoverable(g, `<div class="t-name">${mt.name}</div><div class="t-tags">gas</div>`);
      bindMine(g, mt);
    }
  } else {
    // rocky planet is itself a mine target for its primary resource
    const mt: MineTarget = { name: p.name, resource: p.primary, radius: p.size + 6, node: pc, pos: () => worldPos(pc) };
    mineTargets.push(mt); bindMine(body, mt);
  }

  // moons
  for (const m of (p.moons ?? [])) {
    world.addChild; // (orbit drawn implicitly small)
    const mc = new Container();
    mc.x = pc.x + Math.cos(m.angle0) * m.dist; mc.y = pc.y + Math.sin(m.angle0) * m.dist;
    world.addChild(mc);
    spinners.push({ c: mc, parent: pc, dist: m.dist, angle: m.angle0, speed: m.speed });
    const mb = new Graphics().circle(0, 0, m.size).fill({ color: 0xbfc6d0 })
      .circle(0, 0, 3).fill({ color: RES_COLOR[m.resource] });
    mc.addChild(mb);
    const mt: MineTarget = { name: m.name, resource: m.resource, radius: m.size + 5, node: mc, pos: () => worldPos(mc) };
    mineTargets.push(mt);
    hoverable(mb, `<div class="t-name">${m.name} (moon)</div><div class="t-tags">${RESOURCE_LABEL[m.resource]}</div>`);
    bindMine(mb, mt);
  }
}

function worldPos(c: Container): Vec { const p = c.getGlobalPosition(); const l = world.toLocal(p); return { x: l.x, y: l.y }; }

// HQ station
const hq = new Container(); hq.x = HQ.x; hq.y = HQ.y; world.addChild(hq);
const hqg = new Graphics()
  .circle(0, 0, 16).stroke({ width: 2, color: 0x5ec8ff, alpha: 0.7 })
  .poly([0, -10, 9, 0, 0, 10, -9, 0]).fill({ color: 0x9fd6ff })
  .circle(0, 0, 3).fill({ color: 0x04060b });
hq.addChild(hqg);
const hqLabel = new Text({ text: 'HQ', style: { fill: 0x9fd6ff, fontSize: 12, fontFamily: 'Segoe UI', fontWeight: '600' } });
hqLabel.anchor.set(0.5, 0); hqLabel.y = 20; hq.addChild(hqLabel);
hoverable(hqg, '<div class="t-name">Headquarters</div><div class="t-tags">deposit point</div>');

// ---------- mine binding ----------
function bindMine(obj: Container, mt: MineTarget) {
  obj.eventMode = 'static'; obj.cursor = 'pointer';
  obj.on('pointertap', (e) => {
    e.stopPropagation();
    const s = ships[selected];
    if (!s) return;
    s.mine = mt; s.moveTo = null; s.state = 'moving';
    flashHint(`${s.def.name} → mining ${mt.name} (${RESOURCE_LABEL[mt.resource]})`);
  });
}

// ---------- fleet ----------
async function buildFleet() {
  const urls: string[] = [];
  for (const f of FACTIONS) for (let i = 0; i < ANGLES; i++) urls.push(frameUrl(f.id, i));
  await Assets.load(urls);

  ships = FACTIONS.map((def, i) => {
    const frames = Array.from({ length: ANGLES }, (_, k) => Texture.from(frameUrl(def.id, k)));
    const sprite = new Sprite(frames[0]); sprite.anchor.set(0.5); sprite.scale.set(SHIP_SCALE);
    const ring = new Graphics().circle(0, 0, 26).stroke({ width: 2, color: 0x5ec8ff, alpha: 0.9 });
    ring.visible = false;
    const sc = new Container();
    const start: Vec = { x: HQ.x + (i - 3.5) * 10, y: HQ.y + 30 };
    sc.x = start.x; sc.y = start.y; sc.addChild(ring, sprite); world.addChild(sc);
    (sprite as any)._sc = sc;
    return {
      def, sprite, frames, ring, pos: { ...start }, state: 'idle' as const,
      moveTo: null, mine: null, cargo: 0, cargoRes: null, heading: 0,
    };
  });
  buildToolbar();
}

// ---------- input: background pan + click-to-move ----------
let down = false, moved = false, sx = 0, sy = 0, lastX = 0, lastY = 0;
bg.on('pointerdown', (e) => { down = true; moved = false; sx = lastX = e.global.x; sy = lastY = e.global.y; });
bg.on('pointermove', (e) => {
  if (!down) return;
  const dx = e.global.x - lastX, dy = e.global.y - lastY;
  if (Math.abs(e.global.x - sx) + Math.abs(e.global.y - sy) > 6) moved = true;
  if (moved) { world.x += dx; world.y += dy; }
  lastX = e.global.x; lastY = e.global.y;
});
bg.on('pointerup', (e) => {
  down = false;
  if (moved) return;                    // was a pan, not a click
  const s = ships[selected]; if (!s) return;
  const p = world.toLocal(e.global);
  s.moveTo = { x: p.x, y: p.y }; s.mine = null; s.state = 'moving';
  flashHint(`${s.def.name} → moving`);
});
app.canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const f = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
  const before = world.toLocal({ x: ev.offsetX, y: ev.offsetY } as any);
  world.scale.x = world.scale.y = Math.min(2.2, Math.max(0.25, world.scale.x * f));
  const after = world.toLocal({ x: ev.offsetX, y: ev.offsetY } as any);
  world.x += (after.x - before.x) * world.scale.x;
  world.y += (after.y - before.y) * world.scale.y;
}, { passive: false });

window.addEventListener('resize', sizeBg);

// fit camera to system
function fitCamera() {
  const s = Math.min(app.screen.width, app.screen.height) / 2520;
  world.scale.set(s);
  world.x = app.screen.width / 2; world.y = app.screen.height / 2;
}

// ---------- DOM HUD ----------
const fleetEl = document.getElementById('fleet')!;
const resEl = document.getElementById('resources')!;
const hintEl = document.getElementById('hint')!;
const recallBtn = document.createElement('button');
recallBtn.className = 'recall'; recallBtn.textContent = 'Recall ship'; document.body.appendChild(recallBtn);
recallBtn.onclick = () => {
  const s = ships[selected]; if (!s) return;
  s.mine = null; s.moveTo = { ...HQ }; s.state = 'returning';
  flashHint(`${s.def.name} → recalled to HQ`);
};

let hintTimer = 0;
function flashHint(msg: string) { hintEl.textContent = msg; hintTimer = 3; }

function buildToolbar() {
  fleetEl.innerHTML = '';
  ships.forEach((s, i) => {
    const b = document.createElement('div');
    b.className = 'ship-btn' + (i === selected ? ' selected' : '');
    b.innerHTML = `<img src="${frameUrl(s.def.id, 0)}" alt=""><div class="s-name">${s.def.name}</div><div class="s-stat" data-i="${i}">idle</div>`;
    b.onclick = () => { selected = i; refreshToolbarSelection(); };
    fleetEl.appendChild(b);
  });
}
function refreshToolbarSelection() {
  [...fleetEl.children].forEach((c, i) => c.classList.toggle('selected', i === selected));
}
function updateHud() {
  // statuses
  [...fleetEl.querySelectorAll('.s-stat')].forEach((el) => {
    const i = +(el as HTMLElement).dataset.i!; const s = ships[i];
    const cls = s.state === 'mining' ? 'mining' : s.state === 'returning' ? 'returning' : s.state === 'moving' ? 'moving' : '';
    el.className = 's-stat ' + cls;
    el.textContent = s.state === 'mining' ? `mining ${Math.round(s.cargo)}%`
      : s.state === 'returning' ? 'returning' : s.state === 'moving' ? 'moving' : 'idle';
  });
  // resources
  const rows = (Object.keys(resources) as ResourceTag[])
    .map((k) => `<div class="res-row"><span class="k">${RESOURCE_LABEL[k]}</span><span class="v">${Math.floor(resources[k])}</span></div>`)
    .join('');
  resEl.innerHTML = `<h3>HQ Stores</h3>${rows}`;
  recallBtn.disabled = !ships[selected];
}

// tooltip follow
window.addEventListener('pointermove', (e) => { tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px'; });

// ---------- game loop ----------
function step(dt: number) {
  // orbits
  for (const o of orbiters) { o.angle += o.speed * dt; o.c.x = Math.cos(o.angle) * o.orbit; o.c.y = Math.sin(o.angle) * o.orbit; }
  for (const s of spinners) { s.angle += s.speed * dt; s.c.x = s.parent.x + Math.cos(s.angle) * s.dist; s.c.y = s.parent.y + Math.sin(s.angle) * s.dist; }

  for (const s of ships) {
    const sc = (s.sprite as any)._sc as Container;
    let dest: Vec | null = null;
    if (s.state === 'moving') dest = s.mine ? s.mine.pos() : s.moveTo;
    else if (s.state === 'returning') dest = { ...HQ };
    else if (s.state === 'mining' && s.mine) {
      // stay attached to (possibly moving) target while mining
      dest = s.mine.pos();
    }

    if (dest) {
      const dx = dest.x - s.pos.x, dy = dest.y - s.pos.y;
      const d = Math.hypot(dx, dy);
      const arriveR = (s.state === 'mining') ? (s.mine!.radius + 14)
        : s.mine ? s.mine.radius + 14 : (s.state === 'returning' ? 22 : 4);
      if (d > arriveR) {
        const v = SHIP_SPEED * dt;
        const k = Math.min(1, v / d);
        s.pos.x += dx * k; s.pos.y += dy * k;
        s.heading = Math.atan2(dx, -dy);
      } else {
        // arrived
        if (s.state === 'moving') s.state = s.mine ? 'mining' : 'idle';
        else if (s.state === 'returning') {
          if (s.cargoRes && s.cargo > 0) { resources[s.cargoRes] += s.cargo; s.cargo = 0; s.cargoRes = null; }
          s.state = 'idle'; s.moveTo = null;
        }
      }
    }

    if (s.state === 'mining' && s.mine) {
      s.cargoRes = s.mine.resource;
      s.cargo = Math.min(CARGO_CAP, s.cargo + MINE_RATE * dt);
      if (s.cargo >= CARGO_CAP) s.state = 'returning';   // full -> haul to HQ (mine remembered to resume)
    }
    // resume mining after depositing
    if (s.state === 'idle' && s.mine && s.cargo === 0) s.state = 'moving';

    // facing frame
    const idx = Math.round((s.heading * 180 / Math.PI) / 15);
    s.sprite.texture = s.frames[((idx % ANGLES) + ANGLES) % ANGLES];
    sc.x = s.pos.x; sc.y = s.pos.y;
    s.ring.visible = (ships[selected] === s);
  }
}

let hudAcc = 0;
app.ticker.add((t) => {
  const dt = Math.min(0.05, t.deltaMS / 1000);
  step(dt);
  hudAcc += dt; if (hudAcc > 0.15) { updateHud(); hudAcc = 0; }
  if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hintEl.textContent = 'Click a ship in the fleet bar, then click a planet/moon/gas node to mine, or empty space to move.'; }
});

await buildFleet();
fitCamera();
updateHud();
