// 3D galaxy map: a star cluster on the XZ plane where each star has its own little
// orbiting-planet system, connected by jump lanes. Plus a hyperspace-tunnel scene shown
// while a ship is in transit. Both are standalone Three.js scenes driven by main.ts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Galaxy { systems: { id: number; name: string; x: number; y: number; star: { class: string; color: number }; planets: number }[]; links: number[][]; meta: any; }

export interface Galaxy3D {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  update(dt: number, fleet: { x: number; z: number; color: number; sel: boolean; visible: boolean }[], hoverSys: number, routePreview: number[] | null, voyages: number[][]): void;
  pickStar(ndc: THREE.Vector2): number | null;
  focusOn(x: number, z: number): void;
  resize(w: number, h: number): void; setEnabled(on: boolean): void;
}

export function makeGalaxy3D(renderer: THREE.WebGLRenderer, background: THREE.Texture | null, g: Galaxy): Galaxy3D {
  const scene = new THREE.Scene();
  if (background) scene.background = background;
  scene.add(new THREE.HemisphereLight(0xaecbff, 0x0a0e16, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(1, 2, 1); scene.add(sun);

  const sys = g.systems;
  const pos3 = (i: number) => new THREE.Vector3(sys[i].x, 0, sys[i].y);

  // jump lanes
  const lpts: number[] = [];
  for (const [a, b] of g.links) { lpts.push(sys[a].x, 0, sys[a].y, sys[b].x, 0, sys[b].y); }
  const lanes = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lpts, 3)),
    new THREE.LineBasicMaterial({ color: 0x44638f, transparent: true, opacity: 0.25 }));
  scene.add(lanes);

  // stars (emissive spheres) — raycast targets for ordering
  const starGeo = new THREE.SphereGeometry(1, 16, 12);
  const stars: THREE.Mesh[] = sys.map((s, i) => {
    const m = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: s.star.color }));
    m.scale.setScalar(i === 0 ? 9 : 6); m.position.copy(pos3(i)); (m.userData as any).sysId = i; scene.add(m);
    // soft glow halo
    const halo = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: s.star.color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar((i === 0 ? 9 : 6) * 2.4); halo.position.copy(pos3(i)); scene.add(halo);
    return m;
  });
  // home ring
  const homeRing = new THREE.Mesh(new THREE.TorusGeometry(16, 0.9, 8, 40), new THREE.MeshBasicMaterial({ color: 0x7fdcff }));
  homeRing.rotation.x = Math.PI / 2; homeRing.position.copy(pos3(0)); scene.add(homeRing);

  // each star's planets: one InstancedMesh for all of them
  type P = { star: number; r: number; sp: number; ph: number };
  const planets: P[] = [];
  for (let i = 0; i < sys.length; i++) for (let j = 0; j < sys[i].planets; j++) planets.push({ star: i, r: 11 + j * 3.0, sp: 0.5 / (j + 1) + 0.05, ph: (i * 7 + j * 53) % 100 / 100 * 7 });
  const pGeo = new THREE.SphereGeometry(2.0, 10, 8);
  const pMat = new THREE.MeshBasicMaterial({});   // unlit white; per-instance color tints it (always reads on the map)
  const pInst = new THREE.InstancedMesh(pGeo, pMat, planets.length);
  const pal = [0x6fae72, 0x4790a0, 0xb5642f, 0xc89a5a, 0x9d7fc0, 0xc2c8d2];
  planets.forEach((p, k) => pInst.setColorAt(k, new THREE.Color(pal[(p.star * 3 + k) % pal.length])));
  if (pInst.instanceColor) pInst.instanceColor.needsUpdate = true;
  scene.add(pInst);

  // hover ring + route/voyage lines (rebuilt each frame)
  const hoverRing = new THREE.Mesh(new THREE.TorusGeometry(10, 0.7, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  hoverRing.rotation.x = Math.PI / 2; hoverRing.visible = false; scene.add(hoverRing);
  const ROUTE_Y = 6;   // lift the route above the lane/star plane so it reads clearly
  const routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8ff0ff })); routeLine.frustumCulled = false; scene.add(routeLine);
  const voyLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x9fe8ff, dashSize: 18, gapSize: 12 })); voyLine.frustumCulled = false; scene.add(voyLine);

  // fleet markers (cones)
  const markGeo = new THREE.ConeGeometry(5, 12, 5); const marks: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })); m.rotation.x = Math.PI; m.visible = false; scene.add(m); marks.push(m); }
  const markSel = new THREE.Mesh(new THREE.TorusGeometry(8, 0.6, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffffff })); markSel.rotation.x = Math.PI / 2; markSel.visible = false; scene.add(markSel);
  // big bobbing "you are here" arrow over the selected ship so it's easy to find on the map
  const selArrow = new THREE.Group();
  const arrowCone = new THREE.Mesh(new THREE.ConeGeometry(15, 26, 4), new THREE.MeshBasicMaterial({ color: 0xffe24a }));
  arrowCone.rotation.x = Math.PI;   // apex points down at the ship
  const arrowGlow = new THREE.Mesh(new THREE.ConeGeometry(22, 38, 4), new THREE.MeshBasicMaterial({ color: 0xffe24a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  arrowGlow.rotation.x = Math.PI;
  selArrow.add(arrowCone, arrowGlow); selArrow.visible = false; scene.add(selArrow);

  const camera = new THREE.PerspectiveCamera(35, 1, 1, 60000);
  camera.position.set(0, 1500, 1500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.set(0, 0, 0);
  controls.minDistance = 40; controls.maxDistance = 6000; controls.maxPolarAngle = Math.PI * 0.49; controls.enabled = false;

  const ray = new THREE.Raycaster(); ray.params.Line = { threshold: 6 }; const mat4 = new THREE.Matrix4(); let t = 0;

  return {
    scene, camera, controls,
    update(dt, fleet, hoverSys, routePreview, voyages) {
      t += dt; controls.update();
      // planets orbit
      planets.forEach((p, k) => { const s = pos3(p.star); const a = p.ph + t * p.sp; mat4.makeTranslation(s.x + Math.cos(a) * p.r, 0, s.z + Math.sin(a) * p.r); pInst.setMatrixAt(k, mat4); });
      pInst.instanceMatrix.needsUpdate = true;
      hoverRing.visible = hoverSys >= 0; if (hoverSys >= 0) hoverRing.position.copy(pos3(hoverSys));
      const selF = fleet.find((f) => f.sel && f.visible) || null;
      // route preview: a clear line from the selected ship to the star under the cursor
      if (routePreview && routePreview.length > 1) {
        const pts = routePreview.map((id) => new THREE.Vector3(pos3(id).x, ROUTE_Y, pos3(id).z));
        if (selF) pts[0] = new THREE.Vector3(selF.x, ROUTE_Y, selF.z);   // start exactly at the ship
        routeLine.geometry.setFromPoints(pts); routeLine.geometry.computeBoundingSphere(); routeLine.visible = true;
      } else routeLine.visible = false;
      // active voyages (dashed)
      const vp: THREE.Vector3[] = [];
      for (const r of voyages) for (let i = 0; i + 1 < r.length; i++) { vp.push(new THREE.Vector3(pos3(r[i]).x, ROUTE_Y, pos3(r[i]).z), new THREE.Vector3(pos3(r[i + 1]).x, ROUTE_Y, pos3(r[i + 1]).z)); }
      if (vp.length) { voyLine.geometry.setFromPoints(vp); voyLine.computeLineDistances(); voyLine.visible = true; } else voyLine.visible = false;
      // fleet markers
      fleet.forEach((f, i) => { const m = marks[i]; if (!m) return; m.visible = f.visible; if (f.visible) { m.position.set(f.x, 9, f.z); (m.material as THREE.MeshBasicMaterial).color.setHex(f.color); if (f.sel) { markSel.visible = true; markSel.position.set(f.x, 2, f.z); } } });
      if (!selF) markSel.visible = false;
      // giant "here is your ship" arrow over the selected ship
      if (selF) { selArrow.visible = true; selArrow.position.set(selF.x, 64 + Math.sin(t * 2.4) * 5, selF.z); } else selArrow.visible = false;
    },
    pickStar(ndc) { ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(stars, false); return hit.length ? (hit[0].object.userData as any).sysId : null; },
    focusOn(x, z) { controls.target.set(x, 0, z); camera.position.set(x, 300, z + 380); controls.update(); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    setEnabled(on) { controls.enabled = on; },
  };
}

// ---------------- hyperspace tunnel ----------------
export interface Hyperspace { scene: THREE.Scene; camera: THREE.PerspectiveCamera; update(dt: number): void; setShip(obj: THREE.Object3D | null): void; resize(w: number, h: number): void; }

export function makeHyperspace(renderer: THREE.WebGLRenderer, background: THREE.Texture | null): Hyperspace {
  void renderer;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);

  // star streaks in a tube around the travel (-Z) axis
  const N = 1500, span = 600, pos = new Float32Array(N * 6), col = new Float32Array(N * 6);
  const seg: { x: number; y: number; len: number }[] = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 7, rr = 6 + Math.random() * 46, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    const z = -span + Math.random() * (span + 60), len = 8 + Math.random() * 26;
    seg.push({ x, y, len });
    pos.set([x, y, z, x, y, z + len], i * 6);
    const c = new THREE.Color().setHSL(0.55 + Math.random() * 0.08, 0.9, 0.7);
    col.set([c.r * 0.4, c.g * 0.4, c.b * 0.4, c.r, c.g, c.b], i * 6);   // tail dim, head bright
  }
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(streaks);

  // wormhole wall: an open tube with a scrolling additive ring texture
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const cx = cv.getContext('2d')!;
  cx.fillStyle = '#000'; cx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 256; i += 8) { cx.fillStyle = `rgba(120,180,255,${0.06 + 0.08 * Math.random()})`; cx.fillRect(0, i, 64, 2 + Math.random() * 3); }
  const tubeTex = new THREE.CanvasTexture(cv); tubeTex.wrapS = tubeTex.wrapT = THREE.RepeatWrapping; tubeTex.repeat.set(6, 4);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(56, 56, span + 80, 40, 1, true),
    new THREE.MeshBasicMaterial({ map: tubeTex, color: 0x4a7bd0, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
  tube.rotation.x = Math.PI / 2; tube.position.z = -span / 2 + 30; scene.add(tube);

  // lighting + engine glow for the ship
  scene.add(new THREE.HemisphereLight(0x9fc0ff, 0x101626, 1.0));
  const key = new THREE.DirectionalLight(0xcfe0ff, 1.6); key.position.set(2, 3, 4); scene.add(key);
  const glowCv = document.createElement('canvas'); glowCv.width = glowCv.height = 128; const gc = glowCv.getContext('2d')!;
  const grd = gc.createRadialGradient(64, 64, 0, 64, 64, 64); grd.addColorStop(0, 'rgba(150,220,255,0.9)'); grd.addColorStop(1, 'rgba(80,160,255,0)');
  gc.fillStyle = grd; gc.fillRect(0, 0, 128, 128);
  const engine = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCv), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  engine.scale.setScalar(16); engine.position.set(0, -3, 26); scene.add(engine);
  // a fill light from behind the camera so the ship's near (rear) side reads
  const rim = new THREE.DirectionalLight(0xbfe0ff, 1.1); rim.position.set(0, 6, 40); scene.add(rim);

  let shipHolder: THREE.Object3D | null = null;
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 4000);
  camera.position.set(0, 6, 40); camera.lookAt(0, -3, -60);
  let t = 0;

  return {
    scene, camera,
    update(dt) {
      t += dt;
      const v = 320 * dt;
      for (let i = 0; i < N; i++) { let za = pos[i * 6 + 2] + v, zb = pos[i * 6 + 5] + v; if (za > 60) { za -= span + 60; zb -= span + 60; } pos[i * 6 + 2] = za; pos[i * 6 + 5] = zb; }
      streakGeo.attributes.position.needsUpdate = true;
      tubeTex.offset.y -= dt * 1.6; tube.rotation.y += dt * 0.05;
      if (shipHolder) { shipHolder.position.set(Math.sin(t * 0.8) * 1.4, -3.5 + Math.sin(t * 1.3) * 0.7, 20); shipHolder.rotation.z = Math.sin(t * 0.6) * 0.12; }
      engine.material.opacity = 0.7 + 0.3 * Math.sin(t * 12);
    },
    setShip(obj) {
      if (shipHolder) { scene.remove(shipHolder); shipHolder = null; }
      if (!obj) return;
      const c = obj.clone(true);
      c.rotation.set(0, Math.PI, 0);   // nose toward -Z (into the tunnel); we view its rear 3/4
      const pl = c.getObjectByName('plume');   // cloned exhaust: lock it to full burn
      if (pl) {
        pl.scale.set(1.1, 1.1, 1.8);
        pl.traverse((o: any) => {
          if (o.material) { o.material = o.material.clone(); o.material.opacity = o.isSprite ? 0.85 : 0.55; }
          if (o.isLight) o.intensity = 2.6;
        });
      }
      // normalize size and recenter so the model sits at the holder origin (in frame)
      const bbox = new THREE.Box3().setFromObject(c), size = new THREE.Vector3(); bbox.getSize(size);
      const s = 15 / Math.max(size.x, size.y, size.z, 0.001); c.scale.multiplyScalar(s);
      const c2 = new THREE.Box3().setFromObject(c), ctr = new THREE.Vector3(); c2.getCenter(ctr);
      c.position.sub(ctr);
      const h = new THREE.Group(); h.add(c); h.position.set(0, -3.5, 20); scene.add(h); shipHolder = h;
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
  };
}
