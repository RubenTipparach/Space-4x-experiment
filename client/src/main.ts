import { Application, Container, Graphics, Sprite, Text, Texture, Assets, Geometry, Mesh, Shader } from 'pixi.js';
import {
  FACTIONS, PLANETS, GAS_NODES, RES_COLOR, RESOURCE_LABEL, type ResourceTag,
} from './data.ts';

const BASE = import.meta.env.BASE_URL;
const ANGLES = 24;
const SHIP_SCALE = 0.085;          // ~1/4 of the previous size
const SHIP_SPEED = 150;
const TURN_RATE = 6;               // rad/s — smooth turning between frames
const MINE_RATE = 22;
const CARGO_CAP = 100;
const ISO = 0.58;                  // vertical squash → isometric/oblique orbital plane
const HQ = { x: 250, y: -300 * ISO };   // clear of the star's glow so ships read
const angWrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const TEX_LIGHT_ANGLE = Math.atan2(0.42 - 0.5, 0.72 - 0.5); // sphere highlight direction

const yawDeg = (idx: number) => String(((idx % ANGLES) + ANGLES) % ANGLES * 15).padStart(3, '0');
const frameUrl = (fid: string, idx: number) => `${BASE}sprites/${fid}_y${yawDeg(idx)}.png`;
const normalUrl = (fid: string, idx: number) => `${BASE}sprites/nm/${fid}_y${yawDeg(idx)}_n.png`;

// ---- normal-mapped ship lighting (Mesh + custom shader) ----
const SHIP_TEX = 320;                 // sprite native size → centered quad half-extent
const SHIP_LIGHT_Z = 0.55;            // toward-viewer component of the star light
const SHIP_LIGHT_STR = 0.85;          // how strongly the normal map modulates the baked albedo
const SHIP_LIGHT_BIAS = 0.32;
const shipVert = `#version 300 es
  in vec2 aPosition; in vec2 aUV; out vec2 vUV;
  uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
  void main(){ mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0); vUV = aUV; }`;
const shipFrag = `#version 300 es
  precision highp float;
  in vec2 vUV; out vec4 fragColor;
  uniform sampler2D uAlbedo; uniform sampler2D uNormal;
  uniform vec3 uLight; uniform float uResid; uniform float uStrength; uniform float uBias;
  void main(){
    vec4 a = texture(uAlbedo, vUV); if (a.a < 0.04) discard;
    vec3 raw = texture(uNormal, vUV).rgb * 2.0 - 1.0;
    vec3 n = normalize(vec3(raw.r, raw.b, raw.g));          // Blender camera-space decode
    float c = cos(uResid), s = sin(uResid);                 // rotate normal to match sprite spin
    n.xy = mat2(c, -s, s, c) * n.xy;
    float d = dot(n, normalize(uLight));
    float lit = clamp(1.0 + uStrength * (d - uBias), 0.3, 1.85);
    fragColor = vec4(a.rgb * lit, a.a);
  }`;
const shipGeometry = () => new Geometry({
  attributes: {
    aPosition: [-SHIP_TEX / 2, -SHIP_TEX / 2, SHIP_TEX / 2, -SHIP_TEX / 2, SHIP_TEX / 2, SHIP_TEX / 2, -SHIP_TEX / 2, SHIP_TEX / 2],
    aUV: [0, 0, 1, 0, 1, 1, 0, 1],
  },
  indexBuffer: [0, 1, 2, 0, 2, 3],
});
// flat normal (points at viewer) used until the per-yaw maps stream in
const FLAT_N = canvasTexFill(0x7fff7f);   // decode → n≈(0,0,1)
const PLACEHOLDER = canvasTex(2, 2, () => {});   // transparent → ship invisible until albedo streams in

