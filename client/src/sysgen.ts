// Procedural star systems: every star on the galaxy map expands into a full,
// deterministic solar system — star size/tint from its spectral class, N planets
// (types, orbits, moons, rings, resource tags), an optional asteroid belt with
// glowing mineral fields, and gas-giant mining nodes. Same seed → same system,
// so systems are stable across sessions with no persistence layer.
import type { PlanetDef, MoonDef, ResourceTag } from './data.ts';

export interface GalaxySystem { id: number; name: string; x: number; y: number; star: { class: string; color: number }; planets: number; }

export interface SystemSpec {
  id: number; name: string;
  star: { radius: number; tint: number; cls: string };
  planets: PlanetDef[];
  belt: { radius: number; fields: { frac: number; res: 'ore' | 'crystal' }[] } | null;
}

// deterministic RNG (mulberry32) seeded from the system id
function rng32(seed: number) {
  let a = (seed ^ 0x9e3779b9) | 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
// star radius per spectral class (hot giants big, dwarfs small, N = exotic remnant)
const STAR_RADIUS: Record<string, number> = { O: 46, B: 42, A: 36, F: 32, G: 29, K: 25, M: 21, N: 13 };

const ROCKY_COLORS = [0xb5642f, 0x6fae72, 0x4790a0, 0xc2c8d2, 0x9d7fc0, 0xc89a5a, 0x8a9aa5, 0x3f7fb0, 0xd6a98a, 0x9c7b50];
const GAS_COLORS = [0xc8a26a, 0xb08fd0, 0x9ac0d8, 0x86b89a, 0xd8a880];
const ROCKY_TAGS: ResourceTag[] = ['minerals', 'ore', 'crystal', 'plants', 'animals', 'underwater', 'tourism'];
const MOON_RES: ResourceTag[] = ['ore', 'crystal', 'minerals', 'plants', 'underwater', 'animals'];

export function genSystem(g: GalaxySystem): SystemSpec {
  const rnd = rng32(Math.imul(g.id + 1, 2654435761));
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

  const planets: PlanetDef[] = [];
  const count = Math.max(1, Math.min(g.planets, 14));
  let orbit = 120 + rnd() * 70;
  for (let i = 0; i < count; i++) {
    orbit += 85 + rnd() * 90 + i * 9;          // spacing widens outward
    const t = i / Math.max(count - 1, 1);
    const gas = orbit > 380 && rnd() < 0.28 + t * 0.45;   // gas giants live out past the frost line
    const size = gas ? 32 + rnd() * 20 : 12 + rnd() * 13;
    const name = `${g.name} ${ROMAN[i] ?? i + 1}`;
    const tags: ResourceTag[] = gas ? ['gas'] : [pick(ROCKY_TAGS)];
    if (!gas && rnd() < 0.5) { const t2 = pick(ROCKY_TAGS); if (!tags.includes(t2)) tags.push(t2); }
    const moons: MoonDef[] = [];
    const nMoons = gas ? Math.floor(rnd() * 3) : (size > 16 && rnd() < 0.45 ? 1 : 0);
    let md = size + 26 + rnd() * 14;
    for (let m = 0; m < nMoons; m++) {
      moons.push({ name: `${name}${'abc'[m]}`, dist: md, size: 5 + rnd() * 3.5,
                   speed: 0.45 + rnd() * 0.5, angle0: rnd() * Math.PI * 2, resource: pick(MOON_RES) });
      md += 24 + rnd() * 14;
    }
    planets.push({
      name, orbit: Math.round(orbit), angle0: rnd() * Math.PI * 2,
      speed: 0.02 * Math.sqrt(150 / orbit),     // Kepler-ish falloff
      size: Math.round(size), type: gas ? 'gas' : 'rocky',
      color: gas ? pick(GAS_COLORS) : pick(ROCKY_COLORS),
      tags, primary: tags[0], moons: moons.length ? moons : undefined,
    });
  }

  // asteroid belt: usually present, parked in the widest orbital gap (or past the rim)
  let belt: SystemSpec['belt'] = null;
  if (rnd() < 0.72 && planets.length >= 2) {
    let bi = 0, bg = 0;
    for (let i = 0; i + 1 < planets.length; i++) {
      const gap = planets[i + 1].orbit - planets[i].orbit;
      if (gap > bg) { bg = gap; bi = i; }
    }
    const radius = bg > 150 ? Math.round(planets[bi].orbit + bg / 2)
                            : Math.round(planets[planets.length - 1].orbit + 120 + rnd() * 80);
    const fields: { frac: number; res: 'ore' | 'crystal' }[] = [{ frac: rnd(), res: rnd() < 0.5 ? 'ore' : 'crystal' }];
    if (rnd() < 0.55) fields.push({ frac: (fields[0].frac + 0.3 + rnd() * 0.4) % 1, res: rnd() < 0.5 ? 'ore' : 'crystal' });
    belt = { radius, fields };
  }

  return {
    id: g.id, name: g.name,
    star: { radius: STAR_RADIUS[g.star.class] ?? 28, tint: g.star.color, cls: g.star.class },
    planets, belt,
  };
}
