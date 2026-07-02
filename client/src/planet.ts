// Procedural shader planets for the 3D scene: real lit spheres with terrain + water,
// ice caps, animated clouds, night-side city lights, and an atmospheric rim. Gas giants
// get turbulent latitude bands and a storm. The sun is at the origin, so every planet's
// day/night terminator is computed per-pixel from its world position.
import * as THREE from 'three';

// --- 3D simplex noise (Ashima / Stefan Gustavson) + fbm, shared by the shaders ---
const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float f=0.0,a=0.5; for(int i=0;i<5;i++){ f+=a*snoise(p); p*=2.03; a*=0.5; } return f; }
`;

const VERT = `
varying vec3 vLocal; varying vec3 vWN; varying vec3 vWP;
void main(){
  vLocal = position;
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const ROCKY_FRAG = NOISE + `
uniform vec3 uColor; uniform float uSeed; uniform float uTime; uniform vec3 uViewPos;
varying vec3 vLocal; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 p = normalize(vLocal);
  vec3 sp = p*2.2 + uSeed;
  float elev = fbm(sp) + fbm(sp*4.0)*0.25;
  float sea = 0.04;
  vec3 N = normalize(vWN);
  vec3 sun = normalize(-vWP);
  float ndl = dot(N, sun);
  float lat = abs(p.y);
  // land color ramp by height above sea
  float h = clamp((elev - sea)/0.6, 0.0, 1.0);
  vec3 beach = vec3(0.78,0.71,0.50);
  vec3 veg   = uColor;
  vec3 rock  = mix(uColor*0.45, vec3(0.42,0.36,0.32), 0.6);
  vec3 snow  = vec3(0.92,0.95,1.0);
  vec3 land = mix(beach, veg, smoothstep(0.0,0.14,h));
  land = mix(land, rock, smoothstep(0.34,0.7,h));
  land = mix(land, snow, smoothstep(0.82,1.0,h));
  float ice = smoothstep(0.6, 0.8, lat - max(elev,0.0)*0.15);
  land = mix(land, snow, ice);
  // water
  float depth = clamp((sea - elev)/0.45, 0.0, 1.0);
  vec3 water = mix(vec3(0.05,0.32,0.5), vec3(0.015,0.06,0.2), depth);
  float isLand = step(sea, elev);
  vec3 albedo = mix(water, land, isLand);
  // specular glint on oceans
  vec3 V = normalize(uViewPos - vWP);
  vec3 H = normalize(sun + V);
  float spec = (1.0-isLand) * pow(max(dot(N,H),0.0), 80.0) * 0.9;
  // day lighting with soft terminator + ambient
  float day = smoothstep(-0.12, 0.22, ndl);
  vec3 col = albedo * (0.22 + 1.2*max(ndl,0.0)) + spec*vec3(1.0);
  // night-side city lights on land
  float night = 1.0 - smoothstep(-0.04, 0.1, ndl);
  float cities = isLand * smoothstep(0.55,0.6, fbm(sp*7.0)) * night;
  col += cities * vec3(1.0,0.82,0.45) * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const GAS_FRAG = NOISE + `
uniform vec3 uColor; uniform float uSeed; uniform float uTime; uniform vec3 uViewPos;
varying vec3 vLocal; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 p = normalize(vLocal);
  float warp = fbm(p*2.2 + uSeed + vec3(uTime*0.01,0.0,0.0))*0.35;
  float bands = sin((p.y + warp)*13.0)*0.5 + 0.5;
  vec3 c1 = uColor*0.62, c2 = uColor*1.25, c3 = mix(uColor, vec3(0.95,0.9,0.78), 0.5);
  vec3 col = mix(c1, c2, bands);
  col = mix(col, c3, smoothstep(0.55,1.0, abs(fbm(p*5.0+uSeed))));
  // great storm
  float spot = smoothstep(0.16,0.0, length(p - normalize(vec3(0.55,-0.25,0.7))));
  col = mix(col, vec3(0.85,0.42,0.32), spot*0.85);
  vec3 N = normalize(vWN); vec3 sun = normalize(-vWP);
  col *= (0.2 + 1.15*max(dot(N,sun),0.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_FRAG = NOISE + `
uniform float uTime; uniform float uSeed;
varying vec3 vLocal; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 p = normalize(vLocal);
  float c = fbm(p*3.0 + vec3(uTime*0.015,0.0,uSeed)) + fbm(p*7.0)*0.3;
  float a = smoothstep(0.15, 0.55, c);
  vec3 N = normalize(vWN); vec3 sun = normalize(-vWP);
  float day = max(dot(N,sun),0.0);
  gl_FragColor = vec4(vec3(1.0)*(0.08 + day), a*0.65);
}`;

const ATMO_FRAG = `
uniform vec3 uAtmo; uniform vec3 uViewPos;
varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 N = normalize(vWN); vec3 V = normalize(uViewPos - vWP);
  float rim = pow(1.0 - max(dot(N,V),0.0), 2.6);
  vec3 sun = normalize(-vWP);
  float day = clamp(dot(N,sun)+0.35, 0.0, 1.0);
  gl_FragColor = vec4(uAtmo * rim * day * 1.5, rim*day);
}`;

const SPHERE = new THREE.SphereGeometry(1, 56, 40);

// Deep-space skybox: a VOLUMETRIC nebula raymarched through a 3D-simplex density field,
// then baked ONCE into a cubemap (static, free per-frame). Colors come from a cosine
// palette + a tilted "galactic" band for that painterly nebula look.
const NEBULA_RAYMARCH = NOISE + `
varying vec3 vDir;
// cosine palette spanning blue → teal → magenta → gold for varied nebula hues
vec3 pal(float t){
  return vec3(0.5) + vec3(0.5)*cos(6.28318*(vec3(1.0,0.95,0.85)*t + vec3(0.0,0.22,0.55)));
}
float dens(vec3 p){
  vec3 q = p + 0.7*vec3(fbm(p*0.4+7.0), fbm(p*0.4+13.0), fbm(p*0.4+23.0));   // domain warp
  return smoothstep(0.45, 1.0, fbm(q*0.85));
}
void main(){
  vec3 rd = normalize(vDir);
  // galactic band: denser near a tilted plane across the sky
  float band = 1.0 - smoothstep(0.0, 0.6, abs(dot(rd, normalize(vec3(0.22,1.0,0.32)))));
  float region = fbm(rd*0.7 + 40.0)*0.5 + 0.5;   // large-scale colored zones
  vec3 acc = vec3(0.0); float t = 1.0;
  for (int i = 0; i < 16; i++) {
    vec3 p = rd * t;
    float d = dens(p) * (0.4 + 1.0*band);
    float h = region*0.7 + fbm(p*0.45 + 3.0)*0.3;
    acc += pal(h) * d;
    t += 0.85;
  }
  acc *= (3.0 / 16.0);
  acc = pow(acc, vec3(1.18));                       // deepen the voids for contrast
  vec3 col = vec3(0.008,0.011,0.026) + acc;
  col += pal(region + 0.35) * pow(max(max(acc.r,acc.g),acc.b), 3.0) * 0.6;   // bright tinted knots
  gl_FragColor = vec4(col, 1.0);
}`;

// Render the raymarch onto a sphere from a CubeCamera once → a static cubemap for the bg.
export function makeNebula(renderer: THREE.WebGLRenderer): THREE.Texture {
  const mat = new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: NEBULA_RAYMARCH, side: THREE.BackSide, depthWrite: false,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 16), mat);
  const tmp = new THREE.Scene(); tmp.add(sphere);
  const rt = new THREE.WebGLCubeRenderTarget(512, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(1, 1000, rt);
  const prevTone = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;   // bake raw colors
  cam.update(renderer, tmp);
  renderer.toneMapping = prevTone;
  sphere.geometry.dispose(); mat.dispose();
  return rt.texture;
}

export interface PlanetOpts { radius: number; color: number; gas: boolean; seed: number; }

export interface Planet { group: THREE.Group; update(dt: number, camPos: THREE.Vector3): void; }

export function makePlanet(o: PlanetOpts): Planet {
  const group = new THREE.Group();
  const col = new THREE.Color(o.color);
  const seed = o.seed;

  const surfMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: o.gas ? GAS_FRAG : ROCKY_FRAG,
    uniforms: {
      uColor: { value: col }, uSeed: { value: seed }, uTime: { value: 0 },
      uViewPos: { value: new THREE.Vector3() },
    },
  });
  const surface = new THREE.Mesh(SPHERE, surfMat);
  surface.scale.setScalar(o.radius);

  // axial tilt + spin node
  const spin = new THREE.Group();
  spin.rotation.z = (seed % 1) * 0.5 - 0.25;
  spin.add(surface);
  group.add(spin);

  const mats: THREE.ShaderMaterial[] = [surfMat];

  if (!o.gas) {
    const cloudMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: CLOUD_FRAG,
      uniforms: { uTime: { value: 0 }, uSeed: { value: seed + 11.0 } },
      transparent: true, depthWrite: false,
    });
    const clouds = new THREE.Mesh(SPHERE, cloudMat);
    clouds.scale.setScalar(o.radius * 1.02);
    spin.add(clouds);
    mats.push(cloudMat);
  }

  // atmosphere halo (back side, additive)
  const atmoColor = o.gas ? col.clone().lerp(new THREE.Color(0xffffff), 0.2)
    : new THREE.Color(0x6fb4ff);
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: ATMO_FRAG,
    uniforms: { uAtmo: { value: atmoColor }, uViewPos: { value: new THREE.Vector3() } },
    transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const atmo = new THREE.Mesh(SPHERE, atmoMat);
  atmo.scale.setScalar(o.radius * 1.14);
  group.add(atmo);

  const spinRate = 0.05 + (seed % 1) * 0.12;
  let t = 0;
  return {
    group,
    update(dt, camPos) {
      t += dt; spin.rotation.y += spinRate * dt;
      for (const m of mats) if (m.uniforms.uTime) m.uniforms.uTime.value = t;
      surfMat.uniforms.uViewPos.value.copy(camPos);
      atmoMat.uniforms.uViewPos.value.copy(camPos);
    },
  };
}

