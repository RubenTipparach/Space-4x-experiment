// Build procedural 3D ship models (one per faction, following the design language)
// and render them to top-down sprite PNGs + a contact sheet.
// Uses Three.js (local) inside headless Chromium (SwiftShader WebGL) via Playwright.
//
// Run: PW_PATH="$(npm root -g)/playwright" node scripts/concept/render_sprites.mjs
// Out: assets/sprites/<faction>.png (transparent) + sprite-sheet.png
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(root, 'assets', 'sprites');
mkdirSync(out, { recursive: true });

const threeURL = '/node_modules/three/build/three.module.js';
const addonsURL = '/node_modules/three/examples/jsm/';

const SIZE = 512;
const FACTIONS = [
  ['consortium-galactica', 'Consortium Galactica', 'Galactic Council'],
  ['kareth-nara', 'Kareth Nara', 'Karisen Natives'],
  ['terra-nexum', 'Terra Nexum', 'Terran'],
  ['illumaria', 'Illumaria', 'Benefactor'],
  ['astryn-vel', "Astryn'Vel", 'Rebels'],
  ['ezrathi', 'Ezrathi', 'Cultists'],
  ['krithul', "Kri'thul", 'Plague'],
  ['shadur-kai', "Shadur'kai", 'Rogue'],
];

