// Proof: light a ship SPRITE with its NORMAL MAP, reacting to a movable light.
// Three.js (local) + a custom shader, rendered headless (SwiftShader) twice:
// light from screen-left and screen-right, to show the lit side follows the light.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const threeURL = '/node_modules/three/build/three.module.js';
const ALB = '/client/public/sprites/nm/consortium-galactica_albedo.png';
const NRM = '/client/public/sprites/nm/consortium-galactica_n.png';
// decode tweak via env: SWAP=1 swaps G/B; SX/SY/SZ flip signs
const SWAP = process.env.SWAP === '1';

const page_module = `
import * as THREE from 'three';
const W = 512;
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
renderer.setSize(W, W);
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1,1,1,-1,0.1,10); cam.position.set(0,0,3); cam.lookAt(0,0,0);
const loader = new THREE.TextureLoader();
const load = (u)=> new Promise((res)=>loader.load(u,(t)=>res(t)));
const [alb, nrm] = await Promise.all([load('${ALB}'), load('${NRM}')]);
alb.colorSpace = THREE.SRGBColorSpace; nrm.colorSpace = THREE.NoColorSpace;
const mat = new THREE.ShaderMaterial({
  transparent:true,
  uniforms:{ uAlbedo:{value:alb}, uNormal:{value:nrm}, uLight:{value:new THREE.Vector3(1,0.3,0.7)}, uAmbient:{value:0.28} },
  vertexShader:\`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} \`,
  fragmentShader:\`
    varying vec2 vUv; uniform sampler2D uAlbedo, uNormal; uniform vec3 uLight; uniform float uAmbient;
    void main(){
      vec4 a = texture2D(uAlbedo, vUv); if(a.a < 0.1) discard;
      vec3 raw = texture2D(uNormal, vUv).rgb*2.0 - 1.0;
      vec3 n = normalize(${SWAP ? 'vec3(raw.r, raw.b, raw.g)' : 'raw'});
      float d = max(0.0, dot(n, normalize(uLight)));
      vec3 col = a.rgb * (uAmbient + d*1.15);
      gl_FragColor = vec4(col, a.a);
    }\`,
});
const plane = new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat);
scene.add(plane);

function shot(lx,ly,lz){ mat.uniforms.uLight.value.set(lx,ly,lz); renderer.render(scene,cam); return renderer.domElement.toDataURL('image/png'); }
window.__shots = { left: shot(-1,0.3,0.7), right: shot(1,0.3,0.7), top: shot(0,1,0.7) };
window.__ready = true;
`;

const html = `<!doctype html><html><head><meta charset=utf-8>
<script type="importmap">{"imports":{"three":"${threeURL}"}}<\/script></head>
<body style="margin:0;background:#0b0f18"><script type="module">${page_module}<\/script></body></html>`;

const MIME = { '.js':'text/javascript', '.png':'image/png', '.html':'text/html' };
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, {'Content-Type':'text/html'}); return res.end(html); }
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream'});
  res.end(readFileSync(p));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await chromium.launch({ args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', e=>console.log('PAGEERR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction('window.__ready===true', { timeout: 30000 });
const shots = await page.evaluate('window.__shots');
for (const [k,d] of Object.entries(shots)) writeFileSync(join(root,'client/public/sprites/nm',`lit_${k}.png`), Buffer.from(d.split(',')[1],'base64'));
console.log('wrote lit_left/right/top.png  (SWAP=' + SWAP + ')');
await browser.close(); server.close();