// The central star: a turbulent photosphere (granulation, sunspots, limb darkening),
// flickering corona shells, and a soft camera-facing bloom halo.
const SUN_PHOTO_FRAG = NOISE + `
uniform float uTime; uniform vec3 uViewPos; uniform vec3 uTint;
varying vec3 vLocal; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 p = normalize(vLocal);
  float g1 = fbm(p*3.0 + vec3(0.0, uTime*0.04, 0.0));
  float g2 = fbm(p*9.0 - vec3(uTime*0.07, 0.0, uTime*0.05));
  float g = g1*0.6 + g2*0.4;
  vec3 c = mix(vec3(1.0,0.36,0.05), vec3(1.0,0.72,0.24), smoothstep(-0.25,0.3,g));
  c = mix(c, vec3(1.0,0.95,0.82), smoothstep(0.28,0.62,g));     // bright plages
  float spot = smoothstep(0.5,0.72, fbm(p*4.0 + 19.0));
  c = mix(c, vec3(0.55,0.16,0.04), spot*0.55);                  // sunspots
  c *= uTint;                                                    // spectral class tint
  vec3 N = normalize(vWN); vec3 V = normalize(uViewPos - vWP);
  float limb = pow(max(dot(N,V),0.0), 0.5);                     // limb darkening
  c *= (0.55 + 0.45*limb);
  gl_FragColor = vec4(c * 1.7, 1.0);                            // HDR-ish → ACES rolls the core to white-hot
}`;
const SUN_CORONA_FRAG = NOISE + `
uniform float uTime; uniform vec3 uViewPos; uniform vec3 uColor; uniform float uPow; uniform float uGain;
varying vec3 vLocal; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 N = normalize(vWN); vec3 V = normalize(uViewPos - vWP);
  float rim = pow(1.0 - max(dot(N,V),0.0), uPow);
  vec3 p = normalize(vLocal);
  float flick = 0.65 + 0.45*fbm(p*4.0 + vec3(uTime*0.25, uTime*0.15, 0.0));
  gl_FragColor = vec4(uColor * rim * flick * uGain, rim);
}`;