interface MineTarget { name: string; resource: ResourceTag; radius: number; pos(): { x: number; y: number }; }
type Vec = { x: number; y: number };
interface Ship {
  def: typeof FACTIONS[number]; mesh: Mesh<Geometry, Shader>; shader: Shader; albedo: Texture[]; normals: Texture[];
  ring: Graphics; icon: Graphics; sc: Container;
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
function canvasTexFill(rgb: number): Texture {
  return canvasTex(2, 2, (x) => { x.fillStyle = '#' + rgb.toString(16).padStart(6, '0'); x.fillRect(0, 0, 2, 2); });
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
const NEB_COLORS = ['#6a37e0', '#c0379f', '#1f9fc0', '#3a5be0', '#9b4fe0', '#e06aa0'];
const a2 = (a: number) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
const pick = (arr: string[]) => arr[(Math.random() * arr.length) | 0];
// One vibrant, non-tiling nebula across the whole canvas (no repeating grid).
function drawNebula(x: CanvasRenderingContext2D, w: number, h: number) {
  x.clearRect(0, 0, w, h);
  x.globalCompositeOperation = 'lighter';
  const blob = (cx: number, cy: number, r: number, col: string, al: number) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, col + a2(al)); g.addColorStop(0.55, col + a2(al * 0.35)); g.addColorStop(1, col + '00');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  };
  for (let i = 0; i < 16; i++) blob(Math.random() * w, Math.random() * h, 160 + Math.random() * 360, pick(NEB_COLORS), 0.10 + Math.random() * 0.12);
  for (let i = 0; i < 54; i++) blob(Math.random() * w, Math.random() * h, 40 + Math.random() * 130, pick(NEB_COLORS), 0.08 + Math.random() * 0.14);
  for (let i = 0; i < 600; i++) { x.fillStyle = pick(NEB_COLORS) + '12'; x.beginPath(); x.arc(Math.random() * w, Math.random() * h, Math.random() * 1.6, 0, 7); x.fill(); }
}

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

  // STATIC background (screen space, no parallax — distant stars don't move).
  // Rebuilt on resize to cover the viewport; single image so there is no tiling grid.
  const bgVisual = new Container(); bgVisual.eventMode = 'none'; app.stage.addChild(bgVisual);
  function buildBackground() {
    bgVisual.removeChildren();
    const w = app.screen.width, h = app.screen.height;
    const neb = new Sprite(canvasTex(Math.min(w, 1920), Math.min(h, 1200), drawNebula));
    neb.width = w; neb.height = h; neb.alpha = 0.9; bgVisual.addChild(neb);
    const g = new Graphics();
    const n = Math.floor(w * h / 2200);   // denser starfield
    for (let i = 0; i < n; i++) {
      const big = Math.random() < 0.14;
      const size = big ? 1.0 + Math.random() * 1.7 : 0.3 + Math.random() * 1.0;
      const a = big ? 0.6 + Math.random() * 0.4 : 0.18 + Math.random() * 0.4;
      const col = Math.random() < 0.15 ? 0xbcd2ff : Math.random() < 0.1 ? 0xffe6c8 : 0xffffff;
      g.circle(Math.random() * w, Math.random() * h, size).fill({ color: col, alpha: a });
    }
    bgVisual.addChild(g);
  }

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
    world.addChild(new Graphics().ellipse(0, 0, p.orbit, p.orbit * ISO).stroke({ width: 1, color: 0x223247, alpha: 0.45 }));
    const pc = new Container();
    pc.x = Math.cos(p.angle0) * p.orbit; pc.y = Math.sin(p.angle0) * p.orbit * ISO;
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
        nc.x = Math.cos(na) * nd; nc.y = Math.sin(na) * nd * ISO;
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
      mc.x = pc.x + Math.cos(m.angle0) * m.dist; mc.y = pc.y + Math.sin(m.angle0) * m.dist * ISO;
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

  // ---------- asteroid belt (alive: drifting rocks) ----------
  const BELT_R = 460;
  const belt: { g: Graphics; angle: number; r: number; speed: number; spin: number }[] = [];
  const beltLayer = new Container(); world.addChild(beltLayer);
  for (let i = 0; i < 160; i++) {
    const r = BELT_R + (Math.random() - 0.5) * 70;
    const s = 1.2 + Math.random() * 2.6;
    const g = new Graphics().poly([-s, -s * 0.7, s * 0.8, -s, s, s * 0.6, -s * 0.5, s]).fill({ color: 0x6b6256 });
    beltLayer.addChild(g);
    belt.push({ g, angle: Math.random() * Math.PI * 2, r, speed: 0.01 + Math.random() * 0.006, spin: (Math.random() - 0.5) * 2 });
  }
  // two mineable asteroid clusters embedded in the belt
  for (const [frac, res] of [[0.2, 'ore'], [0.65, 'crystal']] as const) {
    const c = new Container(); world.addChild(c);
    const node = { c, angle: frac * Math.PI * 2, r: BELT_R, speed: 0.013 };
    belt.push({ g: c as any, angle: node.angle, r: node.r, speed: node.speed, spin: 0 });
    const col = res === 'ore' ? 0xb98a5a : 0x9be8ff;
    const gg = new Graphics();
    for (let k = 0; k < 5; k++) { const a = (k / 5) * 7, rr = 5 + Math.random() * 4; gg.circle(Math.cos(a) * 7, Math.sin(a) * 7, rr).fill({ color: 0x7a6f60 }); }
    gg.circle(0, 0, 5).fill({ color: col });
    c.addChild(gg);
    const mt: MineTarget = { name: res === 'ore' ? 'Ore Field' : 'Crystal Field', resource: res, radius: 16, pos: () => worldPos(c) };
    mineTargets.push(mt); hoverable(gg, `<div class="t-name">${mt.name}</div><div class="t-tags">${RESOURCE_LABEL[res]}</div>`); bindMine(gg, mt);
  }

  // ---------- comets (eccentric orbits with tails pointing away from the star) ----------
  const comets: { c: Container; tail: Sprite; rx: number; ry: number; angle: number; speed: number }[] = [];
  for (const [rx, ry, sp, ph] of [[680, 920, 0.10, 0], [1080, 760, 0.07, 2.2]] as const) {
    const c = new Container(); world.addChild(c);
    const tail = new Sprite(GLOW); tail.anchor.set(1, 0.5); tail.tint = 0x9fe8ff; tail.blendMode = 'add';
    tail.width = 150; tail.height = 26; c.addChild(tail);
    c.addChild(new Graphics().circle(0, 0, 3.5).fill({ color: 0xddfbff }));
    comets.push({ c, tail, rx, ry, angle: ph, speed: sp });
  }

  // mining/attack beam layer (over planets, under ships)
  const fx = new Graphics(); world.addChild(fx);

  // ---------- fleet ----------
  function buildFleet() {
    const albUrls: string[] = [], nrmUrls: string[] = [];
    for (const def of FACTIONS) for (let k = 0; k < ANGLES; k++) { albUrls.push(frameUrl(def.id, k)); nrmUrls.push(normalUrl(def.id, k)); }
    ships = FACTIONS.map((def, i) => {
      const albedo = Array.from({ length: ANGLES }, () => PLACEHOLDER);   // populated by Assets.load below
      const normals = Array.from({ length: ANGLES }, () => FLAT_N);
      const shader = Shader.from({ gl: { vertex: shipVert, fragment: shipFrag }, resources: {
        uAlbedo: PLACEHOLDER.source, uNormal: FLAT_N.source,
        lightUniforms: {
          uLight: { value: [0, 0, 1], type: 'vec3<f32>' },
          uResid: { value: 0, type: 'f32' },
          uStrength: { value: 0, type: 'f32' },          // 0 until normals load → pure albedo
          uBias: { value: SHIP_LIGHT_BIAS, type: 'f32' },
        },
      } });
      const mesh = new Mesh({ geometry: shipGeometry(), shader }); mesh.scale.set(SHIP_SCALE);
      const ring = new Graphics().circle(0, 0, 22).stroke({ width: 1.5, color: 0x5ec8ff, alpha: 0.9 }); ring.visible = false;
      const icon = new Graphics(); icon.y = -22; icon.visible = false;  // action indicator above the ship
      const sc = new Container(); const start: Vec = { x: HQ.x + (i - 3.5) * 34, y: HQ.y + (i % 2 ? 26 : 54) };
      sc.x = start.x; sc.y = start.y; sc.addChild(ring, mesh, icon); world.addChild(sc);
      return { def, mesh, shader, albedo, normals, ring, icon, sc, pos: { ...start }, state: 'idle' as const, moveTo: null, mine: null, cargo: 0, cargoRes: null, heading: 0 };
    });
    buildToolbar();
    // Stream textures in the background (Texture.from alone doesn't fetch reliably in v8).
    // Use the record returned by Assets.load — keyed by the exact url, no cache-id mismatch.
    Assets.load(albUrls).then((rec: Record<string, Texture>) => {
      for (const s of ships) s.albedo = Array.from({ length: ANGLES }, (_, k) => rec[frameUrl(s.def.id, k)] ?? s.albedo[k]);
    }).catch((e) => console.error('albedo load', e));
    Assets.load(nrmUrls).then((rec: Record<string, Texture>) => {
      for (const s of ships) {
        s.normals = Array.from({ length: ANGLES }, (_, k) => rec[normalUrl(s.def.id, k)] ?? FLAT_N);
        s.shader.resources.lightUniforms.uniforms.uStrength = SHIP_LIGHT_STR;   // enable normal lighting
      }
    }).catch((e) => console.error('normal load', e));
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
    buildBackground();
    fitCamera();
  }
  window.addEventListener('resize', onResize);

  // ---------- loop ----------
  let T = 0;
  function step(dt: number) {
    T += dt;
    for (const o of orbiters) { o.angle += o.speed * dt; o.c.x = Math.cos(o.angle) * o.orbit; o.c.y = Math.sin(o.angle) * o.orbit * ISO; }
    for (const s of spinners) { s.angle += s.speed * dt; s.c.x = s.parent.x + Math.cos(s.angle) * s.dist; s.c.y = s.parent.y + Math.sin(s.angle) * s.dist * ISO; }
    for (const b of shaded) b.spr.rotation = Math.atan2(-b.c.y / ISO, -b.c.x) - TEX_LIGHT_ANGLE;
    for (const r of belt) { r.angle += r.speed * dt; r.g.x = Math.cos(r.angle) * r.r; r.g.y = Math.sin(r.angle) * r.r * ISO; r.g.rotation += r.spin * dt; }
    for (const cm of comets) {
      cm.angle += cm.speed * dt;
      cm.c.x = Math.cos(cm.angle) * cm.rx; cm.c.y = Math.sin(cm.angle) * cm.ry * ISO;
      cm.tail.rotation = Math.atan2(cm.c.y, cm.c.x);  // tail points away from the star
    }

    const pulse = 0.55 + 0.45 * Math.sin(T * 6);
    fx.clear();
    for (const s of ships) {
      let desired = s.heading;
      if (s.state === 'mining' && s.mine) {
        // smoothly hug the (orbiting) body and stay synced as it moves
        const bp = s.mine.pos();
        let dx = s.pos.x - bp.x, dy = s.pos.y - bp.y; const len = Math.hypot(dx, dy) || 1;
        const rad = s.mine.radius + 14;
        const k = 1 - Math.exp(-9 * dt);
        s.pos.x += (bp.x + dx / len * rad - s.pos.x) * k;
        s.pos.y += (bp.y + dy / len * rad - s.pos.y) * k;
        desired = Math.atan2(bp.x - s.pos.x, -(bp.y - s.pos.y));
        s.cargoRes = s.mine.resource; s.cargo = Math.min(CARGO_CAP, s.cargo + MINE_RATE * dt);
        if (s.cargo >= CARGO_CAP) s.state = 'returning';
        // mining beam
        fx.moveTo(s.pos.x, s.pos.y).lineTo(bp.x, bp.y).stroke({ width: 2, color: RES_COLOR[s.mine.resource], alpha: 0.35 + 0.35 * pulse });
        fx.circle(bp.x, bp.y, 4 + 2 * pulse).fill({ color: RES_COLOR[s.mine.resource], alpha: 0.5 });
      } else {
        const dest: Vec | null = s.state === 'returning' ? { ...HQ } : s.state === 'moving' ? (s.mine ? s.mine.pos() : s.moveTo) : null;
        if (dest) {
          const dx = dest.x - s.pos.x, dy = dest.y - s.pos.y, d = Math.hypot(dx, dy);
          const arriveR = s.mine ? s.mine.radius + 14 : (s.state === 'returning' ? 22 : 4);
          if (d > arriveR) { const k = Math.min(1, SHIP_SPEED * dt / d); s.pos.x += dx * k; s.pos.y += dy * k; desired = Math.atan2(dx, -dy); }
          else if (s.state === 'moving') s.state = s.mine ? 'mining' : 'idle';
          else if (s.state === 'returning') { if (s.cargoRes && s.cargo > 0) { resources[s.cargoRes] += s.cargo; s.cargo = 0; s.cargoRes = null; } s.state = 'idle'; s.moveTo = null; }
        }
      }
      if (s.state === 'idle' && s.mine && s.cargo === 0) s.state = 'moving';

      // smooth turn toward desired heading (fills the gap between the 24 frames)
      s.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, angWrap(desired - s.heading)));
      const idx = ((Math.round((s.heading * 180 / Math.PI) / 15) % ANGLES) + ANGLES) % ANGLES;
      const resid = angWrap(s.heading - idx * 15 * Math.PI / 180);   // residual → continuous spin
      s.mesh.rotation = resid;
      const alb = s.albedo[idx] ?? s.albedo[0], nrm = s.normals[idx] ?? FLAT_N;
      if (alb) s.shader.resources.uAlbedo = alb.source;
      s.shader.resources.uNormal = nrm.source;
      // light each ship from the central star, in screen space (y-up), spin-compensated
      const u = s.shader.resources.lightUniforms.uniforms;
      const len = Math.hypot(s.pos.x, s.pos.y) || 1;
      u.uLight = [-s.pos.x / len, s.pos.y / len, SHIP_LIGHT_Z];   // ship→star; flip y (screen→y-up)
      u.uResid = -resid;

      // action indicator
      if (s.state === 'mining' && s.mine) {
        s.icon.visible = true; s.icon.clear();
        s.icon.circle(0, 0, 4 + pulse).stroke({ width: 1.5, color: RES_COLOR[s.mine.resource], alpha: 0.9 });
        s.icon.circle(0, 0, 1.5).fill({ color: RES_COLOR[s.mine.resource] });
      } else s.icon.visible = false;

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
  (window as any).__game = { ships, mineTargets, world };  // debug/test handle
  (window as any).__ready = true;
}
