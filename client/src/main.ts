// Stellar Frontier — 3D vertical slice (Three.js). The solar system lives on the XZ
// plane (Y up); the sun is at the origin and lights everything. Ships are real glTF
// models lit live (no baked sprites). Planets are procedural shader spheres. The HTML
// HUD (fleet bar, HQ stores, hint) is reused from the 2D slice.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makePlanet, makeStar, makeNebula, type Planet } from './planet.ts';
import { makeHQCity, type HQCity } from './hqcity.ts';
import {
  FACTIONS, PLANETS, GAS_NODES, RES_COLOR, RESOURCE_LABEL, type ResourceTag,
} from './data.ts';

const BASE = import.meta.env.BASE_URL;
// ship flight model (impulse: thrust forward + turn, with bounded accel — no sliding/snapping)
const MAX_SPEED = 170;      // units/s cruise
const ACCEL = 95;           // units/s^2 forward thrust
const DECEL = 130;          // units/s^2 braking
const MAX_OMEGA = 2.0;      // rad/s max turn rate
const ANG_ACCEL = 5.0;      // rad/s^2 turn accel
const MINE_RATE = 22;
const CARGO_CAP = 100;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const HQ = new THREE.Vector3(250, 0, -300);   // live position; updated each frame (orbits the home planet)
const HOME_PLANET = 'Verdantia';   // HQ station orbits this world
const SHIP_Y = 6;                  // hover height above the orbital plane
const BELT_R = 505;                // belt sits in the gap between Bronce (420) and Halcyon (630)

type Vec = { x: number; z: number };
interface MineTarget { name: string; resource: ResourceTag; radius: number; pos(): THREE.Vector3; }
interface Ship {
  def: typeof FACTIONS[number]; obj: THREE.Object3D; disc: THREE.Mesh; destMarker: THREE.Mesh;
  beam: THREE.Mesh; path: THREE.Line;
  pos: Vec; heading: number; speed: number; omega: number; docked: boolean;
  state: 'idle' | 'moving' | 'mining' | 'returning';
  moveTo: Vec | null; mine: MineTarget | null; cargo: number; cargoRes: ResourceTag | null;
  system: number; voyage: { route: number[]; i: number; t: number } | null;   // interstellar travel
}

const resources: Record<ResourceTag, number> = {
  animals: 0, plants: 0, underwater: 0, minerals: 0, tourism: 0, ore: 0, crystal: 0, gas: 0,
};
const mineTargets: MineTarget[] = [];
let ships: Ship[] = [];
let selected = 0;

const showErr = (m: string) => { const h = document.getElementById('hint'); if (h) h.textContent = m; };
window.addEventListener('error', (e) => showErr('Error: ' + e.message));
window.addEventListener('unhandledrejection', (e: any) => showErr('Error: ' + (e.reason?.message || e.reason)));
const seedFor = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h % 1000) / 7.3; };