export interface Star { group: THREE.Group; update(dt: number, camPos: THREE.Vector3): void; }

export function makeStar(radius: number, tint = 0xffffff): Star {
  // tint shifts the whole star toward its spectral class (red dwarf / blue giant);
  // the surface palette stays "sun-like" underneath so granulation still reads.
  const tc = new THREE.Color(tint);
  const soft = new THREE.Color(1, 1, 1).lerp(tc, 0.75);   // don't fully crush the palette
  const g = new THREE.Group();
  const photoMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: SUN_PHOTO_FRAG,
    uniforms: { uTime: { value: 0 }, uViewPos: { value: new THREE.Vector3() }, uTint: { value: new THREE.Vector3(soft.r, soft.g, soft.b) } },
  });
  g.add(new THREE.Mesh(SPHERE, photoMat)).scale.setScalar(radius);

  const coronas: THREE.ShaderMaterial[] = [];
  const shell = (scale: number, pow: number, gain: number, color: number) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: SUN_CORONA_FRAG,
      uniforms: { uTime: { value: 0 }, uViewPos: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(color) }, uPow: { value: pow }, uGain: { value: gain } },
      transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    g.add(new THREE.Mesh(SPHERE, m)).scale.setScalar(radius * scale); coronas.push(m);
  };
  shell(1.3, 2.4, 1.0, new THREE.Color(0xffd89a).lerp(tc, 0.6).getHex());    // tight chromosphere
  shell(1.85, 2.8, 0.6, new THREE.Color(0xff9a4a).lerp(tc, 0.6).getHex());   // outer corona glow

  let t = 0;
  return {
    group: g,
    update(dt, camPos) {
      t += dt;
      photoMat.uniforms.uTime.value = t; photoMat.uniforms.uViewPos.value.copy(camPos);
      for (const m of coronas) { m.uniforms.uTime.value = t; m.uniforms.uViewPos.value.copy(camPos); }
    },
  };
}
