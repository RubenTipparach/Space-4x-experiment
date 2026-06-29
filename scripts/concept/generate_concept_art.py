#!/usr/bin/env python3
"""Generate top-down SVG concept ships, one signature hull per Thallian Nebula faction.

Each ship is authored nose-up in a 240x260 viewBox. Colors are concrete here for the
concept pass; production art will swap these for faction CSS color tokens
(--hull/--trim/--glow/--accent) per docs/FACTIONS_AND_ART.md.

Run: python3 scripts/concept/generate_concept_art.py
Outputs: assets/concept-art/<faction>.svg
"""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "concept-art")
os.makedirs(OUT, exist_ok=True)
W, H, CX = 240, 260, 120


def defs(fid, hull, hull2, trim, glow):
    return f"""
  <defs>
    <linearGradient id="hull{fid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{hull2}"/>
      <stop offset="0.55" stop-color="{hull}"/>
      <stop offset="1" stop-color="{hull2}"/>
    </linearGradient>
    <radialGradient id="glow{fid}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="{glow}" stop-opacity="1"/>
      <stop offset="0.6" stop-color="{glow}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="{glow}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft{fid}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3.2"/>
    </filter>
  </defs>"""


def wrap(fid, hull, hull2, trim, glow, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
            f'width="{W}" height="{H}">{defs(fid, hull, hull2, trim, glow)}\n'
            f'  <g stroke-linejoin="round" stroke-linecap="round">{body}\n  </g>\n</svg>\n')