// ---- the in-page module: model builders + renderer ----
const page_module = `
import * as THREE from 'three';
let RoomEnvironment = null;
try { ({ RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js')); } catch(e){}

const SIZE = ${SIZE};
const std = (o) => new THREE.MeshStandardMaterial(o);
const emis = (c, i=1.6) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4, metalness: 0 });
const box = (w,h,d,m,x=0,y=0,z=0) => { const e=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m); e.position.set(x,y,z); return e; };
const cyl = (rt,rb,h,m,seg=24) => new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),m);
const sph = (r,m,seg=24) => new THREE.Mesh(new THREE.SphereGeometry(r,seg,seg),m);
function wing(len, chord, sweep, thick, m){ // swept wing as extruded shape in XZ, thin in Y
  const s=new THREE.Shape();
  s.moveTo(0,0); s.lineTo(len, sweep); s.lineTo(len, sweep+chord*0.4); s.lineTo(0, chord); s.closePath();
  const g=new THREE.ExtrudeGeometry(s,{depth:thick,bevelEnabled:true,bevelThickness:thick*0.4,bevelSize:thick*0.4,bevelSegments:2});
  g.rotateX(-Math.PI/2); const e=new THREE.Mesh(g,m); return e;
}
function tube(points, r, m){ const c=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))); return new THREE.Mesh(new THREE.TubeGeometry(c, 24, r, 8), m); }
const put=(mesh,p,r,sc)=>{ if(p)mesh.position.set(p[0],p[1],p[2]); if(r)mesh.rotation.set(r[0],r[1],r[2]); if(sc)mesh.scale.set(sc[0],sc[1],sc[2]); return mesh; };

// forward = -Z (top of sprite), up = +Y, right = +X
const builders = {
  'consortium-galactica'(){ const g=new THREE.Group();
    const white=std({color:0xe8edf2,metalness:0.65,roughness:0.32});
    const gold=std({color:0xd9a93a,metalness:0.9,roughness:0.3});
    // saucer via lathe
    const pts=[[0,0.22],[1.3,0.2],[2.0,0.07],[2.15,0],[2.0,-0.06],[1.2,-0.14],[0,-0.12]].map(p=>new THREE.Vector2(...p));
    const saucer=new THREE.Mesh(new THREE.LatheGeometry(pts,56),white); saucer.position.z=-1.1; g.add(saucer);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(2.05,0.05,12,64),gold); rim.rotation.x=Math.PI/2; rim.position.z=-1.1; g.add(rim);
    g.add(put(sph(0.32,white), [0,0.28,-1.1]));
    g.add(box(0.7,0.32,1.4,white,0,-0.05,0.5)); // neck
    const eng=new THREE.Mesh(new THREE.CapsuleGeometry(0.42,1.7,8,16),white); eng.rotation.x=Math.PI/2; eng.position.set(0,-0.1,1.25); g.add(eng);
    g.add(put(cyl(0.3,0.3,0.12,emis(0x5ec8ff,2.2)), [0,-0.1,0.35], [Math.PI/2,0,0])); // deflector
    for(const sx of [-1,1]){
      g.add(box(0.16,0.16,1.0,white, sx*0.9,0.25,1.1)); // pylon
      const nac=new THREE.Mesh(new THREE.CapsuleGeometry(0.26,1.9,8,16),white); nac.rotation.x=Math.PI/2; nac.position.set(sx*1.6,0.5,1.0); g.add(nac);
      g.add(put(sph(0.27,emis(0x5ec8ff,2.4)), [sx*1.6,0.5,-0.05])); // bussard
    }
    return g; },

  'kareth-nara'(){ const g=new THREE.Group();
    const green=std({color:0x1f5a3a,metalness:0.35,roughness:0.45});
    const hull=sph(1,green); hull.scale.set(1.0,0.34,2.3); g.add(hull);
    for(const sx of [-1,1]){ const w=wing(2.6,1.2,1.9,0.16,green); w.scale.x=sx; w.position.set(sx*0.5,0,-0.8);
      w.rotation.y = sx*0.18; g.add(w); }
    // bioluminescent veins
    const veinM=emis(0x7dffc4,2.2);
    g.add(tube([[0,0.34,-2.2],[0.0,0.4,-0.5],[0.0,0.3,1.6]],0.05,veinM));
    g.add(tube([[0.1,0.3,-0.4],[1.1,0.05,0.4],[2.0,0.0,1.4]],0.045,veinM));
    g.add(tube([[-0.1,0.3,-0.4],[-1.1,0.05,0.4],[-2.0,0.0,1.4]],0.045,veinM));
    const cry=emis(0x7dffc4,2.0);
    for(const [x,z] of [[0,-2.0],[1.0,0.6],[-1.0,0.6]]) g.add(put(new THREE.Mesh(new THREE.OctahedronGeometry(0.22),cry), [x,0.25,z]));
    g.add(put(sph(0.3,emis(0x7dffc4,2.6)), [0,0.05,2.0]));
    return g; },

  'terra-nexum'(){ const g=new THREE.Group();
    const rust=std({color:0x9c5a2c,metalness:0.55,roughness:0.78});
    const dark=std({color:0x5e3417,metalness:0.5,roughness:0.85});
    const tan=std({color:0xcaa45a,metalness:0.6,roughness:0.6});
    g.add(box(1.5,0.95,3.4,rust,0,0,0.1));
    g.add(box(1.0,0.8,0.7,rust,0,0.1,-1.9)); // nose block
    g.add(box(1.2,0.5,3.0,dark,0,0.55,0.1)); // top deck
    g.add(box(1.1,0.7,1.4,dark,-1.4,-0.1,0.2)); // salvage pod (asymmetric)
    g.add(put(cyl(0.05,0.05,0.7,tan), [-0.95,0,-0.1], [0,0,Math.PI/2]));
    g.add(put(cyl(0.04,0.04,1.3,tan), [1.1,0.5,-0.4], [0,0,-0.6])); // antenna
    g.add(put(sph(0.1,emis(0xff8a3c,2)), [1.5,0.95,-0.7]));
    for(const sx of [-0.45,0.45]){ const e=cyl(0.34,0.34,0.7,dark); e.rotation.x=Math.PI/2; e.position.set(sx,-0.1,2.0); g.add(e);
      g.add(put(cyl(0.3,0.3,0.12,emis(0xff8a3c,2.2)), [sx,-0.1,2.36], [Math.PI/2,0,0])); }
    for(const sx of [-0.5,0.5]) g.add(put(cyl(0.06,0.06,1.0,tan), [sx,0.2,-2.1], [Math.PI/2,0,0])); // guns
    g.add(box(0.5,0.35,0.4,tan,0.3,0.5,-1.0)); // greeble
    return g; },

  'illumaria'(){ const g=new THREE.Group();
    const dark=std({color:0x2a2440,metalness:0.7,roughness:0.28});
    // arrowhead fuselage
    const s=new THREE.Shape(); s.moveTo(0,-2.4); s.lineTo(1.1,1.4); s.lineTo(0,0.7); s.lineTo(-1.1,1.4); s.closePath();
    const fg=new THREE.ExtrudeGeometry(s,{depth:0.5,bevelEnabled:true,bevelThickness:0.18,bevelSize:0.18,bevelSegments:2}); fg.rotateX(-Math.PI/2); fg.center();
    const fus=new THREE.Mesh(fg,dark); g.add(fus);
    for(const sx of [-1,1]){ const w=wing(2.2,0.9,2.0,0.12,dark); w.scale.x=sx; w.position.set(sx*0.4,-0.05,-0.2); g.add(w); }
    g.add(box(0.12,0.18,3.2,emis(0xd24bff,2.2),0,0.22,-0.2)); // spine
    g.add(put(sph(0.26,emis(0xd24bff,2.4)), [0,0.05,1.5]));
    return g; },

  'astryn-vel'(){ const g=new THREE.Group();
    const olive=std({color:0x5c6645,metalness:0.5,roughness:0.7});
    const dark=std({color:0x33371f,metalness:0.5,roughness:0.8});
    g.add(box(0.8,0.6,3.0,olive,0,0,0.1));
    g.add(put(cyl(0.0,0.4,0.9,olive), [0,0,-1.9], [-Math.PI/2,0,0])); // nose cone
    g.add(box(0.18,0.12,1.4,emis(0xd7822e,1.6),0,0.32,-0.4)); // orange stripe
    g.add(box(0.5,0.4,0.6,dark,-0.45,0.1,0.2)); // mismatched panel
    const wm=[olive,dark,olive,dark];
    const conf=[[-1,0.3,0.3],[1,-0.3,0.5],[-1,-0.4,0.6],[1,0.25,0.2]];
    conf.forEach((c,i)=>{ const w=wing(1.9,0.7,1.4,0.12,wm[i]); w.scale.x=c[0]; w.position.set(c[0]*0.4,c[1]*0.0,c[2]); w.rotation.z=c[1]; g.add(w); });
    for(const sx of [-0.4,0.4]){ const e=cyl(0.22,0.22,0.6,dark); e.rotation.x=Math.PI/2; e.position.set(sx,0,1.7); g.add(e);
      g.add(put(sph(0.2,emis(0x9be84a,2.2)), [sx,0,2.0])); }
    return g; },

  'ezrathi'(){ const g=new THREE.Group();
    const obs=std({color:0x1a1622,metalness:0.4,roughness:0.4});
    const vio=std({color:0x6b3fa0,metalness:0.6,roughness:0.4});
    const core=emis(0x8cff6b,2.4);
    const s=new THREE.Shape(); s.moveTo(0,-2.6); s.lineTo(0.8,0.0); s.lineTo(0.5,2.0); s.lineTo(-0.5,2.0); s.lineTo(-0.8,0.0); s.closePath();
    const fg=new THREE.ExtrudeGeometry(s,{depth:0.7,bevelEnabled:true,bevelThickness:0.2,bevelSize:0.15,bevelSegments:1}); fg.rotateX(-Math.PI/2); fg.center();
    g.add(new THREE.Mesh(fg,obs));
    // asymmetric blades
    g.add(put(new THREE.Mesh(new THREE.TetrahedronGeometry(1.1),obs), [-1.4,0,0.6], [0.5,0.4,0.8]));
    g.add(put(new THREE.Mesh(new THREE.TetrahedronGeometry(0.8),obs), [1.3,0,0.2], [0.3,0.7,0.2]));
    // floating monolith shards
    for(const sx of [-1,1]) g.add(put(box(0.3,1.4,0.3,vio, sx*2.0,0.1,-0.2), null, [0.2*sx,0,0.25*sx]));
    // void core + rune
    g.add(put(sph(0.4,core), [0,0.25,0]));
    g.add(box(0.7,0.07,0.07,core,0,0.5,0)); g.add(box(0.07,0.07,0.7,core,0,0.5,0));
    g.add(put(sph(0.28,emis(0xa070ff,2.2)), [0,0.1,2.0])); // drive
    return g; },

  'krithul'(){ const g=new THREE.Group();
    const flesh=std({color:0x6f7a2e,metalness:0.1,roughness:0.85});
    const pus=emis(0xc6ff3a,2.2);
    const blobs=[[0,0,-0.6,1.0],[0.4,0,0.6,0.95],[-0.5,0.0,0.2,0.8],[0.2,0.1,-1.4,0.6],[-0.2,-0.1,1.2,0.7]];
    blobs.forEach(b=>{ const m=sph(b[3],flesh); m.position.set(b[0],b[1],b[2]); m.scale.set(1,0.7,1.25); g.add(m); });
    for(const [x,y,z,r] of [[0.3,0.45,-0.4,0.22],[-0.4,0.4,0.5,0.26],[0.5,0.35,1.0,0.18]]) g.add(put(sph(r,pus), [x,y,z]));
    // tendrils trailing
    g.add(tube([[0.3,0,1.4],[0.6,-0.1,2.2],[0.4,-0.2,3.0]],0.1,flesh));
    g.add(tube([[-0.3,0,1.4],[-0.7,-0.1,2.3],[-0.5,-0.2,3.1]],0.09,flesh));
    g.add(tube([[0.0,0,1.5],[0.0,-0.15,2.4],[0.1,-0.25,3.2]],0.08,flesh));
    g.add(put(sph(0.34,emis(0xc6ff3a,2.4)), [0,0,1.6]));
    return g; },

  'shadur-kai'(){ const g=new THREE.Group();
    const dark=std({color:0x16202e,metalness:0.72,roughness:0.3});
    const s=new THREE.Shape(); s.moveTo(0,-2.7); s.lineTo(0.55,0.0); s.lineTo(0.3,2.3); s.lineTo(-0.3,2.3); s.lineTo(-0.55,0.0); s.closePath();
    const fg=new THREE.ExtrudeGeometry(s,{depth:0.45,bevelEnabled:true,bevelThickness:0.16,bevelSize:0.14,bevelSegments:2}); fg.rotateX(-Math.PI/2); fg.center();
    g.add(new THREE.Mesh(fg,dark));
    for(const sx of [-1,1]){ const w=wing(1.7,0.6,1.5,0.1,dark); w.scale.x=sx; w.position.set(sx*0.3,0,1.2); g.add(w); }
    for(const sx of [-1,1]) g.add(box(0.05,0.16,3.4,emis(0x37e6ff,2.2), sx*0.42,0.12,-0.1)); // edge lines
    g.add(put(sph(0.2,emis(0x37e6ff,2.4)), [0,0.16,-0.6])); // cockpit
    g.add(put(sph(0.22,emis(0x37e6ff,2.4)), [0,0,2.2])); // drive
    return g; },
};

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
renderer.setSize(SIZE, SIZE);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
let envTex = null;
if (RoomEnvironment) { const pmrem = new THREE.PMREMGenerator(renderer); envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = envTex; }
const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(-4,7,-2); key.castShadow=true; scene.add(key);
const fill = new THREE.DirectionalLight(0xbcd0ff, 0.7); fill.position.set(5,3,4); scene.add(fill);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));

function frame(group){
  const b=new THREE.Box3().setFromObject(group); const sphere=b.getBoundingSphere(new THREE.Sphere());
  const r=sphere.radius*1.08; const c=sphere.center;
  const cam=new THREE.OrthographicCamera(-r,r,r,-r,0.1,200);
  cam.up.set(0,0,-1);
  cam.position.set(c.x + r*0.0, c.y + r*3.0, c.z + r*1.25);
  cam.lookAt(c); cam.updateProjectionMatrix();
  return cam;
}

window.__sprites = {};
for (const [id, fn] of Object.entries(builders)){
  const grp = fn();
  scene.add(grp);
  const cam = frame(grp);
  renderer.render(scene, cam);
  window.__sprites[id] = renderer.domElement.toDataURL('image/png');
  scene.remove(grp);
}
window.__ready = true;
`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${threeURL}","three/addons/":"${addonsURL}"}}<\/script>
</head><body style="margin:0;background:#000">
<script type="module">${page_module}<\/script>
</body></html>`;

const MIME = { '.js':'text/javascript', '.mjs':'text/javascript', '.html':'text/html', '.png':'image/png', '.json':'application/json' };
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, {'Content-Type':'text/html'}); return res.end(html); }
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  const ext = p.slice(p.lastIndexOf('.'));
  res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
  res.end(readFileSync(p));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type()==='error') console.log('CONSOLE-ERR', m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
const sprites = await page.evaluate('window.__sprites');

for (const [id] of FACTIONS){
  const data = sprites[id];
  if (!data){ console.log('MISSING', id); continue; }
  writeFileSync(join(out, `${id}.png`), Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', `assets/sprites/${id}.png`);
}

// contact sheet from the rendered sprites
const cards = FACTIONS.map(([id,name,sub])=>`<div class="card"><img src="${sprites[id]}"><div class="n">${name}</div><div class="s">${sub}</div></div>`).join('');
const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:radial-gradient(circle at 50% 25%,#0e1622,#04060b 72%);font-family:'Segoe UI',Arial,sans-serif;color:#cdd6e3">
<div style="padding:24px 30px 4px;font-size:29px;font-weight:600;color:#eaf1fb">Stellar Frontier — Faction Ships (3D-rendered sprites)</div>
<div style="padding:0 30px 14px;font-size:15px;color:#8290a6">Thallian Nebula · procedural 3D models, top-down render · concept pass for approval</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:8px 26px 28px">${cards}</div>
<style>.card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:10px;text-align:center}
.card img{width:100%;height:auto;display:block}.n{font-size:17px;font-weight:600;color:#f2f6fc;margin-top:4px}.s{font-size:12.5px;color:#8fa0ba}</style></body>`;
await page.setContent(sheet, { waitUntil:'networkidle' });
await page.setViewportSize({ width:1280, height:760 });
await (await page.$('body')).screenshot({ path: join(out,'sprite-sheet.png') });
await browser.close();
server.close();
console.log('wrote assets/sprites/sprite-sheet.png');
