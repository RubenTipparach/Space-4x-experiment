// The HQ as an interactive isometric 3D city on a platform floating in space.
// One distinct building per facility, arranged around a central Admin Spire. Buildings
// grow with their level. Hover highlights; the host (main.ts) handles the info panel.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Facility { key: string; name: string; desc: string; }

const HULL = new THREE.MeshStandardMaterial({ color: 0x8a93a3, metalness: 0.35, roughness: 0.55 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x4a5262, metalness: 0.4, roughness: 0.5 });
const DECK = new THREE.MeshStandardMaterial({ color: 0x39404e, metalness: 0.3, roughness: 0.7 });
const GLASS = new THREE.MeshStandardMaterial({ color: 0x1b3450, metalness: 0.2, roughness: 0.25, emissive: 0x123, emissiveIntensity: 0.5 });
const GLOW = new THREE.MeshStandardMaterial({ color: 0x6fd2ff, emissive: 0x39b6ff, emissiveIntensity: 1.4, roughness: 0.4 });
const WARM = new THREE.MeshStandardMaterial({ color: 0xffb070, emissive: 0xff7a2a, emissiveIntensity: 1.3, roughness: 0.5 });

const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); return o;
};
const cyl = (r: number, h: number, x: number, y: number, z: number, m: THREE.Material, seg = 16) => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.position.set(x, y + h / 2, z); return o;
};

// ---- one builder per facility key (level scales size/floors) ----
function buildStructure(key: string, level: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(8, 0.6, 8, 0, 0, 0, DECK));   // shared landing pad
  const L = level;
  switch (key) {
    case 'admin': {                          // tall tapering spire
      g.add(box(5.5, 1.5, 5.5, 0, 0.6, 0, HULL));
      const floors = 4 + L;
      for (let i = 0; i < floors; i++) { const w = 4.4 - i * (3.0 / floors); g.add(box(w, 2.2, w, 0, 2.1 + i * 2.2, 0, i % 2 ? GLASS : HULL)); }
      g.add(cyl(0.18, 4, 0, 2.1 + floors * 2.2, 0, GLOW, 8));
      break;
    }
    case 'crew': {                           // habitat capsules + domes
      for (let i = 0; i < 3 + Math.min(L, 4); i++) {
        const a = (i / (3 + Math.min(L, 4))) * Math.PI * 2, r = 2.2;
        const c = cyl(1.3, 3.2, Math.cos(a) * r, 0.6, Math.sin(a) * r, i % 2 ? HULL : GLASS, 14); g.add(c);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 8, 0, 7, 0, Math.PI / 2), GLASS); dome.position.set(Math.cos(a) * r, 3.8, Math.sin(a) * r); g.add(dome);
      }
      break;
    }
    case 'lab': {                            // glowing dome on a drum
      g.add(cyl(3.2, 2.0 + L * 0.4, 0, 0.6, 0, HULL, 24));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 28, 16, 0, 7, 0, Math.PI / 2), GLASS); dome.position.y = 2.6 + L * 0.4; g.add(dome);
      g.add(cyl(0.5, 1.2, 0, 2.6 + L * 0.4 + 3.0, 0, GLOW, 10));
      break;
    }
    case 'academy': {                        // ringed amphitheater
      g.add(cyl(3.0, 2.4, 0, 0.6, 0, HULL, 24));
      for (let i = 0; i < 1 + Math.min(L, 3); i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(3.4 + i * 0.5, 0.28, 8, 36), i === 0 ? GLOW : DARK); t.rotation.x = Math.PI / 2; t.position.y = 1.4 + i * 1.4; g.add(t); }
      break;
    }
    case 'shipyard': {                       // open gantry frame around a hull
      const h = 5 + L;
      for (const sx of [-3, 3]) for (const sz of [-3, 3]) g.add(box(0.6, h, 0.6, sx, 0.6, sz, DARK));
      for (const yy of [h * 0.45, h]) { g.add(box(7, 0.5, 0.5, 0, yy, -3, GLOW)); g.add(box(7, 0.5, 0.5, 0, yy, 3, DARK)); g.add(box(0.5, 0.5, 7, -3, yy, 0, DARK)); g.add(box(0.5, 0.5, 7, 3, yy, 0, DARK)); }
      const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 3.2, 6, 12), HULL); hull.rotation.z = Math.PI / 2; hull.position.set(0, h * 0.5, 0); g.add(hull);
      break;
    }
    case 'trade': {                          // stepped market ziggurat with bay glow
      for (let i = 0; i < 3 + Math.min(L, 3); i++) { const w = 7 - i * 1.5; g.add(box(w, 1.4, w, 0, 0.6 + i * 1.4, 0, i % 2 ? HULL : DARK)); }
      g.add(box(3, 1.6, 0.4, 0, 0.6, 3.05, GLOW));
      break;
    }
    case 'foundry': {                        // industrial block + stacks
      g.add(box(6.5, 3.2, 6.5, 0, 0.6, 0, DARK));
      for (let i = 0; i < 2 + Math.min(L, 3); i++) { const a = (i / (2 + Math.min(L, 3))) * 7, r = 1.6; g.add(cyl(0.7, 4 + (i % 2), Math.cos(a) * r, 3.8, Math.sin(a) * r, HULL, 10)); g.add(cyl(0.72, 0.4, Math.cos(a) * r, 3.8 + 4 + (i % 2), Math.sin(a) * r, WARM, 10)); }
      g.add(box(5, 0.4, 5, 0, 3.6, 0, WARM));
      break;
    }
    case 'sensors': {                        // mast + tilted dish
      g.add(cyl(0.5, 4 + L * 0.6, 0, 0.6, 0, HULL, 10));
      const dish = new THREE.Mesh(new THREE.SphereGeometry(2.6, 22, 12, 0, 7, 0, Math.PI / 2.4), DARK);
      dish.position.y = 4.6 + L * 0.6; dish.rotation.x = -0.9; g.add(dish);
      g.add(cyl(0.16, 1.6, 0, 4.6 + L * 0.6, 0, GLOW, 6));
      break;
    }
    default: g.add(box(5, 4, 5, 0, 0.6, 0, HULL));
  }
  return g;
}