def engine(fid, x, y, r, glow):
    return (f'<circle cx="{x}" cy="{y}" r="{r*2.1:.0f}" fill="url(#glow{fid})"/>'
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="{glow}" filter="url(#soft{fid})"/>')


# ---- 1. Consortium Galactica — Universal Order: clean saucer cruiser ----
def consortium():
    fid, hull, hull2, trim, glow = "C", "#e8edf2", "#b9c4d0", "#d9a93a", "#5ec8ff"
    b = f"""
    <!-- nacelles -->
    <g fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5">
      <rect x="40" y="150" width="22" height="86" rx="11"/>
      <rect x="178" y="150" width="22" height="86" rx="11"/>
    </g>
    {engine(fid,51,236,8,glow)}{engine(fid,189,236,8,glow)}
    <rect x="44" y="150" width="14" height="10" rx="5" fill="{glow}"/>
    <rect x="182" y="150" width="14" height="10" rx="5" fill="{glow}"/>
    <!-- pylons -->
    <path d="M95 178 L51 168 M145 178 L189 168" stroke="{hull2}" stroke-width="9"/>
    <!-- engineering hull -->
    <rect x="100" y="140" width="40" height="92" rx="18" fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5"/>
    <!-- saucer -->
    <ellipse cx="{CX}" cy="92" rx="74" ry="58" fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <ellipse cx="{CX}" cy="92" rx="46" ry="34" fill="none" stroke="{trim}" stroke-width="1.5" opacity="0.8"/>
    <circle cx="{CX}" cy="150" r="8" fill="{glow}"/>  <!-- deflector dish -->
    <circle cx="{CX}" cy="92" r="9" fill="{trim}"/>   <!-- bridge -->
    """
    return wrap(fid, hull, hull2, trim, glow, b)


# ---- 2. Kareth Nara — Natural Sovereignty: organic bioluminescent manta ----
def kareth():
    fid, hull, hull2, trim, glow = "K", "#1f5a3a", "#0e3322", "#39b58a", "#7dffc4"
    b = f"""
    {engine(fid,120,238,11,glow)}
    <!-- swept manta wings (symmetric) -->
    <path d="M120 60 C70 70 26 120 30 200 C70 176 96 150 120 150 Z"
          fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <path d="M120 60 C170 70 214 120 210 200 C170 176 144 150 120 150 Z"
          fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <!-- central body -->
    <path d="M120 28 C104 64 102 150 120 196 C138 150 136 64 120 28 Z"
          fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <!-- bioluminescent veins -->
    <g stroke="{glow}" stroke-width="2" fill="none" filter="url(#soft{fid})" opacity="0.95">
      <path d="M120 50 C112 90 112 150 120 188"/>
      <path d="M118 90 C90 110 70 150 56 184"/>
      <path d="M122 90 C150 110 170 150 184 184"/>
    </g>
    <!-- crystal shards -->
    <g fill="{glow}" opacity="0.9">
      <path d="M120 40 l7 14 l-7 12 l-7 -12 Z"/>
      <path d="M86 150 l5 9 l-5 8 l-5 -8 Z"/>
      <path d="M154 150 l5 9 l-5 8 l-5 -8 Z"/>
    </g>
    """
    return wrap(fid, hull, hull2, trim, glow, b)


# ---- 3. Terra Nexum — Human Ascendancy: rugged salvaged frontier gunship ----
def terra():
    fid, hull, hull2, trim, glow = "T", "#9c5a2c", "#5e3417", "#caa45a", "#ff8a3c"
    b = f"""
    {engine(fid,96,240,9,glow)}{engine(fid,150,240,9,glow)}
    <!-- twin engine blocks -->
    <rect x="84" y="196" width="26" height="40" rx="3" fill="{hull2}" stroke="{trim}" stroke-width="1.5"/>
    <rect x="136" y="196" width="26" height="40" rx="3" fill="{hull2}" stroke="{trim}" stroke-width="1.5"/>
    <!-- main blocky hull, chamfered nose -->
    <path d="M120 30 L150 64 L156 200 L84 200 L90 64 Z"
          fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <!-- asymmetric salvage pod (left) + strut -->
    <rect x="40" y="120" width="34" height="56" rx="3" fill="{hull2}" stroke="{trim}" stroke-width="1.5"/>
    <path d="M74 138 L90 130 M74 162 L90 156" stroke="{trim}" stroke-width="4"/>
    <!-- antenna mast (right) -->
    <path d="M150 96 L186 80" stroke="{trim}" stroke-width="3"/>
    <circle cx="186" cy="80" r="4" fill="{glow}"/>
    <!-- cockpit + rivets / weathered panels -->
    <path d="M120 50 L132 70 L108 70 Z" fill="{glow}" opacity="0.85"/>
    <g fill="{trim}">
      <rect x="100" y="92" width="40" height="3"/><rect x="100" y="120" width="40" height="3"/>
      <rect x="100" y="150" width="40" height="3"/>
      <circle cx="98" cy="86" r="2"/><circle cx="142" cy="86" r="2"/>
      <circle cx="98" cy="180" r="2"/><circle cx="142" cy="180" r="2"/>
    </g>
    <!-- gun barrels -->
    <rect x="92" y="40" width="5" height="26" fill="{trim}"/>
    <rect x="143" y="40" width="5" height="26" fill="{trim}"/>
    """
    return wrap(fid, hull, hull2, trim, glow, b)


# ---- 4. Illumaria — Guided Enlightenment: sleek dark stealth arrowhead ----
def illumaria():
    fid, hull, hull2, trim, glow = "I", "#2a2440", "#15111f", "#7a5cff", "#d24bff"
    b = f"""
    {engine(fid,120,236,10,glow)}
    <!-- swept wings -->
    <path d="M120 110 L26 210 L60 212 L120 168 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5"/>
    <path d="M120 110 L214 210 L180 212 L120 168 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5"/>
    <!-- arrowhead fuselage -->
    <path d="M120 24 L160 150 L120 214 L80 150 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <!-- glowing spine -->
    <path d="M120 40 L120 206" stroke="{glow}" stroke-width="3" filter="url(#soft{fid})" opacity="0.9"/>
    <path d="M120 70 L96 150 M120 70 L144 150" stroke="{trim}" stroke-width="1.5" opacity="0.8"/>
    <path d="M120 36 L150 150 L120 200 L90 150 Z" fill="none" stroke="{glow}" stroke-width="1" opacity="0.5"/>
    """
    return wrap(fid, hull, hull2, trim, glow, b)


# ---- 5. Astryn'Vel — Freedom Through Defiance: scrappy asymmetric strike fighter ----
def astryn():
    fid, hull, hull2, trim, glow = "A", "#5c6645", "#33371f", "#d7822e", "#9be84a"
    b = f"""
    {engine(fid,104,236,8,glow)}{engine(fid,148,236,8,glow)}
    <!-- swept wings (slightly asymmetric) -->
    <path d="M118 120 L34 150 L40 176 L118 162 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5"/>
    <path d="M122 116 L210 154 L202 182 L122 160 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5"/>
    <!-- fuselage -->
    <path d="M120 28 L138 96 L150 226 L90 226 L102 96 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <!-- rebel accent stripe + patch panel -->
    <path d="M120 40 L130 96 L110 96 Z" fill="{glow}" opacity="0.85"/>
    <rect x="104" y="150" width="32" height="5" fill="{trim}"/>
    <rect x="106" y="120" width="16" height="22" fill="{hull2}" stroke="{trim}" stroke-width="1"/>
    <!-- wingtip cannons -->
    <rect x="36" y="140" width="4" height="20" fill="{trim}"/>
    <rect x="204" y="146" width="4" height="20" fill="{trim}"/>
    """
    return wrap(fid, hull, hull2, trim, glow, b)


# ---- 6. Ezrathi — Void Reverence: monolithic ritual ship ----
def ezrathi():
    fid, hull, hull2, trim, glow = "E", "#1a1622", "#0a0810", "#6b3fa0", "#8cff6b"
    b = f"""
    {engine(fid,120,232,10,'#a070ff')}
    <!-- floating monolith shards -->
    <g fill="{hull2}" stroke="{trim}" stroke-width="1">
      <path d="M40 96 L58 86 L62 150 L46 158 Z"/>
      <path d="M200 96 L182 86 L178 150 L194 158 Z"/>
    </g>
    <!-- sharp asymmetric blades -->
    <path d="M120 150 L52 196 L88 168 L120 176 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5"/>
    <path d="M120 150 L196 188 L150 166 L120 176 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5"/>
    <!-- central obsidian hull -->
    <path d="M120 22 L146 92 L132 210 L108 210 L94 92 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <!-- void rune core -->
    <circle cx="120" cy="120" r="20" fill="url(#glow{fid})"/>
    <path d="M120 104 L120 136 M106 112 L134 128 M134 112 L106 128" stroke="{glow}" stroke-width="2.5" filter="url(#soft{fid})"/>
    <path d="M120 40 L120 92" stroke="{glow}" stroke-width="2" opacity="0.7"/>
    """
    return wrap(fid, hull, hull2, trim, glow, b)


# ---- 7. Kri'thul — Inevitable Corruption: infected biomechanical hull ----
def krithul():
    fid, hull, hull2, trim, glow = "P", "#6f7a2e", "#3b3f17", "#9fae3e", "#c6ff3a"
    b = f"""
    {engine(fid,120,236,12,glow)}
    <!-- trailing tendrils -->
    <g stroke="{trim}" stroke-width="4" fill="none" opacity="0.9">
      <path d="M104 208 C92 224 96 240 84 252"/>
      <path d="M136 208 C150 222 146 240 158 252"/>
      <path d="M120 212 C120 230 116 244 122 256"/>
    </g>
    <!-- bulbous asymmetric infected body -->
    <path d="M120 26 C92 40 78 90 88 140 C70 150 66 188 104 210
             C132 220 150 200 150 200 C176 180 168 150 152 140
             C166 92 150 44 120 26 Z"
          fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <!-- pustules / toxic cores -->
    <g>
      <circle cx="110" cy="96" r="13" fill="url(#glow{fid})"/>
      <circle cx="110" cy="96" r="6" fill="{glow}"/>
      <circle cx="138" cy="150" r="16" fill="url(#glow{fid})"/>
      <circle cx="138" cy="150" r="7" fill="{glow}"/>
      <circle cx="98" cy="160" r="9" fill="url(#glow{fid})"/>
      <circle cx="98" cy="160" r="4" fill="{glow}"/>
    </g>
    <!-- veiny growth lines -->
    <g stroke="{trim}" stroke-width="1.5" fill="none" opacity="0.8">
      <path d="M120 40 C108 80 108 140 116 196"/>
      <path d="M120 60 C140 90 138 150 132 190"/>
    </g>
    """
    return wrap(fid, hull, hull2, trim, glow, b)


# ---- 8. Shadur'kai — Shadowed Autonomy: clean knife-edge stealth ----
def shadur():
    fid, hull, hull2, trim, glow = "S", "#16202e", "#0a0f16", "#3aa0b5", "#37e6ff"
    b = f"""
    {engine(fid,120,236,9,glow)}
    <!-- swept tail fins -->
    <path d="M120 150 L70 224 L106 196 L120 196 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5"/>
    <path d="M120 150 L170 224 L134 196 L120 196 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="1.5"/>
    <!-- long knife fuselage -->
    <path d="M120 20 L138 120 L128 222 L112 222 L102 120 Z" fill="url(#hull{fid})" stroke="{trim}" stroke-width="2"/>
    <!-- cold cyan edge lines -->
    <g stroke="{glow}" stroke-width="1.6" filter="url(#soft{fid})" opacity="0.95" fill="none">
      <path d="M120 28 L134 120 L126 210"/>
      <path d="M120 28 L106 120 L114 210"/>
    </g>
    <path d="M120 60 L120 150" stroke="{trim}" stroke-width="1.2" opacity="0.7"/>
    <circle cx="120" cy="92" r="5" fill="{glow}"/>
    """
    return wrap(fid, hull, hull2, trim, glow, b)


SHIPS = {
    "consortium-galactica": consortium,
    "kareth-nara": kareth,
    "terra-nexum": terra,
    "illumaria": illumaria,
    "astryn-vel": astryn,
    "ezrathi": ezrathi,
    "krithul": krithul,
    "shadur-kai": shadur,
}

for name, fn in SHIPS.items():
    path = os.path.join(OUT, f"{name}.svg")
    with open(path, "w") as f:
        f.write(fn())
    print("wrote", os.path.relpath(path))
print("done:", len(SHIPS), "ships")
