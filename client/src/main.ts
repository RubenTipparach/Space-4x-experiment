import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import {
  FACTIONS, PLANETS, GAS_NODES, RES_COLOR, RESOURCE_LABEL, type ResourceTag,
} from './data.ts';

const BASE = import.meta.env.BASE_URL;
const ANGLES = 24;
const SHIP_SCALE = 0.16;
const SHIP_SPEED = 150;
const MINE_RATE = 22;
const CARGO_CAP = 100;
const HQ = { x: 70, y: -150 };
const TEX_LIGHT_ANGLE = Math.atan2(0.42 - 0.5, 0.72 - 0.5); // sphere highlight direction

const frameUrl = (fid: string, idx: number) =>
  `${BASE}sprites/${fid}_y${String(((idx % ANGLES) + ANGLES) % ANGLES * 15).padStart(3, '0')}.png`;

interface MineTarget { name: string; resource: ResourceTag; radius: number; pos(): { x: number; y: number }; }
type Vec = { x: number; y: number };
interface Ship {
  def: typeof FACTIONS[number]; sprite: Sprite; frames: Texture[]; ring: Graphics; sc: Container;
  pos: Vec; state: 'idle' | 'moving' | 'mining' | 'returning';
  moveTo: Vec | null; mine: MineTarget | null; cargo: number; cargoRes: ResourceTag | null; heading: number;
}

const resources: Record<ResourceTag, number> = {
  animals: 0, plants: 0, underwater: 0, minerals: 0, tourism: 0, ore: 0, crystal: 0, gas: 0,
};
const mineTargets: MineTarget[] = [];
let ships: Ship[] = [];
let selected = 0;

// ---- DOM (module scripts are deferred, so the DOM is ready) ----
const showErr = (m: string) => { const h = document.getElementById('hint'); if (h) h.textContent = m; };
window.addEventListener('error', (e) => showErr('Error: ' + e.message));
window.addEventListener('unhandledrejection', (e: any) => showErr('Error: ' + (e.reason?.message || e.reason)));

// ---------- procedural textures (canvas → GPU) ----------
function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void): Texture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  return Texture.from(c);
}
const SPHERE = canvasTex(256, 256, (x, w, h) => {
  const cx = w / 2, cy = h / 2, R = w / 2;
  x.save(); x.beginPath(); x.arc(cx, cy, R - 1, 0, 7); x.clip();
  const lx = w * 0.72, ly = h * 0.42;
  const g = x.createRadialGradient(lx, ly, 2, lx, ly, R * 1.3);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.16, '#dcdcdc'); g.addColorStop(0.46, '#8c8c8c');
  g.addColorStop(0.82, '#262626'); g.addColorStop(1, '#0b0b0b');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    const a = Math.random() * 7, r = Math.random() * R * 0.95;
    x.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    x.beginPath(); x.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.random() * 4 + 1, 0, 7); x.fill();
  }
  x.restore();
});
const GLOW = canvasTex(128, 128, (x, w, h) => {
  const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
});
function starTile(n: number, maxR: number, bright: number): Texture {
  return canvasTex(256, 256, (x, w, h) => {
    for (let i = 0; i < n; i++) {
      const a = bright * (0.4 + Math.random() * 0.6);
      x.fillStyle = `rgba(255,255,255,${a})`;
      x.beginPath(); x.arc(Math.random() * w, Math.random() * h, Math.random() * maxR + 0.3, 0, 7); x.fill();
    }
  });
}
const NEBULA = canvasTex(512, 512, (x, w, h) => {
  const blobs = [['#3a2d6b', 0.5], ['#1f4d6b', 0.45], ['#5a2a55', 0.4], ['#23506b', 0.4]] as const;
  x.globalCompositeOperation = 'lighter';
  for (const [col, al] of blobs) {
    for (let i = 0; i < 3; i++) {
      const cx = Math.random() * w, cy = Math.random() * h, r = 120 + Math.random() * 180;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, col + Math.round(al * 90).toString(16).padStart(2, '0'));
      g.addColorStop(1, col + '00');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    }
  }
});

main().catch((err) => { showErr('Boot error: ' + (err?.message || err)); console.error(err); });

