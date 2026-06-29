// Validate: light the EXISTING lit sprite (as albedo) with the new per-yaw normal map,
// using a modulation formula (baked shading kept, directional term added on top).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PIXI = '/client/node_modules/pixi.js/dist/pixi.mjs';
const YAW = process.env.YAW || '000';
const ALB = `/client/public/sprites/consortium-galactica_y${YAW}.png`;
const NRM = `/client/public/sprites/nm/consortium-galactica_y${YAW}_n.png`;

const page_module = `
import { Application, Geometry, Mesh, Shader, Assets } from 'pixi.js';
const app = new Application();
await app.init({ width:512, height:512, background:0x0b0f18, preference:'webgl' });
document.body.appendChild(app.canvas);
const alb = await Assets.load('${ALB}');
const nrm = await Assets.load('${NRM}');
const S = 460;
const geometry = new Geometry({ attributes: {
  aPosition: [0,0, S,0, S,S, 0,S],
  aUV: [0,0, 1,0, 1,1, 0,1],
}, indexBuffer: [0,1,2, 0,2,3] });
const vertex = \`#version 300 es
  in vec2 aPosition; in vec2 aUV; out vec2 vUV;
  uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
  void main(){ mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition,1.0)).xy, 0.0, 1.0); vUV = aUV; }\`;
const fragment = \`#version 300 es
  precision highp float;
  in vec2 vUV; out vec4 fragColor;
  uniform sampler2D uAlbedo; uniform sampler2D uNormal;
  uniform vec3 uLight; uniform float uStrength; uniform float uBias;
  void main(){
    vec4 a = texture(uAlbedo, vUV); if(a.a < 0.1) discard;
    vec3 raw = texture(uNormal, vUV).rgb * 2.0 - 1.0;
    vec3 n = normalize(vec3(raw.r, raw.b, raw.g));   // Blender camera-space decode
    float d = dot(n, normalize(uLight));
    float lit = 1.0 + uStrength * (d - uBias);       // modulate baked albedo
    fragColor = vec4(a.rgb * clamp(lit, 0.25, 1.9), a.a);
  }\`;
const shader = Shader.from({ gl: { vertex, fragment }, resources: {
  uAlbedo: alb.source, uNormal: nrm.source,
  lightUniforms: {
    uLight: { value: [-1,0.3,0.6], type:'vec3<f32>' },
    uStrength: { value: 0.7, type:'f32' },
    uBias: { value: 0.35, type:'f32' },
  },
}});
const mesh = new Mesh({ geometry, shader });
mesh.x = 26; mesh.y = 26; app.stage.addChild(mesh);
function shot(lx,ly,lz){ shader.resources.lightUniforms.uniforms.uLight = [lx,ly,lz]; app.render(); return app.canvas.toDataURL('image/png'); }
window.__shots = { left: shot(-1,0.3,0.6), right: shot(1,0.3,0.6) };
window.__ready = true;
`;

const html = `<!doctype html><html><head><meta charset=utf-8>
<script type="importmap">{"imports":{"pixi.js":"${PIXI}"}}<\/script></head>
<body style="margin:0;background:#0b0f18"><script type="module">${page_module}<\/script></body></html>`;

const MIME = { '.js':'text/javascript', '.mjs':'text/javascript', '.png':'image/png', '.html':'text/html' };
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
page.on('console', m=>{ if(m.type()==='error') console.log('ERR', m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction('window.__ready===true', { timeout: 30000 });
const shots = await page.evaluate('window.__shots');
for (const [k,d] of Object.entries(shots)) writeFileSync(join(root,'client/public/sprites/nm',`relit_${k}.png`), Buffer.from(d.split(',')[1],'base64'));
console.log('wrote relit_left/right.png');
await browser.close(); server.close();
