// Static design data for the vertical slice: factions/fleet, and the solar system
// (15 planets, moons, gas giants with atmosphere mining nodes, resource tags).

export type ResourceTag =
  | 'animals' | 'plants' | 'underwater' | 'minerals' | 'tourism'
  | 'ore' | 'crystal' | 'gas';

export const RESOURCE_LABEL: Record<ResourceTag, string> = {
  animals: 'animals', plants: 'plant biomes', underwater: 'underwater biomes',
  minerals: 'rare minerals', tourism: 'tourist attractions',
  ore: 'ore', crystal: 'crystal', gas: 'gas',
};

export type ShipClass = 'scout' | 'cruiser' | 'harvester' | 'freighter';

// Per-class stat profile (multipliers on the base flight/cargo constants) + the
// in-world model size. Scouts are quick and nimble but carry little; harvesters
// lumber, haul and strip nodes faster; cruisers are the balanced flagships.
export const CLASS_STATS: Record<ShipClass, {
  label: string; speed: number; accel: number; turn: number; cargo: number; mine: number; size: number;
}> = {
  scout: { label: 'Scout', speed: 1.4, accel: 1.45, turn: 1.6, cargo: 0.45, mine: 0.7, size: 16 },
  cruiser: { label: 'Cruiser', speed: 1.0, accel: 1.0, turn: 1.0, cargo: 1.0, mine: 1.0, size: 24 },
  harvester: { label: 'Harvester', speed: 0.68, accel: 0.8, turn: 0.7, cargo: 2.4, mine: 1.9, size: 27 },
  freighter: { label: 'Freighter', speed: 0.58, accel: 0.65, turn: 0.55, cargo: 4.0, mine: 0.5, size: 30 },
};

export interface FactionDef { id: string; name: string; color: number; cls: ShipClass; model: string; }

// 8 factions = the player's starting fleet for the slice — a MIXED-CLASS fleet so the
// class system shows: 3 scouts, 2 cruisers, 2 harvesters, 1 freighter. `model` is the
// GLB id (`<id>` = cruiser; variants `<id>-scout` / `<id>-harvester` / `<id>-freighter`).
export const FACTIONS: FactionDef[] = [
  { id: 'consortium-galactica', name: 'Meridian', color: 0xe8edf2, cls: 'cruiser', model: 'consortium-galactica' },
  { id: 'kareth-nara', name: 'Spirewing', color: 0x7dffc4, cls: 'scout', model: 'kareth-nara-scout' },
  { id: 'terra-nexum', name: 'Ironside', color: 0xff8a3c, cls: 'harvester', model: 'terra-nexum-harvester' },
  { id: 'illumaria', name: 'Cipher', color: 0xd24bff, cls: 'scout', model: 'illumaria-scout' },
  { id: 'astryn-vel', name: 'Freehold', color: 0x9be84a, cls: 'freighter', model: 'astryn-vel-freighter' },
  { id: 'ezrathi', name: 'Threnody', color: 0x8cff6b, cls: 'cruiser', model: 'ezrathi' },
  { id: 'krithul', name: 'Rotmaw', color: 0xc6ff3a, cls: 'harvester', model: 'krithul-harvester' },
  { id: 'shadur-kai', name: 'Nightglass', color: 0x37e6ff, cls: 'scout', model: 'shadur-kai-scout' },
];

export interface MoonDef {
  name: string; dist: number; size: number; speed: number; angle0: number;
  resource: ResourceTag;
}
export interface PlanetDef {
  name: string; orbit: number; angle0: number; speed: number; size: number;
  type: 'rocky' | 'gas'; color: number; tags: ResourceTag[]; primary: ResourceTag;
  moons?: MoonDef[];
}

// gas giants get GAS_NODES atmosphere mining nodes (Lagrange points)
export const GAS_NODES = 5;

