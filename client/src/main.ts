// Stellar Frontier — 3D vertical slice (Three.js). The solar system lives on the XZ
// plane (Y up); the sun is at the origin and lights everything. Ships are real glTF
// models lit live (no baked sprites). Planets are procedural shader spheres. The HTML
// HUD (fleet bar, HQ stores, hint) is reused from the 2D slice.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makePlanet, makeStar, makeNebula, type Planet } from './planet.ts';
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
  def: typeof FACTIONS[number]; obj: THREE.Object3D; disc: THREE.Mesh; beam: THREE.Mesh; path: THREE.Line;
  pos: Vec; heading: number; speed: number; omega: number;
  state: 'idle' | 'moving' | 'mining' | 'returning';
  moveTo: Vec | null; mine: MineTarget | null; cargo: number; cargoRes: ResourceTag | null;
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
  scene.background = makeNebula(renderer);   // baked raymarched volumetric nebula (static cubemap)
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
  const discGeo = new THREE.RingGeometry(16, 19, 48);
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

    const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0x6fd2ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(start.x, 1, start.z); disc.visible = false; scene.add(disc);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.visible = false; scene.add(beam);
    // dashed trajectory line to the ordered destination
    const path = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0x6fd2ff, transparent: true, opacity: 0.55, dashSize: 9, gapSize: 7 }));
    path.visible = false; scene.add(path);

    ships[i] = { def, obj: holder, disc, beam, path, pos: { ...start }, heading: 0, speed: 0, omega: 0, state: 'idle', moveTo: null, mine: null, cargo: 0, cargoRes: null };
  }));

  // ---------- raycasting: select ships / move / mine ----------
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  let downX = 0, downY = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) return;   // was a camera drag
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // 1) ship?
    const shipHits = ray.intersectObjects(ships.map((s) => s.obj), true);
    if (shipHits.length) { let o: THREE.Object3D | null = shipHits[0].object; while (o && (o.userData as any).shipIndex === undefined) o = o.parent; if (o) { selectShip((o.userData as any).shipIndex); return; } }
    // 2) mine target?
    const mineHits = ray.intersectObjects(mineTargets.length ? hoverMeshes.map((h) => h.mesh) : [], true);
    let mh: THREE.Object3D | null = mineHits[0]?.object ?? null;
    while (mh && !(mh.userData as any).mine) mh = mh.parent;
    const s = ships[selected];
    if (mh && (mh.userData as any).mine && s) { s.mine = (mh.userData as any).mine; s.moveTo = null; s.state = 'moving'; flashHint(`${s.def.name} → mining ${s.mine!.name}`); return; }
    // 3) empty space → move on the plane
    const hit = new THREE.Vector3();
    if (s && ray.ray.intersectPlane(ground, hit)) { s.moveTo = { x: hit.x, z: hit.z }; s.mine = null; s.state = 'moving'; flashHint(`${s.def.name} → moving`); }
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
      b.innerHTML = `<img src="${BASE}sprites/${s.def.id}_y000.png" alt=""><div class="s-name">${s.def.name}</div><div class="s-stat" data-i="${i}">idle</div>`;
      b.onclick = () => selectShip(i); fleetEl.appendChild(b);
    });
  }
  function updateHud() {
    [...fleetEl.querySelectorAll('.s-stat')].forEach((el) => {
      const i = +(el as HTMLElement).dataset.i!; const s = ships[i]; if (!s) return;
      el.className = 's-stat ' + (s.state === 'mining' ? 'mining' : s.state === 'returning' ? 'returning' : s.state === 'moving' ? 'moving' : '');
      el.textContent = s.state === 'mining' ? `mining ${Math.round(s.cargo)}%` : s.state;
    });
    resEl.innerHTML = `<h3>HQ Stores</h3>` + (Object.keys(resources) as ResourceTag[])
      .map((k) => `<div class="res-row"><span class="k">${RESOURCE_LABEL[k]}</span><span class="v">${Math.floor(resources[k])}</span></div>`).join('');
    recallBtn.disabled = !ships[selected];
  }
  window.addEventListener('pointermove', (e) => {
    tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(hoverMeshes.map((h) => h.mesh), true);
    if (hits.length) { let o: THREE.Object3D | null = hits[0].object; const found = hoverMeshes.find((h) => { let x: THREE.Object3D | null = o; while (x) { if (x === h.mesh) return true; x = x.parent; } return false; }); if (found) { tip.innerHTML = found.html; tip.hidden = false; return; } }
    tip.hidden = true;
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---------- loop ----------
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  let hudAcc = 0;
  function frame() {
    const dt = Math.min(0.05, clock.getDelta()); const T = clock.elapsedTime;
    controls.update();
    star.update(dt, camera.position);

    for (const o of orbiters) { o.angle += o.speed * dt; o.group.position.set(Math.cos(o.angle) * o.orbit, 0, Math.sin(o.angle) * o.orbit); o.planet.update(dt, camera.position); }
    for (const s of spinners) { s.angle += s.speed * dt; s.group.position.set(s.parent.position.x + Math.cos(s.angle) * s.dist, 0, s.parent.position.z + Math.sin(s.angle) * s.dist); s.planet.update(dt, camera.position); }
    updateHQ(T); hq.position.copy(HQ); hq.rotation.y = T * 0.3;   // station orbits the home planet


    const pulse = 0.55 + 0.45 * Math.sin(T * 6);
    for (const s of ships) {
      if (!s) continue;
      s.beam.visible = false;

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
          else if (s.state === 'returning') { if (s.cargoRes && s.cargo > 0) { resources[s.cargoRes] += s.cargo; s.cargo = 0; s.cargoRes = null; } s.state = 'idle'; s.moveTo = null; }
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
      s.disc.visible = ships[selected] === s;
      if (s.disc.visible) { s.disc.position.set(s.pos.x, 1, s.pos.z); (s.disc.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.4 * pulse; }
      updatePath(s, lineTo);
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
  (window as any).__game = { ships, mineTargets, scene, camera, controls };
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
function steer(s: Ship, T: Vec, arriveR: number, dt: number): boolean {
  const dx = T.x - s.pos.x, dz = T.z - s.pos.z;
  const dist = Math.hypot(dx, dz);
  const err = angWrap(Math.atan2(dx, dz) - s.heading);
  // angular: aim for the turn rate that can still brake to 0 exactly on the bearing,
  // then move ω toward it within the angular-accel budget (no sudden ω jumps)
  const omegaDes = clamp(Math.sign(err) * Math.sqrt(2 * ANG_ACCEL * Math.abs(err)), -MAX_OMEGA, MAX_OMEGA);
  s.omega += clamp(omegaDes - s.omega, -ANG_ACCEL * dt, ANG_ACCEL * dt);
  s.heading = angWrap(s.heading + s.omega * dt);
  // linear: arrive (brake to 0 at arriveR), and throttle back while not facing the target
  const face = Math.max(0, Math.cos(err));
  const vDes = Math.min(MAX_SPEED, Math.sqrt(2 * DECEL * Math.max(0, dist - arriveR))) * face * face;
  s.speed += clamp(vDes - s.speed, -DECEL * dt, ACCEL * dt);   // bounded accel/decel
  s.pos.x += Math.sin(s.heading) * s.speed * dt;
  s.pos.z += Math.cos(s.heading) * s.speed * dt;
  return dist <= arriveR && s.speed < 5;
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
function updatePath(s: Ship, to: Vec | null) {
  if (!to) { s.path.visible = false; return; }
  const p = s.path.geometry.attributes.position as THREE.BufferAttribute;
  p.setXYZ(0, s.pos.x, 2, s.pos.z); p.setXYZ(1, to.x, 2, to.z); p.needsUpdate = true;
  s.path.computeLineDistances(); s.path.visible = true;
}

// One clean, evenly-spaced polar reference grid (concentric rings + spokes) for the plane.
function addPolarGrid(scene: THREE.Scene, maxR: number) {
  const STEP = 260, SPOKES = 16; const pts: number[] = [];
  for (let r = STEP; r <= maxR; r += STEP) {
    let px = r, pz = 0;
    for (let i = 1; i <= 128; i++) { const a = (i / 128) * Math.PI * 2; const x = Math.cos(a) * r, z = Math.sin(a) * r; pts.push(px, 0, pz, x, 0, z); px = x; pz = z; }
  }
  for (let s = 0; s < SPOKES; s++) { const a = (s / SPOKES) * Math.PI * 2; pts.push(0, 0, 0, Math.cos(a) * maxR, 0, Math.sin(a) * maxR); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2a3f5c, transparent: true, opacity: 0.18 })));
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