export interface HQCity {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  update(dt: number): void; resize(w: number, h: number): void;
  pick(ndc: THREE.Vector2): string | null;
  setHover(key: string | null): void;
  refresh(key: string, level: number): void;
  setEnabled(on: boolean): void;
}

export function makeHQCity(renderer: THREE.WebGLRenderer, background: THREE.Texture | null, facilities: Facility[], levelOf: (k: string) => number): HQCity {
  const scene = new THREE.Scene();
  if (background) scene.environment = background;

  // platform (hex slab floating in space) + rim lights
  const platform = new THREE.Group(); scene.add(platform);
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(34, 30, 4, 6), new THREE.MeshStandardMaterial({ color: 0x2d3340, metalness: 0.4, roughness: 0.6 }));
  slab.position.y = -2; platform.add(slab);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(31, 31, 1.2, 6), DECK); deck.position.y = 0.1; platform.add(deck);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(31, 0.35, 8, 6), GLOW); rim.rotation.x = Math.PI / 2; rim.position.y = 0.8; platform.add(rim);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; platform.add(box(2, 1.4, 2, Math.cos(a) * 28, 0.4, Math.sin(a) * 28, GLOW)); }   // beacon posts

  // buildings: admin in the center, the rest on a ring
  const groups = new Map<string, THREE.Group>();
  const ring = facilities.filter((f) => f.key !== 'admin');
  const placeOne = (f: Facility) => {
    const grp = buildStructure(f.key, levelOf(f.key));
    if (f.key === 'admin') grp.position.set(0, 1, 0);
    else { const i = ring.indexOf(f); const a = (i / ring.length) * Math.PI * 2; grp.position.set(Math.cos(a) * 18, 1, Math.sin(a) * 18); grp.rotation.y = -a + Math.PI / 2; }
    (grp.userData as any).facKey = f.key;
    grp.traverse((o: any) => { if (o.isMesh) (o.userData as any).facKey = f.key; });
    groups.set(f.key, grp); platform.add(grp);
  };
  facilities.forEach(placeOne);

  // lighting: a warm key + cool fill so the city reads as a lit place
  const key = new THREE.DirectionalLight(0xfff0d8, 2.2); key.position.set(40, 60, 25); scene.add(key);
  scene.add(new THREE.DirectionalLight(0x6a86c0, 0.5).translateX(-40).translateZ(-30));
  scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x101622, 0.5));

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
  camera.position.set(46, 40, 46);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 6, 0); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 35; controls.maxDistance = 140; controls.maxPolarAngle = Math.PI * 0.46;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.35; controls.enablePan = false; controls.enabled = false;

  const ray = new THREE.Raycaster(); let hovered: string | null = null;
  const setEmissive = (key: string, mul: number) => {
    const g = groups.get(key); if (!g) return;
    g.traverse((o: any) => { if (o.isMesh && o.material && o.material.emissive) { o.userData.baseEI ??= o.material.emissiveIntensity; o.material = o.material; o.material.emissiveIntensity = o.userData.baseEI * mul; } });
  };

  return {
    scene, camera, controls,
    update() { controls.update(); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    pick(ndc) {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(platform, true);
      let o: THREE.Object3D | null = hit[0]?.object ?? null;
      while (o && (o.userData as any).facKey === undefined) o = o.parent;
      return o ? (o.userData as any).facKey : null;
    },
    setHover(k) {
      if (k === hovered) return;
      if (hovered) setEmissive(hovered, 1);
      hovered = k; if (k) setEmissive(k, 2.4);
      renderer.domElement.style.cursor = k ? 'pointer' : 'default';
    },
    refresh(k, level) {
      const old = groups.get(k); if (!old) return;
      const pos = old.position.clone(), rot = old.rotation.clone();
      platform.remove(old);
      const grp = buildStructure(k, level); grp.position.copy(pos); grp.rotation.copy(rot);
      (grp.userData as any).facKey = k; grp.traverse((o: any) => { if (o.isMesh) (o.userData as any).facKey = k; });
      groups.set(k, grp); platform.add(grp); if (hovered === k) setEmissive(k, 2.4);
    },
    setEnabled(on) { controls.enabled = on; controls.autoRotate = on; },
  };
}