async function main() {
  const pref = (new URLSearchParams(location.search).get('r') as 'webgl' | 'webgpu') || 'webgl';
  const app = new Application();
  await app.init({ background: 0x04060b, resizeTo: window, antialias: true, preference: pref });
  document.getElementById('game')!.appendChild(app.canvas);

  // background hit-rect for pan / click-to-move
  const bg = new Graphics();
  bg.eventMode = 'static';
  app.stage.addChild(bg);
  const sizeBg = () => bg.clear().rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x000000, alpha: 0.001 });

  // parallax background layers (screen space, behind the world)
  const bgLayers: { ts: TilingSprite; f: number }[] = [];
  const addLayer = (tex: Texture, f: number, alpha: number, scale = 1) => {
    const ts = new TilingSprite({ texture: tex, width: app.screen.width, height: app.screen.height });
    ts.alpha = alpha; ts.tileScale.set(scale); app.stage.addChild(ts); bgLayers.push({ ts, f }); return ts;
  };
  addLayer(NEBULA, 0.05, 0.4, 3.2);   // big tileScale → seams off-screen
  addLayer(starTile(40, 0.9, 0.5), 0.15, 0.7);
  addLayer(starTile(28, 1.3, 0.8), 0.32, 0.85);
  addLayer(starTile(16, 1.8, 1.0), 0.55, 1.0);

  // world (camera)
  const world = new Container();
  app.stage.addChild(world);

  // central star (uniformly bright core + additive glow)
  const sunGlow = new Sprite(GLOW); sunGlow.anchor.set(0.5); sunGlow.tint = 0xffcf86;
  sunGlow.blendMode = 'add'; sunGlow.width = sunGlow.height = 430; world.addChild(sunGlow);
  const sunCore = new Graphics()
    .circle(0, 0, 40).fill({ color: 0xffe2a8 })
    .circle(0, 0, 30).fill({ color: 0xfff4d8 });
  world.addChild(sunCore);

  // ---------- tooltips ----------
  const tip = document.getElementById('tooltip')!;
  const hoverable = (node: Container, html: string) => {
    node.eventMode = 'static'; node.cursor = 'pointer';
    node.on('pointerover', () => { tip.innerHTML = html; tip.hidden = false; });
    node.on('pointerout', () => { tip.hidden = true; });
  };
  const tagsHtml = (tags: ResourceTag[]) => tags.map((t) => RESOURCE_LABEL[t]).join(', ');
  const worldPos = (c: Container): Vec => { const l = world.toLocal(c.getGlobalPosition()); return { x: l.x, y: l.y }; };

  interface Orbiter { c: Container; orbit: number; angle: number; speed: number; }
  const orbiters: Orbiter[] = [];
  interface Spinner { c: Container; parent: Container; dist: number; angle: number; speed: number; }
  const spinners: Spinner[] = [];
  const shaded: { spr: Sprite; c: Container }[] = [];   // bodies that track the star's light

  const bindMine = (obj: Container, mt: MineTarget) => {
    obj.eventMode = 'static'; obj.cursor = 'pointer';
    obj.on('pointertap', (e) => {
      e.stopPropagation();
      const s = ships[selected]; if (!s) return;
      s.mine = mt; s.moveTo = null; s.state = 'moving';
      flashHint(`${s.def.name} → mining ${mt.name} (${RESOURCE_LABEL[mt.resource]})`);
    });
  };

  for (const p of PLANETS) {
    world.addChild(new Graphics().circle(0, 0, p.orbit).stroke({ width: 1, color: 0x223247, alpha: 0.45 }));
    const pc = new Container();
    pc.x = Math.cos(p.angle0) * p.orbit; pc.y = Math.sin(p.angle0) * p.orbit;
    world.addChild(pc);
    orbiters.push({ c: pc, orbit: p.orbit, angle: p.angle0, speed: p.speed });

    // atmosphere halo
    const halo = new Sprite(GLOW); halo.anchor.set(0.5); halo.tint = p.color; halo.blendMode = 'add';
    halo.alpha = p.type === 'gas' ? 0.5 : 0.3; halo.width = halo.height = p.size * (p.type === 'gas' ? 3.4 : 2.7);
    pc.addChild(halo);
    // shaded sphere
    const body = new Sprite(SPHERE); body.anchor.set(0.5); body.tint = p.color; body.width = body.height = p.size * 2;
    pc.addChild(body); shaded.push({ spr: body, c: pc });
    if (p.type === 'gas') { // banding hint via a faint ring
      const ring = new Graphics().ellipse(0, 0, p.size * 1.5, p.size * 0.5).stroke({ width: 2, color: 0xffffff, alpha: 0.06 });
      pc.addChild(ring);
    }

    const label = new Text({ text: p.name, style: { fill: 0xc9d4e3, fontSize: 12, fontFamily: 'Segoe UI' } });
    label.anchor.set(0.5, 0); label.y = p.size + 8; pc.addChild(label);
    p.tags.forEach((t, i) => {
      const dot = new Graphics().circle(0, 0, 3).fill({ color: RES_COLOR[t] });
      dot.x = (i - (p.tags.length - 1) / 2) * 9; dot.y = p.size + 24; pc.addChild(dot);
    });
    hoverable(body, `<div class="t-name">${p.name}${p.type === 'gas' ? ' (gas giant)' : ''}</div><div class="t-tags">${tagsHtml(p.tags)}</div>`);

    if (p.type === 'gas') {
      for (let n = 0; n < GAS_NODES; n++) {
        const nc = new Container(); const na = (n / GAS_NODES) * Math.PI * 2; const nd = p.size + 26;
        nc.x = Math.cos(na) * nd; nc.y = Math.sin(na) * nd;
        const g = new Graphics().circle(0, 0, 6).fill({ color: RES_COLOR.gas }).circle(0, 0, 10).stroke({ width: 1.5, color: RES_COLOR.gas, alpha: 0.5 });
        nc.addChild(g); pc.addChild(nc);
        const mt: MineTarget = { name: `${p.name} node ${n + 1}`, resource: 'gas', radius: 12, pos: () => worldPos(nc) };
        mineTargets.push(mt); hoverable(g, `<div class="t-name">${mt.name}</div><div class="t-tags">gas</div>`); bindMine(g, mt);
      }
    } else {
      const mt: MineTarget = { name: p.name, resource: p.primary, radius: p.size + 6, pos: () => worldPos(pc) };
      mineTargets.push(mt); bindMine(body, mt);
    }

    for (const m of (p.moons ?? [])) {
      const mc = new Container();
      mc.x = pc.x + Math.cos(m.angle0) * m.dist; mc.y = pc.y + Math.sin(m.angle0) * m.dist;
      world.addChild(mc); spinners.push({ c: mc, parent: pc, dist: m.dist, angle: m.angle0, speed: m.speed });
      const mb = new Sprite(SPHERE); mb.anchor.set(0.5); mb.tint = 0xc2c8d2; mb.width = mb.height = m.size * 2;
      mc.addChild(mb); shaded.push({ spr: mb, c: mc });
      mc.addChild(new Graphics().circle(0, m.size + 4, 2.5).fill({ color: RES_COLOR[m.resource] }));
      const mt: MineTarget = { name: m.name, resource: m.resource, radius: m.size + 5, pos: () => worldPos(mc) };
      mineTargets.push(mt);
      hoverable(mb, `<div class="t-name">${m.name} (moon)</div><div class="t-tags">${RESOURCE_LABEL[m.resource]}</div>`);
      bindMine(mb, mt);
    }
  }

  // HQ station
  const hq = new Container(); hq.x = HQ.x; hq.y = HQ.y; world.addChild(hq);
  hq.addChild(new Graphics()
    .circle(0, 0, 16).stroke({ width: 2, color: 0x5ec8ff, alpha: 0.7 })
    .poly([0, -10, 9, 0, 0, 10, -9, 0]).fill({ color: 0x9fd6ff })
    .circle(0, 0, 3).fill({ color: 0x04060b }));
  const hqLabel = new Text({ text: 'HQ', style: { fill: 0x9fd6ff, fontSize: 12, fontFamily: 'Segoe UI', fontWeight: '600' } });
  hqLabel.anchor.set(0.5, 0); hqLabel.y = 20; hq.addChild(hqLabel);
  hoverable(hq, '<div class="t-name">Headquarters</div><div class="t-tags">deposit point</div>');

  // ---------- fleet (lazy textures so boot never blocks) ----------
  function buildFleet() {
    ships = FACTIONS.map((def, i) => {
      const frames = Array.from({ length: ANGLES }, (_, k) => Texture.from(frameUrl(def.id, k)));
      const sprite = new Sprite(frames[0]); sprite.anchor.set(0.5); sprite.scale.set(SHIP_SCALE);
      const ring = new Graphics().circle(0, 0, 26).stroke({ width: 2, color: 0x5ec8ff, alpha: 0.9 }); ring.visible = false;
      const sc = new Container(); const start: Vec = { x: HQ.x + (i - 3.5) * 10, y: HQ.y + 30 };
      sc.x = start.x; sc.y = start.y; sc.addChild(ring, sprite); world.addChild(sc);
      return { def, sprite, frames, ring, sc, pos: { ...start }, state: 'idle' as const, moveTo: null, mine: null, cargo: 0, cargoRes: null, heading: 0 };
    });
    buildToolbar();
  }

  // ---------- input ----------
  let dn = false, mv = false, sx = 0, sy = 0, lx = 0, ly = 0;
  bg.on('pointerdown', (e) => { dn = true; mv = false; sx = lx = e.global.x; sy = ly = e.global.y; });
  bg.on('pointermove', (e) => {
    if (!dn) return;
    if (Math.abs(e.global.x - sx) + Math.abs(e.global.y - sy) > 6) mv = true;
    if (mv) { world.x += e.global.x - lx; world.y += e.global.y - ly; }
    lx = e.global.x; ly = e.global.y;
  });
  bg.on('pointerup', (e) => {
    dn = false; if (mv) return;
    const s = ships[selected]; if (!s) return;
    const p = world.toLocal(e.global); s.moveTo = { x: p.x, y: p.y }; s.mine = null; s.state = 'moving';
    flashHint(`${s.def.name} → moving`);
  });
  app.canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const f = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const before = world.toLocal({ x: ev.offsetX, y: ev.offsetY } as any);
    world.scale.x = world.scale.y = Math.min(2.2, Math.max(0.2, world.scale.x * f));
    const after = world.toLocal({ x: ev.offsetX, y: ev.offsetY } as any);
    world.x += (after.x - before.x) * world.scale.x; world.y += (after.y - before.y) * world.scale.y;
  }, { passive: false });

  // ---------- HUD ----------
  const fleetEl = document.getElementById('fleet')!;
  const resEl = document.getElementById('resources')!;
  const hintEl = document.getElementById('hint')!;
  const recallBtn = document.createElement('button');
  recallBtn.className = 'recall'; recallBtn.textContent = 'Recall ship'; document.body.appendChild(recallBtn);
  recallBtn.onclick = () => { const s = ships[selected]; if (!s) return; s.mine = null; s.moveTo = { ...HQ }; s.state = 'returning'; flashHint(`${s.def.name} → recalled to HQ`); };
  let hintTimer = 0;
  const DEFAULT_HINT = 'Click a ship in the fleet bar, then click a planet/moon/gas node to mine, or empty space to move.';
  function flashHint(m: string) { hintEl.textContent = m; hintTimer = 3; }
  function buildToolbar() {
    fleetEl.innerHTML = '';
    ships.forEach((s, i) => {
      const b = document.createElement('div');
      b.className = 'ship-btn' + (i === selected ? ' selected' : '');
      b.innerHTML = `<img src="${frameUrl(s.def.id, 0)}" alt=""><div class="s-name">${s.def.name}</div><div class="s-stat" data-i="${i}">idle</div>`;
      b.onclick = () => { selected = i; [...fleetEl.children].forEach((c, j) => c.classList.toggle('selected', j === selected)); };
      fleetEl.appendChild(b);
    });
  }
  function updateHud() {
    [...fleetEl.querySelectorAll('.s-stat')].forEach((el) => {
      const i = +(el as HTMLElement).dataset.i!; const s = ships[i]; if (!s) return;
      const cls = s.state === 'mining' ? 'mining' : s.state === 'returning' ? 'returning' : s.state === 'moving' ? 'moving' : '';
      el.className = 's-stat ' + cls;
      el.textContent = s.state === 'mining' ? `mining ${Math.round(s.cargo)}%` : s.state;
    });
    const rows = (Object.keys(resources) as ResourceTag[])
      .map((k) => `<div class="res-row"><span class="k">${RESOURCE_LABEL[k]}</span><span class="v">${Math.floor(resources[k])}</span></div>`).join('');
    resEl.innerHTML = `<h3>HQ Stores</h3>${rows}`;
    recallBtn.disabled = !ships[selected];
  }
  window.addEventListener('pointermove', (e) => { tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px'; });

  // ---------- camera ----------
  function fitCamera() { world.scale.set(Math.min(app.screen.width, app.screen.height) / 2520); world.x = app.screen.width / 2; world.y = app.screen.height / 2; }
  function onResize() {
    sizeBg();
    for (const L of bgLayers) { L.ts.width = app.screen.width; L.ts.height = app.screen.height; }
    fitCamera();
  }
  window.addEventListener('resize', onResize);

  // ---------- loop ----------
  function step(dt: number) {
    for (const L of bgLayers) L.ts.tilePosition.set(world.x * L.f, world.y * L.f);
    for (const o of orbiters) { o.angle += o.speed * dt; o.c.x = Math.cos(o.angle) * o.orbit; o.c.y = Math.sin(o.angle) * o.orbit; }
    for (const s of spinners) { s.angle += s.speed * dt; s.c.x = s.parent.x + Math.cos(s.angle) * s.dist; s.c.y = s.parent.y + Math.sin(s.angle) * s.dist; }
    for (const b of shaded) b.spr.rotation = Math.atan2(-b.c.y, -b.c.x) - TEX_LIGHT_ANGLE;

    for (const s of ships) {
      let dest: Vec | null = null;
      if (s.state === 'moving') dest = s.mine ? s.mine.pos() : s.moveTo;
      else if (s.state === 'returning') dest = { ...HQ };
      else if (s.state === 'mining' && s.mine) dest = s.mine.pos();
      if (dest) {
        const dx = dest.x - s.pos.x, dy = dest.y - s.pos.y, d = Math.hypot(dx, dy);
        const arriveR = s.mine ? s.mine.radius + 14 : (s.state === 'returning' ? 22 : 4);
        if (d > arriveR) { const k = Math.min(1, SHIP_SPEED * dt / d); s.pos.x += dx * k; s.pos.y += dy * k; s.heading = Math.atan2(dx, -dy); }
        else if (s.state === 'moving') s.state = s.mine ? 'mining' : 'idle';
        else if (s.state === 'returning') { if (s.cargoRes && s.cargo > 0) { resources[s.cargoRes] += s.cargo; s.cargo = 0; s.cargoRes = null; } s.state = 'idle'; s.moveTo = null; }
      }
      if (s.state === 'mining' && s.mine) { s.cargoRes = s.mine.resource; s.cargo = Math.min(CARGO_CAP, s.cargo + MINE_RATE * dt); if (s.cargo >= CARGO_CAP) s.state = 'returning'; }
      if (s.state === 'idle' && s.mine && s.cargo === 0) s.state = 'moving';
      const idx = Math.round((s.heading * 180 / Math.PI) / 15);
      s.sprite.texture = s.frames[((idx % ANGLES) + ANGLES) % ANGLES];
      s.sc.x = s.pos.x; s.sc.y = s.pos.y; s.ring.visible = (ships[selected] === s);
    }
  }

  let hudAcc = 0;
  app.ticker.add((t) => {
    const dt = Math.min(0.05, t.deltaMS / 1000);
    step(dt);
    hudAcc += dt; if (hudAcc > 0.15) { updateHud(); hudAcc = 0; }
    if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hintEl.textContent = DEFAULT_HINT; }
  });

  sizeBg();
  buildFleet();
  onResize();
  updateHud();
  (window as any).__ready = true;
}