main().catch((err) => { showErr('Boot error: ' + (err?.message || err)); console.error(err); });

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  document.getElementById('game')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // narrow FOV + large distance → near-orthographic with a touch of perspective
  const camera = new THREE.PerspectiveCamera(20, innerWidth / innerHeight, 1, 40000);
  camera.position.set(0, 2600, 3350);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enableRotate = false;             // fixed near-ortho angle, never rotates
  controls.screenSpacePanning = false;       // left-drag pans across the orbital plane
  controls.minDistance = 400; controls.maxDistance = 12000;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };   // mobile: drag to pan, pinch to zoom

  // ---------- lighting (for the glTF ships; planets self-shade in their shaders) ----------
  // Light ships from the star itself (origin, in the orbital plane) so their sunlit side
  // matches the planets' terminator. A slight lift keeps decks from going fully flat
  // without breaking that consistency; low fill keeps the direction readable.
  // Ships are lit EXACTLY like the planets: the star is a PointLight at the origin (in the
  // orbital plane) plus a tiny ambient — and NOTHING else. No environment/IBL fill, because
  // the planets have none; that fill was what made ships look flat and inconsistent.
  const sunLight = new THREE.PointLight(0xfff2d8, 4.0, 0, 0); // decay 0 → constant across the system
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xb9c8e0, 0.22));   // a bit of ambient on every object (matches planet ambient)

  // ---------- background: starfield + nebula dome ----------
  const nebulaTex = makeNebula(renderer);    // baked raymarched volumetric nebula (static cubemap)
  scene.background = nebulaTex;
  buildStars(scene);
  addPolarGrid(scene, 1450);

  // ---------- the star ----------
  const star = makeStar(30);
  scene.add(star.group);

  // ---------- planets / moons / gas nodes ----------
  interface Orbiter { group: THREE.Group; planet: Planet; orbit: number; angle: number; speed: number; }
  const orbiters: Orbiter[] = [];
  interface Spinner { group: THREE.Group; planet: Planet; parent: THREE.Group; dist: number; angle: number; speed: number; }
  const spinners: Spinner[] = [];
  const hoverMeshes: { mesh: THREE.Object3D; html: string }[] = [];
  const labels: { el: HTMLDivElement; obj: THREE.Object3D; off: number }[] = [];
  let homePlanet: THREE.Group | null = null; let homeR = 22;   // HQ orbits this planet

  const mkLabel = (text: string, obj: THREE.Object3D, off: number, cls = 'world-label') => {
    const el = document.createElement('div'); el.className = cls; el.textContent = text;
    document.body.appendChild(el); labels.push({ el, obj, off });
  };

  for (const p of PLANETS) {
    const pl = makePlanet({ radius: p.size, color: p.color, gas: p.type === 'gas', seed: seedFor(p.name) });
    const g = pl.group;
    g.position.set(Math.cos(p.angle0) * p.orbit, 0, Math.sin(p.angle0) * p.orbit);
    scene.add(g);
    orbiters.push({ group: g, planet: pl, orbit: p.orbit, angle: p.angle0, speed: p.speed });
    if (p.name === HOME_PLANET) { homePlanet = g; homeR = p.size; }
    if (p.type === 'gas') addRings(g, p.size, p.color);
    mkLabel(p.name, g, p.size + 12);
    hoverMeshes.push({ mesh: g, html: `<div class="t-name">${p.name}${p.type === 'gas' ? ' (gas giant)' : ''}</div><div class="t-tags">${p.tags.map((t) => RESOURCE_LABEL[t]).join(', ')}</div>` });

    if (p.type === 'gas') {
      for (let n = 0; n < GAS_NODES; n++) {
        const na = (n / GAS_NODES) * Math.PI * 2, nd = p.size + 26;
        const node = new THREE.Mesh(
          new THREE.SphereGeometry(5, 16, 12),
          new THREE.MeshBasicMaterial({ color: RES_COLOR.gas }));
        node.position.set(Math.cos(na) * nd, 0, Math.sin(na) * nd);
        g.add(node);
        const mt: MineTarget = { name: `${p.name} node ${n + 1}`, resource: 'gas', radius: 12, pos: () => node.getWorldPosition(new THREE.Vector3()) };
        mineTargets.push(mt);
        hoverMeshes.push({ mesh: node, html: `<div class="t-name">${mt.name}</div><div class="t-tags">gas</div>` });
        (node.userData as any).mine = mt;
      }
    } else {
      const mt: MineTarget = { name: p.name, resource: p.primary, radius: p.size + 8, pos: () => g.getWorldPosition(new THREE.Vector3()) };
      mineTargets.push(mt); (g.userData as any).mine = mt;
    }

    for (const m of (p.moons ?? [])) {
      const ml = makePlanet({ radius: m.size, color: 0xc2c8d2, gas: false, seed: seedFor(m.name) });
      const mg = ml.group;
      mg.position.set(g.position.x + Math.cos(m.angle0) * m.dist, 0, g.position.z + Math.sin(m.angle0) * m.dist);
      scene.add(mg);
      spinners.push({ group: mg, planet: ml, parent: g, dist: m.dist, angle: m.angle0, speed: m.speed });
      const mt: MineTarget = { name: m.name, resource: m.resource, radius: m.size + 6, pos: () => mg.getWorldPosition(new THREE.Vector3()) };
      mineTargets.push(mt); (mg.userData as any).mine = mt;
      hoverMeshes.push({ mesh: mg, html: `<div class="t-name">${m.name} (moon)</div><div class="t-tags">${RESOURCE_LABEL[m.resource]}</div>` });
    }
  }

  // ---------- HQ (a station orbiting the home planet) ----------
  const HQ_DIST = homeR + 34; let hqAngle = 0.6;
  const updateHQ = (t: number) => {
    hqAngle = 0.6 + t * 0.25;
    const c = homePlanet ? homePlanet.position : new THREE.Vector3();
    HQ.set(c.x + Math.cos(hqAngle) * HQ_DIST, 0, c.z + Math.sin(hqAngle) * HQ_DIST);
  };
  updateHQ(0);
  const hq = new THREE.Group(); hq.position.copy(HQ); scene.add(hq);
  const hqMesh = new THREE.Mesh(new THREE.OctahedronGeometry(10),
    new THREE.MeshStandardMaterial({ color: 0x9fd6ff, emissive: 0x2a6ea0, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
  hq.add(hqMesh);
  hq.add(new THREE.Mesh(new THREE.TorusGeometry(15, 1.0, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x5ec8ff }))).rotation.x = Math.PI / 2;
  mkLabel('HQ', hq, 18, 'world-label hq');

  // ---------- asteroid belt (in the clear gap between Bronce and the gas giants) ----------
  addBelt(scene);
  for (const [frac, res] of [[0.2, 'ore'], [0.65, 'crystal']] as const) {
    const a = frac * Math.PI * 2, r = BELT_R;
    const cluster = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 0),
      new THREE.MeshStandardMaterial({ color: res === 'ore' ? 0xb98a5a : 0x9be8ff, emissive: res === 'ore' ? 0x3a2a14 : 0x184a55, roughness: 0.8, metalness: 0.2, flatShading: true }));
    cluster.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); scene.add(cluster);
    const mt: MineTarget = { name: res === 'ore' ? 'Ore Field' : 'Crystal Field', resource: res, radius: 16, pos: () => cluster.position.clone() };
    mineTargets.push(mt); (cluster.userData as any).mine = mt;
    hoverMeshes.push({ mesh: cluster, html: `<div class="t-name">${mt.name}</div><div class="t-tags">${RESOURCE_LABEL[res]}</div>` });
  }


  // ---------- fleet (glTF ships) ----------
  const loader = new GLTFLoader();
  const discGeo = new THREE.RingGeometry(14.5, 17.5, 44);     // faint flat ring under each ship (hover/select target)
  const destGeo = new THREE.RingGeometry(9, 12, 44);          // pulsing destination marker
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  await Promise.all(FACTIONS.map(async (def, i) => {
    let obj: THREE.Object3D;
    try {
      const gltf = await loader.loadAsync(`${BASE}models/${def.id}.glb`);
      obj = gltf.scene;
      // normalize size: scale longest bbox axis to ~24 units
      const box = new THREE.Box3().setFromObject(obj); const size = new THREE.Vector3(); box.getSize(size);
      const s = 24 / Math.max(size.x, size.y, size.z); obj.scale.setScalar(s);
      // Shade hulls diffusely (like the planets) so the star's direction reads: tame
      // metalness and raise roughness (no environment map, so metal would read black).
      obj.traverse((o: any) => {
        if (!o.isMesh) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m) continue;
          if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.15);
          if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.65);
          // drop mesh-emissive "glow spots" for now (proper emissive textures come later)
          if (m.emissive) { m.emissive.setHex(0x000000); m.emissiveIntensity = 0; m.emissiveMap = null; }
        }
      });
    } catch (e) {
      obj = new THREE.Mesh(new THREE.ConeGeometry(6, 18, 6), new THREE.MeshStandardMaterial({ color: def.color }));
      console.error('ship load', def.id, e);
    }
    const holder = new THREE.Group(); holder.add(obj);
    const start = { x: HQ.x + (i - 3.5) * 34, z: HQ.z + (i % 2 ? 26 : 54) };
    holder.position.set(start.x, SHIP_Y, start.z); scene.add(holder);
    (holder.userData as any).shipIndex = i;

    // faint disc under every ship — always visible, glows on hover, brightest when selected.
    // It's also the click/hover target (big & flat = easy to hit).
    const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0x4a90c0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(start.x, 1, start.z); (disc.userData as any).shipIndex = i; scene.add(disc);
    // pulsing ring at the ordered destination
    const destMarker = new THREE.Mesh(destGeo, new THREE.MeshBasicMaterial({ color: 0x6fd2ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    destMarker.rotation.x = -Math.PI / 2; destMarker.visible = false; scene.add(destMarker);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.visible = false; scene.add(beam);
    // dashed trajectory line = the EXACT predicted flight path (rebuilt each frame)
    const path = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0x6fd2ff, transparent: true, opacity: 0.6, dashSize: 9, gapSize: 7 }));
    path.visible = false; scene.add(path);

    ships[i] = { def, obj: holder, disc, destMarker, beam, path, pos: { ...start }, heading: 0, speed: 0, omega: 0, docked: true, state: 'idle', moveTo: null, mine: null, cargo: 0, cargoRes: null, system: 0, voyage: null };
  }));

  // ---------- raycasting: select ships / move / mine ----------
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  let downX = 0, downY = 0;
  let hovered = -1;   // ship index under the cursor (disc glows)
  renderer.domElement.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    const moved = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (hqOpen) { if (!moved && hqCity) { hqSel = hqCity.pick(ndc); renderHQPanel(); } return; }   // HQ city: click a building
    if (moved) return;   // was a camera drag
    ray.setFromCamera(ndc, camera);
    // 1) ship? select via its ring or hull (whole footprint is clickable)
    const discHits = ray.intersectObjects(ships.flatMap((s) => [s.disc, s.obj]), true);
    if (discHits.length) { let o: THREE.Object3D | null = discHits[0].object; while (o && (o.userData as any).shipIndex === undefined) o = o.parent; if (o) { selectShip((o.userData as any).shipIndex); return; } }
    // 2) mine target?
    const mineHits = ray.intersectObjects(mineTargets.length ? hoverMeshes.map((h) => h.mesh) : [], true);
    let mh: THREE.Object3D | null = mineHits[0]?.object ?? null;
    while (mh && !(mh.userData as any).mine) mh = mh.parent;
    const s = ships[selected];
    if (mh && (mh.userData as any).mine && s) { s.mine = (mh.userData as any).mine; s.moveTo = null; s.state = 'moving'; s.docked = false; flashHint(`${s.def.name} → mining ${s.mine!.name}`); return; }
    // 3) empty space → undock (if docked) and move on the plane
    const hit = new THREE.Vector3();
    if (s && ray.ray.intersectPlane(ground, hit)) { const wasDocked = s.docked; s.moveTo = { x: hit.x, z: hit.z }; s.mine = null; s.state = 'moving'; s.docked = false; flashHint(`${s.def.name} → ${wasDocked ? 'undocking, ' : ''}moving`); }
  });

  // ---------- HUD ----------
  const tip = document.getElementById('tooltip')!;
  const hintEl = document.getElementById('hint')!;
  const resEl = document.getElementById('resources')!;
  const fleetEl = document.getElementById('fleet')!;
  const recallBtn = document.createElement('button'); recallBtn.className = 'recall'; recallBtn.textContent = 'Recall ship';
  document.body.appendChild(recallBtn);
  recallBtn.onclick = () => { const s = ships[selected]; if (!s) return; s.mine = null; s.moveTo = { x: HQ.x, z: HQ.z }; s.state = 'returning'; flashHint(`${s.def.name} → recalled to HQ`); };
  let hintTimer = 0;
  const DEFAULT_HINT = 'Drag to orbit · scroll to zoom · click a ship to select, then click a planet/node to mine or empty space to move.';
  function flashHint(m: string) { hintEl.textContent = m; hintTimer = 3; }
  function selectShip(i: number) { selected = i; [...fleetEl.children].forEach((c, j) => c.classList.toggle('selected', j === selected)); const s = ships[i]; if (s) flashHint(`${s.def.name} selected`); }
  function buildToolbar() {
    fleetEl.innerHTML = '';
    ships.forEach((s, i) => {
      const b = document.createElement('div'); b.className = 'ship-btn' + (i === selected ? ' selected' : '');
      b.innerHTML = `<div class="hq-badge" data-b="${i}" title="docked at HQ">HQ</div><img src="${BASE}sprites/${s.def.id}_y000.png" alt=""><div class="s-name">${s.def.name}</div><div class="s-stat" data-i="${i}">idle</div>`;
      b.onclick = () => selectShip(i); fleetEl.appendChild(b);
    });
  }
  function updateHud() {
    [...fleetEl.querySelectorAll('.s-stat')].forEach((el) => {
      const i = +(el as HTMLElement).dataset.i!; const s = ships[i]; if (!s) return;
      el.className = 's-stat ' + (s.state === 'mining' ? 'mining' : s.state === 'returning' ? 'returning' : s.state === 'moving' ? 'moving' : '');
      el.textContent = s.state === 'mining' ? `mining ${Math.round(s.cargo)}%` : s.state;
    });
    [...fleetEl.querySelectorAll('.hq-badge')].forEach((el) => {
      const i = +(el as HTMLElement).dataset.b!; const s = ships[i];
      (el as HTMLElement).style.display = s && s.docked ? 'block' : 'none';
    });
    resEl.innerHTML = `<h3>HQ Stores</h3>` + (Object.keys(resources) as ResourceTag[])
      .map((k) => `<div class="res-row"><span class="k">${RESOURCE_LABEL[k]}</span><span class="v">${Math.floor(resources[k])}</span></div>`).join('');
    recallBtn.disabled = !ships[selected];
  }

  // ---------- HQ city + galaxy map screens ----------
  const navBar = document.createElement('div'); navBar.className = 'navbar'; document.body.appendChild(navBar);
  const hqBtn = document.createElement('button'); hqBtn.className = 'nav-btn'; hqBtn.textContent = 'HQ City';
  const galBtn = document.createElement('button'); galBtn.className = 'nav-btn'; galBtn.textContent = 'Galaxy Map';
  navBar.append(hqBtn, galBtn);

  const FACILITIES = [
    { key: 'admin', name: 'Admin Spire', desc: 'Command hub — raises fleet & build capacity.', base: { ore: 40, crystal: 20 } as Partial<Record<ResourceTag, number>> },
    { key: 'crew', name: 'Crew Quarters', desc: 'Houses crew for your ships.', base: { ore: 30, plants: 15 } },
    { key: 'lab', name: 'Research Lab', desc: 'Unlocks and speeds up research.', base: { crystal: 35, minerals: 15 } },
    { key: 'academy', name: 'Academy', desc: 'Trains officers and pilots.', base: { crystal: 25, plants: 20 } },
    { key: 'shipyard', name: 'Shipyard', desc: 'Builds and refits ships.', base: { ore: 60, crystal: 30 } },
    { key: 'trade', name: 'Trading Post', desc: 'Markets, prices and contracts.', base: { gas: 25, minerals: 20 } },
    { key: 'foundry', name: 'Foundry', desc: 'Refines ore into alloys.', base: { ore: 50, gas: 20 } },
    { key: 'sensors', name: 'Sensor Array', desc: 'Reveals systems & detects fleets.', base: { crystal: 30, gas: 25 } },
  ];
  const facLevel: Record<string, number> = {}; FACILITIES.forEach((f) => (facLevel[f.key] = 1));
  const costOf = (f: typeof FACILITIES[number], lvl: number) =>
    Object.entries(f.base).map(([k, v]) => [k as ResourceTag, Math.round((v as number) * Math.pow(1.6, lvl - 1))] as const);

  // HQ City is an interactive 3D scene (see hqcity.ts); this HTML panel rides on top of it.
  let hqCity: HQCity | null = null, hqOpen = false, hqSel: string | null = null;
  const hqUI = document.createElement('div'); hqUI.className = 'hq-ui'; hqUI.hidden = true; document.body.appendChild(hqUI);
  function renderHQPanel() {
    const f = FACILITIES.find((x) => x.key === hqSel);
    const detail = f ? (() => {
      const lvl = facLevel[f.key]; const cost = costOf(f, lvl);
      const afford = cost.every(([k, v]) => resources[k] >= v);
      const costStr = cost.map(([k, v]) => `${RESOURCE_LABEL[k]} ${v}`).join(' · ');
      return `<div class="hq-sel"><div class="fac-top"><span class="fac-name">${f.name}</span><span class="fac-lvl">Lv ${lvl}</span></div>
        <div class="fac-desc">${f.desc}</div><div class="fac-cost">Upgrade cost: ${costStr}</div>
        <button class="fac-up" ${afford ? '' : 'disabled'}>Upgrade to Lv ${lvl + 1}</button></div>`;
    })() : `<div class="hq-hint">Click a building to inspect and upgrade it. Drag to orbit · scroll to zoom.</div>`;
    hqUI.innerHTML = `<div class="hq-head"><h2>Headquarters — Thallian Reach</h2><button class="ov-close">✕</button></div>${detail}`;
    hqUI.querySelector('.ov-close')!.addEventListener('click', closeHQ);
    const up = hqUI.querySelector<HTMLButtonElement>('.fac-up');
    if (up && f) up.addEventListener('click', () => {
      const cost = costOf(f, facLevel[f.key]);
      if (cost.every(([k, v]) => resources[k] >= v)) { cost.forEach(([k, v]) => (resources[k] -= v)); facLevel[f.key]++; hqCity!.refresh(f.key, facLevel[f.key]); renderHQPanel(); updateHud(); }
    });
  }
  function openHQ() {
    if (!hqCity) hqCity = makeHQCity(renderer, nebulaTex, FACILITIES, (k) => facLevel[k]);
    hqCity.resize(innerWidth, innerHeight); hqCity.setEnabled(true);
    hqOpen = true; controls.enabled = false; hqSel = null; hqUI.hidden = false; renderHQPanel();
    for (const L of labels) L.el.style.display = 'none';   // hide system world-labels behind the city
    tip.hidden = true;
  }
  function closeHQ() { hqOpen = false; hqUI.hidden = true; controls.enabled = true; if (hqCity) hqCity.setEnabled(false); renderer.domElement.style.cursor = 'default'; }
  hqBtn.onclick = openHQ;

  // ---------- galaxy data + interstellar travel ----------
  let galaxy: { systems: any[]; links: number[][]; meta: any } | null = null;
  let adj: [number, number][][] = []; let medLen = 1;
  try { galaxy = await fetch(`${BASE}data/galaxy.json`).then((r) => r.json()); } catch (e) { console.error('galaxy load', e); }
  if (galaxy) {
    adj = galaxy.systems.map(() => [] as [number, number][]);
    const lens: number[] = [];
    for (const [a, b] of galaxy.links) { const L = Math.hypot(galaxy.systems[a].x - galaxy.systems[b].x, galaxy.systems[a].y - galaxy.systems[b].y); adj[a].push([b, L]); adj[b].push([a, L]); lens.push(L); }
    lens.sort((x, y) => x - y); medLen = lens[lens.length >> 1] || 1;
  }
  const segSeconds = (a: number, b: number) => { const L = Math.hypot(galaxy!.systems[a].x - galaxy!.systems[b].x, galaxy!.systems[a].y - galaxy!.systems[b].y); return 60 * Math.max(0.4, Math.min(2.5, L / medLen)); };  // ~1 min/segment
  function routeTo(from: number, to: number): number[] | null {
    if (!galaxy || from === to) return from === to ? [from] : null;
    const N = galaxy.systems.length, dist = Array(N).fill(Infinity), prev = Array(N).fill(-1), vis = Array(N).fill(false); dist[from] = 0;
    for (let k = 0; k < N; k++) { let u = -1, bd = Infinity; for (let i = 0; i < N; i++) if (!vis[i] && dist[i] < bd) { bd = dist[i]; u = i; } if (u < 0) break; vis[u] = true; if (u === to) break; for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; } }
    if (dist[to] === Infinity) return null; const path: number[] = []; for (let c = to; c >= 0; c = prev[c]) path.unshift(c); return path;
  }
  const routeEta = (route: number[]) => { let s = 0; for (let i = 0; i + 1 < route.length; i++) s += segSeconds(route[i], route[i + 1]); return s; };
  // galaxy-space position of a ship (interpolated along its current voyage segment)
  function shipGalPos(s: Ship): { x: number; y: number } {
    if (s.voyage) { const v = s.voyage, a = galaxy!.systems[v.route[v.i]], b = galaxy!.systems[v.route[v.i + 1]], f = v.t / segSeconds(v.route[v.i], v.route[v.i + 1]); return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
    const a = galaxy!.systems[s.system]; return { x: a.x, y: a.y };
  }
  function departTo(s: Ship, route: number[]) { s.voyage = { route, i: 0, t: 0 }; s.docked = false; s.mine = null; s.moveTo = null; s.state = 'idle'; s.speed = 0; }
  function onArrive(s: Ship) { if (s.system === 0) { s.pos = { x: HQ.x, z: HQ.z }; s.heading = 0; s.speed = 0; s.state = 'idle'; s.docked = true; } }

  // ---------- galaxy map overlay ----------
  const galOverlay = document.createElement('div'); galOverlay.className = 'overlay'; galOverlay.hidden = true; document.body.appendChild(galOverlay);
  let galOpen = false, galHover = -1, galScreen: { x: number; y: number }[] = [], galTf = { px: (x: number) => x, py: (y: number) => y };
  let galCv: HTMLCanvasElement | null = null, galLabel: HTMLElement | null = null;
  function buildGalaxyUI() {
    galOverlay.innerHTML = `<div class="ov-panel ov-wide"><div class="ov-head"><h2>Local Cluster — ${galaxy!.systems.length} systems</h2><button class="ov-close">✕</button></div>
      <div class="ov-sub">Select a ship, then click a system to send it (~1 min per jump lane). Hover a star for details.</div>
      <canvas class="galcanvas" width="980" height="600"></canvas><div class="gal-label"></div></div>`;
    galCv = galOverlay.querySelector('.galcanvas'); galLabel = galOverlay.querySelector('.gal-label');
    const g = galaxy!, W = galCv!.width, H = galCv!.height, R = g.meta.radius * 1.1, sc = Math.min((W / 2) / R, (H / 2) / R);
    galTf = { px: (x) => W / 2 + x * sc, py: (y) => H / 2 + y * sc };
    galScreen = g.systems.map((s) => ({ x: galTf.px(s.x), y: galTf.py(s.y) }));
    galOverlay.querySelector('.ov-close')!.addEventListener('click', () => { galOpen = false; galOverlay.hidden = true; });
    const toCanvas = (e: MouseEvent) => { const rect = galCv!.getBoundingClientRect(); return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) }; };
    const nearest = (m: { x: number; y: number }) => { let best = -1, bd = 169; galScreen.forEach((p, i) => { const d = (p.x - m.x) ** 2 + (p.y - m.y) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };
    galCv!.onmousemove = (e) => {
      galHover = nearest(toCanvas(e));
      if (galLabel) { const s = ships[selected]; if (galHover >= 0) { const sy = g.systems[galHover]; const r = s ? routeTo(s.system, galHover) : null; const eta = r && r.length > 1 ? `  ·  ${Math.round(routeEta(r))}s via ${r.length - 1} jump${r.length > 2 ? 's' : ''}` : ''; galLabel.textContent = `${sy.name} · ${sy.star.class}-class · ${sy.planets} planets${galHover === 0 ? ' · HOME' : ''}${eta}`; } else galLabel.textContent = ''; }
    };
    galCv!.onclick = (e) => {
      const i = nearest(toCanvas(e)); const s = ships[selected]; if (i < 0 || !s) return;
      if (s.voyage) { flashHint(`${s.def.name} is already in transit`); return; }
      if (i === s.system) { flashHint(`${s.def.name} is already there`); return; }
      const r = routeTo(s.system, i); if (!r) { flashHint('no route'); return; }
      departTo(s, r); flashHint(`${s.def.name} → ${g.systems[i].name} (${Math.round(routeEta(r))}s)`);
    };
  }
  galBtn.onclick = () => { if (!galaxy) return; galOpen = true; galOverlay.hidden = false; buildGalaxyUI(); };
  function renderGalaxy() {
    if (!galCv || !galaxy) return; const ctx = galCv.getContext('2d')!; const W = galCv.width, H = galCv.height, g = galaxy;
    ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(110,150,210,0.16)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const [a, b] of g.links) { ctx.moveTo(galScreen[a].x, galScreen[a].y); ctx.lineTo(galScreen[b].x, galScreen[b].y); } ctx.stroke();
    // route preview for the selected ship to the hovered system
    const sel = ships[selected];
    if (sel && galHover >= 0 && !sel.voyage) { const r = routeTo(sel.system, galHover); if (r && r.length > 1) { ctx.strokeStyle = '#7fdcff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(galScreen[r[0]].x, galScreen[r[0]].y); for (const n of r.slice(1)) ctx.lineTo(galScreen[n].x, galScreen[n].y); ctx.stroke(); } }
    // active voyages
    ctx.strokeStyle = 'rgba(127,220,255,0.5)'; ctx.setLineDash([5, 5]);
    for (const s of ships) if (s.voyage) { const v = s.voyage; ctx.beginPath(); ctx.moveTo(galScreen[v.route[v.i]].x, galScreen[v.route[v.i]].y); for (let k = v.i + 1; k < v.route.length; k++) ctx.lineTo(galScreen[v.route[k]].x, galScreen[v.route[k]].y); ctx.stroke(); }
    ctx.setLineDash([]);
    g.systems.forEach((s, i) => {
      const rad = i === 0 ? 5 : 2.6 + (s.planets > 9 ? 1.4 : 0);
      ctx.beginPath(); ctx.fillStyle = '#' + (s.star.color as number).toString(16).padStart(6, '0'); ctx.arc(galScreen[i].x, galScreen[i].y, i === galHover ? rad + 2 : rad, 0, 7); ctx.fill();
      if (i === 0) { ctx.strokeStyle = '#7fdcff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(galScreen[i].x, galScreen[i].y, 9, 0, 7); ctx.stroke(); }
    });
    // fleet markers
    ships.forEach((s, i) => {
      const gp = shipGalPos(s), x = galTf.px(gp.x), y = galTf.py(gp.y);
      ctx.fillStyle = '#' + s.def.color.toString(16).padStart(6, '0');
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 4, y + 4); ctx.lineTo(x - 4, y + 4); ctx.closePath(); ctx.fill();
      if (i === selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke(); }
    });
  }
  window.addEventListener('pointermove', (e) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (hqOpen) { if (hqCity) hqCity.setHover(hqCity.pick(ndc)); return; }   // HQ city: hover buildings
    tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
    ray.setFromCamera(ndc, camera);
    // ship rings glow on hover (ring or hull both count)
    const discHits = ray.intersectObjects(ships.filter(Boolean).flatMap((s) => [s.disc, s.obj]), true);
    let ho: THREE.Object3D | null = discHits[0]?.object ?? null;
    while (ho && (ho.userData as any).shipIndex === undefined) ho = ho.parent;
    hovered = ho ? (ho.userData as any).shipIndex : -1;
    renderer.domElement.style.cursor = hovered >= 0 ? 'pointer' : 'default';
    const hits = ray.intersectObjects(hoverMeshes.map((h) => h.mesh), true);
    if (hits.length) { let o: THREE.Object3D | null = hits[0].object; const found = hoverMeshes.find((h) => { let x: THREE.Object3D | null = o; while (x) { if (x === h.mesh) return true; x = x.parent; } return false; }); if (found) { tip.innerHTML = found.html; tip.hidden = false; return; } }
    tip.hidden = true;
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (hqCity) hqCity.resize(innerWidth, innerHeight);
  });

  // ---------- loop ----------
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  let hudAcc = 0;
  function frame() {
    const dt = Math.min(0.05, clock.getDelta()); const T = clock.elapsedTime;
    if (hqOpen && hqCity) { hqCity.update(dt); renderer.render(hqCity.scene, hqCity.camera); requestAnimationFrame(frame); return; }
    controls.update();
    star.update(dt, camera.position);

    for (const o of orbiters) { o.angle += o.speed * dt; o.group.position.set(Math.cos(o.angle) * o.orbit, 0, Math.sin(o.angle) * o.orbit); o.planet.update(dt, camera.position); }
    for (const s of spinners) { s.angle += s.speed * dt; s.group.position.set(s.parent.position.x + Math.cos(s.angle) * s.dist, 0, s.parent.position.z + Math.sin(s.angle) * s.dist); s.planet.update(dt, camera.position); }
    updateHQ(T); hq.position.copy(HQ); hq.rotation.y = T * 0.3;   // station orbits the home planet


    // advance interstellar voyages (~1 min per jump-lane segment), even while the map is closed
    if (galaxy) for (const s of ships) {
      if (!s || !s.voyage) continue; const v = s.voyage; v.t += dt;
      if (v.t >= segSeconds(v.route[v.i], v.route[v.i + 1])) { v.t = 0; v.i++; if (v.i >= v.route.length - 1) { s.system = v.route[v.route.length - 1]; s.voyage = null; onArrive(s); } }
    }
    if (galOpen) renderGalaxy();

    const pulse = 0.55 + 0.45 * Math.sin(T * 6);
    const destPulse = 1 + 0.28 * Math.sin(T * 3.2);   // destination ring breathes
    for (let idx = 0; idx < ships.length; idx++) {
      const s = ships[idx];
      if (!s) continue;
      s.beam.visible = false;
      // ships away from the home system (or mid-jump) aren't shown in the local view
      const away = !!s.voyage || s.system !== 0;
      s.obj.visible = !away; s.disc.visible = !away;
      if (away) { s.path.visible = false; s.destMarker.visible = false; continue; }

      // resolve where this ship is headed (and what to draw the trajectory to)
      let dest: Vec | null = null, arriveR = 6, lineTo: Vec | null = null;
      if (s.state === 'returning') { dest = { x: HQ.x, z: HQ.z }; arriveR = 20; lineTo = dest; }
      else if (s.state === 'moving' && s.mine) { const bp = s.mine.pos(); dest = dockPoint(s, bp, s.mine.radius); arriveR = 8; lineTo = { x: bp.x, z: bp.z }; }
      else if (s.state === 'moving' && s.moveTo) { dest = s.moveTo; arriveR = 5; lineTo = dest; }
      else if (s.state === 'mining' && s.mine) { const bp = s.mine.pos(); dest = dockPoint(s, bp, s.mine.radius); arriveR = 8; lineTo = { x: bp.x, z: bp.z }; }

      if (dest) {
        const arrived = steer(s, dest, arriveR, dt);   // thrust + turn with bounded accel
        if (arrived) {
          if (s.state === 'moving') s.state = s.mine ? 'mining' : 'idle';
          else if (s.state === 'returning') { if (s.cargoRes && s.cargo > 0) { resources[s.cargoRes] += s.cargo; s.cargo = 0; s.cargoRes = null; } s.state = 'idle'; s.moveTo = null; s.docked = true; }
        }
      } else {
        coast(s, dt);   // idle: ease thrust + turn to zero and glide to a stop
      }

      if (s.state === 'mining' && s.mine) {
        s.cargoRes = s.mine.resource; s.cargo = Math.min(CARGO_CAP, s.cargo + MINE_RATE * dt);
        if (s.cargo >= CARGO_CAP) s.state = 'returning';
        drawBeam(s, s.mine.pos(), pulse);
      }
      if (s.state === 'idle' && s.mine && s.cargo === 0) s.state = 'moving';

      // glTF nose points -Z → rotate by heading+π so the nose leads
      s.obj.position.set(s.pos.x, SHIP_Y, s.pos.z); s.obj.rotation.y = s.heading + Math.PI;

      // faint disc under every ship; glow on hover, brightest when selected
      s.disc.position.set(s.pos.x, 1, s.pos.z);
      const dm = s.disc.material as THREE.MeshBasicMaterial;
      const sel = selected === idx, hov = hovered === idx;
      dm.opacity = sel ? 0.5 : hov ? 0.4 : 0.12;
      dm.color.setHex(sel ? 0x9fe6ff : hov ? 0x8fd8ff : 0x4a90c0);

      // pulsing destination marker
      if (lineTo) { s.destMarker.visible = true; s.destMarker.position.set(lineTo.x, 1.5, lineTo.z); s.destMarker.scale.setScalar(destPulse); }
      else s.destMarker.visible = false;

      updatePath(s, dest, arriveR);   // EXACT predicted flight path
    }

    // billboard HTML labels
    for (const L of labels) {
      L.obj.getWorldPosition(tmp); tmp.y += L.off; tmp.project(camera);
      const vis = tmp.z < 1;
      L.el.style.display = vis ? 'block' : 'none';
      if (vis) { L.el.style.left = (tmp.x * 0.5 + 0.5) * innerWidth + 'px'; L.el.style.top = (-tmp.y * 0.5 + 0.5) * innerHeight + 'px'; }
    }

    hudAcc += dt; if (hudAcc > 0.15) { updateHud(); hudAcc = 0; }
    if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hintEl.textContent = DEFAULT_HINT; }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  hintEl.textContent = DEFAULT_HINT;
  buildToolbar();
  updateHud();
  frame();
  (window as any).__game = { ships, mineTargets, scene, camera, controls, galaxy, routeTo, departTo };
  (window as any).__ready = true;

  // ---- helpers that need beam geometry ----
  function drawBeam(s: Ship, bp: THREE.Vector3, pulse: number) {
    const a = new THREE.Vector3(s.pos.x, SHIP_Y, s.pos.z); const b = bp.clone();
    const mid = a.clone().add(b).multiplyScalar(0.5); const len = a.distanceTo(b);
    s.beam.position.copy(mid); s.beam.scale.set(1.2, len, 1.2);
    s.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    (s.beam.material as THREE.MeshBasicMaterial).color.setHex(RES_COLOR[s.mine!.resource]);
    (s.beam.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.35 * pulse;
    s.beam.visible = true;
  }
}

const angWrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// --- ship flight model: forward thrust + turning, all with bounded acceleration ---
// Heading θ → forward = (sinθ, cosθ). The ship only moves along its nose (no sliding).
// navStep advances ONE nav state by dt and returns whether it has arrived. The live
// ship and the trajectory prediction both run this exact function → the drawn path is
// the ship's real future motion.
interface NavState { x: number; z: number; heading: number; speed: number; omega: number; }
function navStep(st: NavState, T: Vec, arriveR: number, dt: number): boolean {
  const dx = T.x - st.x, dz = T.z - st.z;
  const dist = Math.hypot(dx, dz);
  const err = angWrap(Math.atan2(dx, dz) - st.heading);
  const omegaDes = clamp(Math.sign(err) * Math.sqrt(2 * ANG_ACCEL * Math.abs(err)), -MAX_OMEGA, MAX_OMEGA);
  st.omega += clamp(omegaDes - st.omega, -ANG_ACCEL * dt, ANG_ACCEL * dt);
  st.heading = angWrap(st.heading + st.omega * dt);
  const face = Math.max(0, Math.cos(err));
  const vDes = Math.min(MAX_SPEED, Math.sqrt(2 * DECEL * Math.max(0, dist - arriveR))) * face * face;
  st.speed += clamp(vDes - st.speed, -DECEL * dt, ACCEL * dt);
  st.x += Math.sin(st.heading) * st.speed * dt;
  st.z += Math.cos(st.heading) * st.speed * dt;
  return dist <= arriveR && st.speed < 5;
}
const navOf = (s: Ship): NavState => ({ x: s.pos.x, z: s.pos.z, heading: s.heading, speed: s.speed, omega: s.omega });
function applyNav(s: Ship, st: NavState) { s.pos.x = st.x; s.pos.z = st.z; s.heading = st.heading; s.speed = st.speed; s.omega = st.omega; }

function steer(s: Ship, T: Vec, arriveR: number, dt: number): boolean {
  const st = navOf(s); const arrived = navStep(st, T, arriveR, dt); applyNav(s, st); return arrived;
}
function coast(s: Ship, dt: number) {   // no orders: ease ω and thrust to zero, glide to a stop
  s.omega += clamp(-s.omega, -ANG_ACCEL * dt, ANG_ACCEL * dt);
  s.heading = angWrap(s.heading + s.omega * dt);
  s.speed = Math.max(0, s.speed - DECEL * dt);
  s.pos.x += Math.sin(s.heading) * s.speed * dt;
  s.pos.z += Math.cos(s.heading) * s.speed * dt;
}
function dockPoint(s: Ship, bp: THREE.Vector3, radius: number): Vec {
  const dx = s.pos.x - bp.x, dz = s.pos.z - bp.z; const L = Math.hypot(dx, dz) || 1; const r = radius + 14;
  return { x: bp.x + dx / L * r, z: bp.z + dz / L * r };
}
// Forward-simulate the EXACT flight model to arrival and draw the resulting curve.
const PATH_DT = 1 / 40, PATH_MAX = 480;
function updatePath(s: Ship, T: Vec | null, arriveR: number) {
  if (!T) { s.path.visible = false; return; }
  const st = navOf(s); const pts: number[] = [st.x, 2, st.z];
  for (let i = 0; i < PATH_MAX; i++) { const done = navStep(st, T, arriveR, PATH_DT); pts.push(st.x, 2, st.z); if (done) break; }
  s.path.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  s.path.computeLineDistances(); s.path.visible = true;
}

// Polar reference grid (rings + radial spokes) that dips into a gravity well near the
// star — a rubber-sheet funnel localized to the sun; flat out where the planets orbit.
function addPolarGrid(scene: THREE.Scene, maxR: number) {
  const WELL_DEPTH = 300, WELL_FALLOFF = 135;
  const wellY = (r: number) => -WELL_DEPTH / (1 + (r / WELL_FALLOFF) * (r / WELL_FALLOFF));
  const SPOKES = 20; const pts: number[] = [];
  // ring radii: dense near the sun (to shape the funnel), regular farther out
  const radii: number[] = [];
  for (let r = 30; r < 320; r += 38) radii.push(r);
  for (let r = 320; r <= maxR; r += 260) radii.push(r);
  for (const r of radii) {
    const y = wellY(r); let px = r, pz = 0;
    for (let i = 1; i <= 128; i++) { const a = (i / 128) * Math.PI * 2; const x = Math.cos(a) * r, z = Math.sin(a) * r; pts.push(px, y, pz, x, y, z); px = x; pz = z; }
  }
  // radial spokes: tessellated and curved down into the well near the center
  for (let s = 0; s < SPOKES; s++) {
    const a = (s / SPOKES) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    let pr = 0, py = wellY(0);
    for (let r = 12; r <= maxR; r += (r < 320 ? 14 : 80)) {
      const y = wellY(r); pts.push(ca * pr, py, sa * pr, ca * r, y, sa * r); pr = r; py = y;
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2a3f5c, transparent: true, opacity: 0.2 })));
}

function addRings(g: THREE.Group, size: number, color: number) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(size * 1.4, size * 2.2, 80),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2 + 0.35; g.add(ring);
}

function addBelt(scene: THREE.Scene) {
  const N = 700; const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b6256, roughness: 0.95, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, N); const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2; const r = BELT_R + (Math.random() - 0.5) * 90;
    const s = 1 + Math.random() * 3;
    q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    m.compose(new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 10, Math.sin(a) * r), q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m);
  }
  scene.add(mesh);
}

function buildStars(scene: THREE.Scene) {
  const N = 3500; const pos = new Float32Array(N * 3); const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(8000 + Math.random() * 4000);
    pos.set([v.x, v.y, v.z], i * 3);
    const t = Math.random(); const c = new THREE.Color().setHSL(0.6, 0.3, 0.6 + t * 0.4);
    if (Math.random() < 0.1) c.setHSL(0.08, 0.5, 0.7);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 18, sizeAttenuation: true, vertexColors: true, transparent: true })));
}