export const PLANETS: PlanetDef[] = [
  { name: 'Cinder', orbit: 150, angle0: 0.3, speed: 0.020, size: 16, type: 'rocky',
    color: 0xb5642f, tags: ['minerals', 'ore'], primary: 'minerals' },
  { name: 'Verdantia', orbit: 220, angle0: 1.7, speed: 0.016, size: 22, type: 'rocky',
    color: 0x4caf6a, tags: ['plants', 'animals'], primary: 'plants',
    moons: [{ name: 'Bramble', dist: 40, size: 6, speed: 0.9, angle0: 0, resource: 'animals' }] },
  { name: 'Tethys', orbit: 290, angle0: 3.6, speed: 0.013, size: 20, type: 'rocky',
    color: 0x3f7fb0, tags: ['underwater'], primary: 'underwater' },
  { name: 'Aurelia', orbit: 355, angle0: 5.1, speed: 0.011, size: 18, type: 'rocky',
    color: 0xd8b24a, tags: ['tourism'], primary: 'tourism' },
  { name: 'Bronce', orbit: 420, angle0: 2.4, speed: 0.0095, size: 19, type: 'rocky',
    color: 0x9c7b50, tags: ['ore', 'minerals'], primary: 'ore',
    moons: [{ name: 'Slag', dist: 38, size: 6, speed: 1.0, angle0: 1, resource: 'ore' }] },
  { name: 'Halcyon', orbit: 630, angle0: 0.9, speed: 0.0080, size: 40, type: 'gas',
    color: 0xc8a26a, tags: ['gas'], primary: 'gas',
    moons: [
      { name: 'Mote', dist: 64, size: 6, speed: 0.8, angle0: 0.2, resource: 'crystal' },
      { name: 'Drupe', dist: 88, size: 8, speed: 0.6, angle0: 3.0, resource: 'plants' },
    ] },
  { name: 'Numa', orbit: 700, angle0: 4.2, speed: 0.0068, size: 18, type: 'rocky',
    color: 0x7fb0c8, tags: ['crystal'], primary: 'crystal' },
  { name: 'Sylphid', orbit: 770, angle0: 1.1, speed: 0.0060, size: 21, type: 'rocky',
    color: 0x6fae72, tags: ['animals', 'plants'], primary: 'animals',
    moons: [{ name: 'Fen', dist: 40, size: 6, speed: 0.9, angle0: 2, resource: 'underwater' }] },
  { name: 'Maru', orbit: 845, angle0: 5.8, speed: 0.0053, size: 20, type: 'rocky',
    color: 0x4790a0, tags: ['underwater', 'animals'], primary: 'underwater' },
  { name: 'Castellan', orbit: 935, angle0: 2.9, speed: 0.0045, size: 46, type: 'gas',
    color: 0xb08fd0, tags: ['gas'], primary: 'gas',
    moons: [
      { name: 'Spire', dist: 70, size: 7, speed: 0.7, angle0: 0.5, resource: 'minerals' },
      { name: 'Vault', dist: 96, size: 8, speed: 0.55, angle0: 2.4, resource: 'crystal' },
      { name: 'Reef', dist: 120, size: 7, speed: 0.45, angle0: 4.6, resource: 'underwater' },
    ] },
  { name: 'Ophir', orbit: 1010, angle0: 0.2, speed: 0.0039, size: 17, type: 'rocky',
    color: 0xc89a5a, tags: ['minerals'], primary: 'minerals' },
  { name: 'Drift', orbit: 1085, angle0: 3.3, speed: 0.0034, size: 18, type: 'rocky',
    color: 0x8a8f99, tags: ['ore'], primary: 'ore' },
  { name: 'Wisp', orbit: 1165, angle0: 1.5, speed: 0.0029, size: 38, type: 'gas',
    color: 0x9ac0d8, tags: ['gas'], primary: 'gas',
    moons: [
      { name: 'Haze', dist: 60, size: 6, speed: 0.7, angle0: 1.0, resource: 'gas' },
      { name: 'Glint', dist: 84, size: 7, speed: 0.5, angle0: 3.8, resource: 'crystal' },
    ] },
  { name: 'Solace', orbit: 1240, angle0: 4.9, speed: 0.0025, size: 20, type: 'rocky',
    color: 0xd6a98a, tags: ['tourism', 'underwater'], primary: 'tourism' },
  { name: 'Erebus', orbit: 1310, angle0: 2.0, speed: 0.0021, size: 19, type: 'rocky',
    color: 0x9d7fc0, tags: ['crystal', 'minerals'], primary: 'crystal' },
];

// resource accent colors for UI/markers
export const RES_COLOR: Record<ResourceTag, number> = {
  animals: 0xff9bb0, plants: 0x7bd87b, underwater: 0x5ec8ff, minerals: 0xffd27a,
  tourism: 0xff7ae0, ore: 0xff8a3c, crystal: 0x9be8ff, gas: 0xc6a2ff,
};
