// Stellar Frontier — 3D vertical slice (Three.js). The solar system lives on the XZ
// plane (Y up); the sun is at the origin and lights everything. Ships are real glTF
// models lit live (no baked sprites). Planets are procedural shader spheres. The HTML
// HUD (fleet bar, HQ stores, hint) is reused from the 2D slice.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makePlanet, makeStar, makeNebula, type Planet, type Star } from './planet.ts';
import { genSystem, type SystemSpec } from './sysgen.ts';
import { makeHQCity, type HQCity } from './hqcity.ts';
import { makeGalaxy3D, makeHyperspace, type Galaxy3D, type Hyperspace } from './galaxymap.ts';
import {
  FACTIONS, CLASS_STATS, PLANETS, GAS_NODES, RES_COLOR, RESOURCE_LABEL, type ResourceTag,
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
  beam: THREE.Mesh; path: THREE.Line; plume: THREE.Group;
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
  // the sun stays the KEY light; ambient + two dim directionals act as fill/rim so the
  // night side of a hull still reads instead of dropping to black
  scene.add(new THREE.AmbientLight(0xb9c8e0, 0.32));
  const fillLight = new THREE.DirectionalLight(0x8fb0e8, 0.3);   // cool fill from high "north"
  fillLight.position.set(500, 700, -400); scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xbfd4ff, 0.22);   // pale rim from the far side
  rimLight.position.set(-600, 400, 700); scene.add(rimLight);

  // ---------- background: starfield + nebula dome ----------
  const nebulaTex = makeNebula(renderer);    // baked raymarched volumetric nebula (static cubemap)
  scene.background = nebulaTex;
  buildStars(scene);
  addPolarGrid(scene, 1450);

  // ---------- star systems (home = hand-authored, everything else = procedural) ----------
  // The whole system view lives under sysRoot so it can be torn down and rebuilt when
  // the player enters another star system (see loadSystem / genSystem in sysgen.ts).
  interface Orbiter { group: THREE.Group; planet: Planet; orbit: number; angle: number; speed: number; }
  const orbiters: Orbiter[] = [];
  interface Spinner { group: THREE.Group; planet: Planet; parent: THREE.Group; dist: number; angle: number; speed: number; }
  const spinners: Spinner[] = [];
  const hoverMeshes: { mesh: THREE.Object3D; html: string }[] = [];
  const labels: { el: HTMLDivElement; obj: THREE.Object3D; off: number }[] = [];
  const mineralPulse: { mats: THREE.MeshStandardMaterial[]; sprites: THREE.SpriteMaterial[]; light: THREE.PointLight; phase: number }[] = [];
  let star: Star; let sysRoot = new THREE.Group(); scene.add(sysRoot);
  let viewSystem = 0;                                          // which system the 3D view shows
  let homePlanet: THREE.Group | null = null; let homeR = 22;   // HQ orbits this planet (home only)
  let hqGroup: THREE.Group | null = null;

  const mkLabel = (text: string, obj: THREE.Object3D, off: number, cls = 'world-label') => {
    const el = document.createElement('div'); el.className = cls; el.textContent = text;
    document.body.appendChild(el); labels.push({ el, obj, off });
  };

  // shared mineral-field assets
  const shardGeo = new THREE.OctahedronGeometry(1, 0);
  const haloCv = document.createElement('canvas'); haloCv.width = haloCv.height = 64;
  const hctx = haloCv.getContext('2d')!;
  const hgrad = hctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  hgrad.addColorStop(0, 'rgba(255,255,255,0.9)'); hgrad.addColorStop(0.4, 'rgba(255,255,255,0.35)'); hgrad.addColorStop(1, 'rgba(255,255,255,0)');
  hctx.fillStyle = hgrad; hctx.fillRect(0, 0, 64, 64);
  const haloTex = new THREE.CanvasTexture(haloCv);

  function addMineralField(root: THREE.Group, beltR: number, frac: number, res: 'ore' | 'crystal', seed: number) {
    const a = frac * Math.PI * 2;
    const cluster = new THREE.Group();
    cluster.position.set(Math.cos(a) * beltR, 0, Math.sin(a) * beltR); root.add(cluster);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4d453c, roughness: 0.95, metalness: 0.05, flatShading: true });
    const glowHex = res === 'ore' ? 0xffa63c : 0x6fe8ff;   // amber ore veins / icy crystal
    const shardMats: THREE.MeshStandardMaterial[] = [];
    const shardSprites: THREE.SpriteMaterial[] = [];
    let sd = seed || 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 5; k++) {
      const rr = 5.5 + rnd() * 5;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 0), rockMat);
      rock.position.set((rnd() - 0.5) * 26, (rnd() - 0.5) * 6, (rnd() - 0.5) * 26);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      cluster.add(rock);
      for (let j = 0; j < 4; j++) {   // glowing shards + additive halo auras (no bloom pass)
        const m = new THREE.MeshStandardMaterial({ color: glowHex, emissive: glowHex, emissiveIntensity: 3.2, roughness: 0.3, flatShading: true });
        shardMats.push(m);
        const shard = new THREE.Mesh(shardGeo, m);
        const dir = new THREE.Vector3(rnd() - 0.5, rnd() * 0.7, rnd() - 0.5).normalize();
        shard.position.copy(rock.position).addScaledVector(dir, rr * 0.85);
        shard.scale.set(0.9 + rnd() * 1.2, 1.8 + rnd() * 2.6, 0.9 + rnd() * 1.2);
        shard.lookAt(shard.position.clone().add(dir)); shard.rotateX(Math.PI / 2);
        cluster.add(shard);
        const sm = new THREE.SpriteMaterial({ map: haloTex, color: glowHex, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
        shardSprites.push(sm);
        const spr = new THREE.Sprite(sm);
        spr.scale.setScalar(7 + rnd() * 5); spr.position.copy(shard.position).addScaledVector(dir, 1.2);
        cluster.add(spr);
      }
    }
    const light = new THREE.PointLight(glowHex, 4.5, 110, 1.5); light.position.set(0, 10, 0); cluster.add(light);
    mineralPulse.push({ mats: shardMats, sprites: shardSprites, light, phase: frac * 7 });
    const mt: MineTarget = { name: res === 'ore' ? 'Ore Field' : 'Crystal Field', resource: res, radius: 22, pos: () => cluster.position.clone() };
    mineTargets.push(mt); (cluster.userData as any).mine = mt;
    hoverMeshes.push({ mesh: cluster, html: `<div class="t-name">${mt.name}</div><div class="t-tags">${RESOURCE_LABEL[res]}</div>` });
  }

  // HQ station (home system only)
  const HQ_DIST = () => homeR + 34;
  const updateHQ = (t: number) => {
    const c = homePlanet ? homePlanet.position : new THREE.Vector3();
    const a = 0.6 + t * 0.25;
    HQ.set(c.x + Math.cos(a) * HQ_DIST(), 0, c.z + Math.sin(a) * HQ_DIST());
  };

  // the hand-authored home system expressed as a SystemSpec
  const homeSpec = (): SystemSpec => ({
    id: 0, name: 'Thallian Reach',
    star: { radius: 30, tint: 0xffffff, cls: 'G' },
    planets: PLANETS,
    belt: { radius: BELT_R, fields: [{ frac: 0.2, res: 'ore' }, { frac: 0.65, res: 'crystal' }] },
  });

  function clearSystemView() {
    for (const L of labels) L.el.remove();
    labels.length = 0; orbiters.length = 0; spinners.length = 0;
    hoverMeshes.length = 0; mineTargets.length = 0; mineralPulse.length = 0;
    homePlanet = null; hqGroup = null;
    sysRoot.traverse((o: any) => {   // free GPU resources from the old system
      if (o.geometry && o.geometry !== shardGeo) o.geometry.dispose?.();
      for (const m of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) m.dispose?.();
    });
    scene.remove(sysRoot);
    sysRoot = new THREE.Group(); scene.add(sysRoot);
  }

  function buildSystemView(spec: SystemSpec) {
    star = makeStar(spec.star.radius, spec.star.tint);
    sysRoot.add(star.group);
    const tint = new THREE.Color(spec.star.tint).lerp(new THREE.Color(0xffffff), 0.45);
    sunLight.color.copy(tint);   // the system's key light matches its star

    for (const p of spec.planets) {
      const pl = makePlanet({ radius: p.size, color: p.color, gas: p.type === 'gas', seed: seedFor(p.name) });
      const g = pl.group;
      g.position.set(Math.cos(p.angle0) * p.orbit, 0, Math.sin(p.angle0) * p.orbit);
      sysRoot.add(g);
      orbiters.push({ group: g, planet: pl, orbit: p.orbit, angle: p.angle0, speed: p.speed });
      if (spec.id === 0 && p.name === HOME_PLANET) { homePlanet = g; homeR = p.size; }
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
        sysRoot.add(mg);
        spinners.push({ group: mg, planet: ml, parent: g, dist: m.dist, angle: m.angle0, speed: m.speed });
        const mt: MineTarget = { name: m.name, resource: m.resource, radius: m.size + 6, pos: () => mg.getWorldPosition(new THREE.Vector3()) };
        mineTargets.push(mt); (mg.userData as any).mine = mt;
        hoverMeshes.push({ mesh: mg, html: `<div class="t-name">${m.name} (moon)</div><div class="t-tags">${RESOURCE_LABEL[m.resource]}</div>` });
      }
    }

    if (spec.id === 0) {   // HQ station orbits the home planet
      updateHQ(0);
      hqGroup = new THREE.Group(); hqGroup.position.copy(HQ); sysRoot.add(hqGroup);
      hqGroup.add(new THREE.Mesh(new THREE.OctahedronGeometry(10),
        new THREE.MeshStandardMaterial({ color: 0x9fd6ff, emissive: 0x2a6ea0, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 })));
      hqGroup.add(new THREE.Mesh(new THREE.TorusGeometry(15, 1.0, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0x5ec8ff }))).rotation.x = Math.PI / 2;
      mkLabel('HQ', hqGroup, 18, 'world-label hq');
    }

    if (spec.belt) {
      addBelt(sysRoot, spec.belt.radius);
      spec.belt.fields.forEach((f, i) => addMineralField(sysRoot, spec.belt!.radius, f.frac, f.res, spec.id * 31 + i * 16 + 7));
    }
  }

  function loadSystem(id: number) {
    clearSystemView();
    const spec = id === 0 ? homeSpec() : genSystem(galaxy!.systems[id]);
    buildSystemView(spec);
    viewSystem = id;
    sysNameEl.textContent = `${spec.name}${id === 0 ? ' (home)' : ''} · ${spec.star.cls}-class`;
    // re-link ship orders to the freshly built system objects (matched by name)
    for (const s of ships) {
      if (!s || s.system !== id || !s.mine) continue;
      const nm = s.mine.name;
      s.mine = mineTargets.find((m) => m.name === nm) ?? null;
      if (!s.mine && (s.state === 'mining' || s.state === 'moving')) { s.state = 'idle'; s.moveTo = null; }
    }
  }

  // viewed-system name readout (top center, under the hint bar)
  const sysNameEl = document.createElement('div'); sysNameEl.className = 'gal-hud sys-hud'; document.body.appendChild(sysNameEl);
  buildSystemView(homeSpec());
  sysNameEl.textContent = 'Thallian Reach (home) · G-class';


  // ---------- fleet (glTF ships) ----------
  const loader = new GLTFLoader();
  // shared exhaust-plume assets: open cones (outer color + inner hot core) with the base
  // at the nozzle and the tip trailing back (+Z in model space = stern), plus a soft
  // sprite glow. Geometry is translated/rotated once so scaling Z stretches the plume.
  const plumeGeoOuter = new THREE.ConeGeometry(2.3, 11, 12, 1, true);
  const plumeGeoInner = new THREE.ConeGeometry(1.15, 7.5, 10, 1, true);
  for (const g of [plumeGeoOuter, plumeGeoInner]) { g.translate(0, g.parameters.height / 2, 0); g.rotateX(Math.PI / 2); }
  const glowCv = document.createElement('canvas'); glowCv.width = glowCv.height = 64;
  const gctx = glowCv.getContext('2d')!;
  const grad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  gctx.fillStyle = grad; gctx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowCv);
  function makePlume(color: number, rear: THREE.Vector3): THREE.Group {
    const p = new THREE.Group(); p.name = 'plume'; p.position.copy(rear);
    const outer = new THREE.Mesh(plumeGeoOuter, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const inner = new THREE.Mesh(plumeGeoInner, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(7);
    const light = new THREE.PointLight(color, 2.0, 55, 1.7); light.position.set(0, 0, 2);   // the engine's own light
    p.add(outer, inner, halo, light);
    (p.userData as any) = { outer, inner, halo, light };
    return p;
  }
  const discGeo = new THREE.RingGeometry(14.5, 17.5, 44);     // faint flat ring under each ship (hover/select target)
  const destGeo = new THREE.RingGeometry(9, 12, 44);          // pulsing destination marker
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  await Promise.all(FACTIONS.map(async (def, i) => {
    let obj: THREE.Object3D;
    try {
      const gltf = await loader.loadAsync(`${BASE}models/${def.model}.glb`);
      obj = gltf.scene;
      // normalize size per CLASS: scouts are small, cruisers mid, harvesters bulky
      const box = new THREE.Box3().setFromObject(obj); const size = new THREE.Vector3(); box.getSize(size);
      const s = CLASS_STATS[def.cls].size / Math.max(size.x, size.y, size.z); obj.scale.setScalar(s);
      // Shade hulls diffusely (like the planets) so the star's direction reads: tame
      // metalness and raise roughness (no environment map, so metal would read black).
      obj.traverse((o: any) => {
        if (!o.isMesh) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m) continue;
          if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.15);
          if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.65);
          // keep the baked emissive (windows / engine slits / vein lights) but clamp the
          // exported strength (10+) so ACES tone mapping doesn't clip it to pure white
          if (m.emissive && m.emissiveIntensity !== undefined) m.emissiveIntensity = Math.min(m.emissiveIntensity, 2.4);
        }
      });
    } catch (e) {
      obj = new THREE.Mesh(new THREE.ConeGeometry(6, 18, 6), new THREE.MeshStandardMaterial({ color: def.color }));
      console.error('ship load', def.id, e);
    }
    const holder = new THREE.Group(); holder.add(obj);
    // exhaust plume + engine light at the stern (model nose = -Z, so stern = bbox max z)
    const bb = new THREE.Box3().setFromObject(obj);
    const plume = makePlume(def.color, new THREE.Vector3(0, (bb.min.y + bb.max.y) / 2, bb.max.z - 0.5));
    holder.add(plume);
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

    ships[i] = { def, obj: holder, disc, destMarker, beam, path, plume, pos: { ...start }, heading: 0, speed: 0, omega: 0, docked: true, state: 'idle', moveTo: null, mine: null, cargo: 0, cargoRes: null, system: 0, voyage: null };
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
    if (galOpen) {   // galaxy map: click a star to send the selected ship there
      if (moved || !galaxy3d) return;
      const i = galaxy3d.pickStar(ndc); const s = ships[selected];
      if (i == null || !s) return;
      if (s.voyage) { flashHint(`${s.def.name} is already in transit`); return; }
      if (i === s.system) {   // clicking the star your ship is AT enters that system
        closeGalaxy(); loadSystem(i);
        flashHint(`entering ${galaxy!.systems[i].name}`);
        return;
      }
      const r = routeTo(s.system, i); if (!r) { flashHint('no route'); return; }
      departTo(s, r); flashHint(`${s.def.name} → ${galaxy!.systems[i].name} (${Math.round(routeEta(r))}s)`);
      return;
    }
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
  recallBtn.onclick = () => {
    const s = ships[selected]; if (!s) return;
    if (s.voyage) { flashHint(`${s.def.name} is in transit`); return; }
    if (s.system !== 0) {   // in another system: jump home through the lanes first
      const r = routeTo(s.system, 0);
      if (r) { departTo(s, r); flashHint(`${s.def.name} → returning to HQ (${r.length - 1} jumps)`); }
      return;
    }
    s.mine = null; s.moveTo = { x: HQ.x, z: HQ.z }; s.state = 'returning'; flashHint(`${s.def.name} → recalled to HQ`);
  };
  let hintTimer = 0;
  const DEFAULT_HINT = 'Drag to orbit · scroll to zoom · click a ship to select, then click a planet/node to mine or empty space to move.';
  function flashHint(m: string) { hintEl.textContent = m; hintTimer = 3; }
  function selectShip(i: number) { selected = i; [...fleetEl.children].forEach((c, j) => c.classList.toggle('selected', j === selected)); const s = ships[i]; if (s) flashHint(`${s.def.name} selected`); }
  function buildToolbar() {
    fleetEl.innerHTML = '';
    ships.forEach((s, i) => {
      const b = document.createElement('div'); b.className = 'ship-btn' + (i === selected ? ' selected' : '');
      b.innerHTML = `<div class="hq-badge" data-b="${i}" title="docked at HQ">HQ</div><img src="${BASE}sprites/${s.def.model}_y000.png" alt=""><div class="s-name">${s.def.name}</div><div class="s-cls">${CLASS_STATS[s.def.cls].label}</div><div class="s-stat" data-i="${i}">idle</div>`;
      b.onclick = () => selectShip(i); fleetEl.appendChild(b);
    });
  }
  function updateHud() {
    [...fleetEl.querySelectorAll('.s-stat')].forEach((el) => {
      const i = +(el as HTMLElement).dataset.i!; const s = ships[i]; if (!s) return;
      el.className = 's-stat ' + (s.state === 'mining' ? 'mining' : s.state === 'returning' ? 'returning' : s.state === 'moving' ? 'moving' : '');
      el.textContent = s.state === 'mining' ? `mining ${Math.round(100 * s.cargo / (CARGO_CAP * perfOf(s).cargo))}%` : s.state;
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

  // Discord login (gateway OAuth, see server/index.js). The button shows the
  // logged-in identity when a session cookie exists; clicking starts the flow.
  // Fails silent when no gateway is reachable (e.g. static Pages preview).
  const discordBtn = document.createElement('button'); discordBtn.className = 'nav-btn discord'; discordBtn.textContent = 'Discord';
  navBar.append(discordBtn);
  discordBtn.onclick = () => { location.href = '/auth/discord/login'; };
  fetch('/api/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).then((u) => {
    if (!u) return;
    discordBtn.textContent = `@${u.global_name || u.username}`;
    discordBtn.title = 'Discord connected — click to re-login';
  }).catch(() => {});

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
    tip.hidden = true; sysNameEl.hidden = true; hqBtn.textContent = 'Solar System';
  }
  function closeHQ() { hqOpen = false; hqUI.hidden = true; controls.enabled = true; if (hqCity) hqCity.setEnabled(false); sysNameEl.hidden = false; renderer.domElement.style.cursor = 'default'; hqBtn.textContent = 'HQ City'; }
  hqBtn.onclick = () => { if (hqOpen) closeHQ(); else { if (galOpen) closeGalaxy(); openHQ(); } };

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
  function onArrive(s: Ship) {
    if (s.system === 0) {   // home: dock at HQ and deposit any cargo hauled back
      s.pos = { x: HQ.x, z: HQ.z }; s.heading = 0; s.speed = 0; s.state = 'idle'; s.docked = true;
      if (s.cargoRes && s.cargo > 0) { resources[s.cargoRes] += s.cargo; s.cargo = 0; s.cargoRes = null; }
    } else {                // remote system: drop out of hyperspace on an entry ring
      const a = (ships.indexOf(s) / 8) * Math.PI * 2 + s.system * 0.7;
      s.pos = { x: Math.cos(a) * 560, z: Math.sin(a) * 560 };
      s.heading = angWrap(Math.atan2(-s.pos.x, -s.pos.z)); s.speed = 0; s.state = 'idle'; s.moveTo = null;
    }
  }

  // ---------- 3D galaxy map + hyperspace (its own scenes; see galaxymap.ts) ----------
  // The map renders on the main canvas (the fleet hotbar stays visible) so you can pick
  // a ship and order it to a star; a ship in transit shows the hyperspace tunnel instead.
  let galaxy3d: Galaxy3D | null = null, hyper: Hyperspace | null = null;
  let galOpen = false, galHover = -1, hyperShip = -1;
  const galLabel = document.createElement('div'); galLabel.className = 'gal-hud'; galLabel.hidden = true; document.body.appendChild(galLabel);
  // per-ship "find" buttons floating over each fleet marker on the map (click → select + recenter)
  const galShipBtns = document.createElement('div'); galShipBtns.className = 'gal-ship-btns'; galShipBtns.hidden = true; document.body.appendChild(galShipBtns);
  let galBtnEls: HTMLButtonElement[] = [];
  function buildGalShipBtns() {
    galShipBtns.innerHTML = '';
    galBtnEls = ships.map((s, i) => {
      const b = document.createElement('button'); b.className = 'gal-ship-btn'; b.textContent = s.def.name;
      b.onclick = (e) => { e.stopPropagation(); selectShip(i); const gp = shipGalPos(s); galaxy3d?.focusOn(gp.x, gp.y); galLabelText(); };
      galShipBtns.appendChild(b); return b;
    });
  }
  const galTmp = new THREE.Vector3();
  function placeGalShipBtns() {
    if (!galaxy3d) return; const bucket = new Map<string, number>();
    ships.forEach((s, i) => {
      const el = galBtnEls[i]; if (!el) return;
      const gp = shipGalPos(s); galTmp.set(gp.x, 12, gp.y).project(galaxy3d!.camera);
      if (galTmp.z >= 1) { el.style.display = 'none'; return; }   // behind the camera
      const sx = (galTmp.x * 0.5 + 0.5) * innerWidth, sy = (-galTmp.y * 0.5 + 0.5) * innerHeight;
      const key = Math.round(sx / 34) + '_' + Math.round(sy / 34);   // stack buttons that land on the same spot
      const n = bucket.get(key) || 0; bucket.set(key, n + 1);
      el.style.display = 'block';
      el.style.left = sx + 'px';
      el.style.top = (sy - 40 - n * 24) + 'px';
      el.classList.toggle('sel', i === selected);
    });
  }
  function galFleet() {
    return ships.map((s, i) => { const gp = shipGalPos(s); return { x: gp.x, z: gp.y, color: s.def.color, sel: i === selected, visible: true }; });
  }
  function activeVoyages(): number[][] { return ships.filter((s) => s.voyage).map((s) => s.voyage!.route.slice(s.voyage!.i)); }
  function openGalaxy() {
    if (!galaxy) return;
    if (!galaxy3d) galaxy3d = makeGalaxy3D(renderer, nebulaTex, galaxy as any);
    if (!hyper) hyper = makeHyperspace(renderer, nebulaTex);
    galaxy3d.resize(innerWidth, innerHeight); hyper.resize(innerWidth, innerHeight);
    galaxy3d.setEnabled(true); galOpen = true; controls.enabled = false; hyperShip = -1;
    if (!galBtnEls.length) buildGalShipBtns();
    for (const L of labels) L.el.style.display = 'none'; tip.hidden = true; sysNameEl.hidden = true;
    galLabel.hidden = false; galShipBtns.hidden = false; galBtn.textContent = 'Solar System'; galHover = -1; galLabelText();
  }
  function closeGalaxy() {
    galOpen = false; if (galaxy3d) galaxy3d.setEnabled(false); controls.enabled = true;
    galLabel.hidden = true; galShipBtns.hidden = true; sysNameEl.hidden = false;
    renderer.domElement.style.cursor = 'default'; galBtn.textContent = 'Galaxy Map';
  }
  galBtn.onclick = () => { if (hqOpen) closeHQ(); galOpen ? closeGalaxy() : openGalaxy(); };
  // hover label text for the system under the cursor (+ route ETA for the selected ship)
  function galLabelText() {
    if (galHover < 0) { galLabel.textContent = 'Local Cluster — select a ship, then click a star to send it (~1 min/jump). Drag to orbit · scroll to zoom.'; return; }
    const sy = galaxy!.systems[galHover], s = ships[selected];
    const here = s && !s.voyage && s.system === galHover;
    const r = s && !here ? routeTo(s.system, galHover) : null;
    const eta = r && r.length > 1 ? `  ·  ${Math.round(routeEta(r))}s via ${r.length - 1} jump${r.length > 2 ? 's' : ''}` : '';
    galLabel.textContent = `${sy.name} · ${sy.star.class}-class · ${sy.planets} planets${galHover === 0 ? ' · HOME' : ''}${here ? '  ·  click to ENTER' : eta}`;
  }
  window.addEventListener('pointermove', (e) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (hqOpen) { if (hqCity) hqCity.setHover(hqCity.pick(ndc)); return; }   // HQ city: hover buildings
    if (galOpen) {   // galaxy map: hover a star (route preview + label)
      if (galaxy3d) { galHover = galaxy3d.pickStar(ndc) ?? -1; renderer.domElement.style.cursor = galHover >= 0 ? 'pointer' : 'default'; galLabelText(); }
      return;
    }
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
    if (galaxy3d) galaxy3d.resize(innerWidth, innerHeight);
    if (hyper) hyper.resize(innerWidth, innerHeight);
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
    if (viewSystem === 0 && hqGroup) { updateHQ(T); hqGroup.position.copy(HQ); hqGroup.rotation.y = T * 0.3; }   // station orbits the home planet


    // advance interstellar voyages (~1 min per jump-lane segment), even while the map is closed
    if (galaxy) for (const s of ships) {
      if (!s || !s.voyage) continue; const v = s.voyage; v.t += dt;
      if (v.t >= segSeconds(v.route[v.i], v.route[v.i + 1])) { v.t = 0; v.i++; if (v.i >= v.route.length - 1) { s.system = v.route[v.route.length - 1]; s.voyage = null; onArrive(s); } }
    }
    // galaxy map / hyperspace its own scene on the main canvas (hotbar stays visible)
    if (galOpen && galaxy3d && hyper) {
      const sel = ships[selected];
      if (sel && sel.voyage) {   // selected ship in transit → ride the hyperspace tunnel
        if (hyperShip !== selected) { hyper.setShip(sel.obj); hyperShip = selected; }
        hyper.update(dt); renderer.render(hyper.scene, hyper.camera);
        galShipBtns.hidden = true;
      } else {
        hyperShip = -1; galShipBtns.hidden = false;
        const routePreview = sel && !sel.voyage && galHover >= 0 ? routeTo(sel.system, galHover) : null;
        galaxy3d.update(dt, galFleet(), galHover, routePreview, activeVoyages());
        placeGalShipBtns();
        renderer.render(galaxy3d.scene, galaxy3d.camera);
      }
      hudAcc += dt; if (hudAcc > 0.15) { updateHud(); hudAcc = 0; }
      requestAnimationFrame(frame); return;
    }

    const pulse = 0.55 + 0.45 * Math.sin(T * 6);
    const destPulse = 1 + 0.28 * Math.sin(T * 3.2);   // destination ring breathes

    // mineral fields shimmer: shard glow + field light breathe slowly
    for (const mp of mineralPulse) {
      const b = 0.8 + 0.3 * Math.sin(T * 1.7 + mp.phase);
      for (let k = 0; k < mp.mats.length; k++) {
        const tw = 0.5 + 0.5 * Math.sin(T * 2.3 + mp.phase + k * 1.7);   // per-shard twinkle
        mp.mats[k].emissiveIntensity = (1.8 + 2.2 * tw) * b;
        if (mp.sprites[k]) mp.sprites[k].opacity = (0.22 + 0.4 * tw) * b;
      }
      mp.light.intensity = 4.5 * b;
    }
    for (let idx = 0; idx < ships.length; idx++) {
      const s = ships[idx];
      if (!s) continue;
      s.beam.visible = false;
      // ships outside the VIEWED system (or mid-jump) aren't shown in the local view
      const away = !!s.voyage || s.system !== viewSystem;
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
        const p = perfOf(s);
        s.cargoRes = s.mine.resource; s.cargo = Math.min(CARGO_CAP * p.cargo, s.cargo + MINE_RATE * p.mine * dt);
        if (s.cargo >= CARGO_CAP * p.cargo) {
          if (s.system === 0) s.state = 'returning';
          else {   // full in a remote system: haul it home through the jump lanes
            const r = routeTo(s.system, 0);
            if (r) { departTo(s, r); flashHint(`${s.def.name} full — hauling home`); }
            else s.state = 'idle';
          }
        }
        drawBeam(s, s.mine.pos(), pulse);
      }
      if (s.state === 'idle' && s.mine && s.cargo === 0) s.state = 'moving';

      // glTF nose points -Z → rotate by heading+π so the nose leads
      s.obj.position.set(s.pos.x, SHIP_Y, s.pos.z); s.obj.rotation.y = s.heading + Math.PI;

      // exhaust plume + engine light follow the throttle (docked = pilot light only)
      {
        const thr = s.docked ? 0 : s.speed / (MAX_SPEED * perfOf(s).speed);
        const flick = 0.85 + 0.15 * Math.sin(T * 27 + idx * 3.1);
        const pu = s.plume.userData as any;
        s.plume.scale.set(0.55 + 0.55 * thr, 0.55 + 0.55 * thr, 0.22 + 1.5 * thr * flick);
        pu.outer.material.opacity = (0.10 + 0.45 * thr) * flick;
        pu.inner.material.opacity = (0.08 + 0.6 * thr) * flick;
        pu.halo.material.opacity = 0.25 + 0.6 * thr * flick;
        pu.halo.scale.setScalar(4.5 + 5 * thr);
        pu.light.intensity = (0.5 + 2.6 * thr) * flick;
      }

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
  (window as any).__game = { ships, mineTargets, scene, camera, controls, galaxy, routeTo, departTo, openGalaxy, closeGalaxy, selectShip, loadSystem, get viewSystem() { return viewSystem; }, setGalHover: (i: number) => { galHover = i; galLabelText(); }, get galaxy3d() { return galaxy3d; }, get hyper() { return hyper; } };
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
// the ship's real future motion. Performance (ms/acc/dec/mo/aa) lives IN the state so
// each ship class flies — and predicts — with its own stats.
interface NavState { x: number; z: number; heading: number; speed: number; omega: number; ms: number; acc: number; dec: number; mo: number; aa: number; }
function navStep(st: NavState, T: Vec, arriveR: number, dt: number): boolean {
  const dx = T.x - st.x, dz = T.z - st.z;
  const dist = Math.hypot(dx, dz);
  const err = angWrap(Math.atan2(dx, dz) - st.heading);
  const omegaDes = clamp(Math.sign(err) * Math.sqrt(2 * st.aa * Math.abs(err)), -st.mo, st.mo);
  st.omega += clamp(omegaDes - st.omega, -st.aa * dt, st.aa * dt);
  st.heading = angWrap(st.heading + st.omega * dt);
  const face = Math.max(0, Math.cos(err));
  const vDes = Math.min(st.ms, Math.sqrt(2 * st.dec * Math.max(0, dist - arriveR))) * face * face;
  st.speed += clamp(vDes - st.speed, -st.dec * dt, st.acc * dt);
  st.x += Math.sin(st.heading) * st.speed * dt;
  st.z += Math.cos(st.heading) * st.speed * dt;
  return dist <= arriveR && st.speed < 5;
}
const perfOf = (s: Ship) => CLASS_STATS[s.def.cls];
const navOf = (s: Ship): NavState => {
  const p = perfOf(s);
  return { x: s.pos.x, z: s.pos.z, heading: s.heading, speed: s.speed, omega: s.omega,
           ms: MAX_SPEED * p.speed, acc: ACCEL * p.accel, dec: DECEL * p.accel, mo: MAX_OMEGA * p.turn, aa: ANG_ACCEL * p.turn };
};
function applyNav(s: Ship, st: NavState) { s.pos.x = st.x; s.pos.z = st.z; s.heading = st.heading; s.speed = st.speed; s.omega = st.omega; }

function steer(s: Ship, T: Vec, arriveR: number, dt: number): boolean {
  const st = navOf(s); const arrived = navStep(st, T, arriveR, dt); applyNav(s, st); return arrived;
}
function coast(s: Ship, dt: number) {   // no orders: ease ω and thrust to zero, glide to a stop
  const p = perfOf(s);
  s.omega += clamp(-s.omega, -ANG_ACCEL * p.turn * dt, ANG_ACCEL * p.turn * dt);
  s.heading = angWrap(s.heading + s.omega * dt);
  s.speed = Math.max(0, s.speed - DECEL * p.accel * dt);
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

function addBelt(root: THREE.Group, beltR: number) {
  const N = 700; const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b6256, roughness: 0.95, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, N); const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2; const r = beltR + (Math.random() - 0.5) * 90;
    const s = 1 + Math.random() * 3;
    q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    m.compose(new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 10, Math.sin(a) * r), q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m);
  }
  root.add(mesh);
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
