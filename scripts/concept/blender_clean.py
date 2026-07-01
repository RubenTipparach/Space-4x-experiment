#!/usr/bin/env python3
"""Clean, deliberately-modeled faction ships (no random greeble) in Blender/Cycles.

v3 "hero feature" pass: every faction is built around one unmistakable structural
idea (hammerhead prow, crescent wings, truss hauler, catamaran, twin-boom attacker,
cathedral halo rings, isopod carapace, folded raptor wings) with layered massing,
plate bands and repeated engineering detail — not one loft with sticks.

Run: python3 scripts/concept/blender_clean.py [faction_id ...]
Out: assets/sprites/clean/<faction>.png
"""
import bpy, math, os, sys, random
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.environ.get("OUTDIR", os.path.join(ROOT, "assets", "sprites", "clean"))
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def pmat(name, color, metal, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


def emat(name, color, strength, base=None):
    """Emissive material that ALSO carries a base color, so glow surfaces keep their
    tint when a viewer strips emission (the game zeroes emissive on ship load)."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*(base or color), 1)
    b.inputs["Roughness"].default_value = 0.35
    for key in ("Emission Color", "Emission"):   # Blender 4.x vs 3.x input name
        if key in b.inputs:
            b.inputs[key].default_value = (*color, 1); break
    if "Emission Strength" in b.inputs:
        b.inputs["Emission Strength"].default_value = strength
    return m


def finish(obj, mat, smooth=True, bevel=0.02):
    obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons: p.use_smooth = True
    if bevel:
        b = obj.modifiers.new("bev", "BEVEL"); b.width = bevel; b.segments = 3
        b.limit_method = "ANGLE"; b.angle_limit = math.radians(35)
    return obj


def sphere(loc, scale, mat, smooth=True, bevel=0.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, location=loc)
    o = bpy.context.active_object; o.scale = scale
    return finish(o, mat, smooth, bevel)


def cyl(r, depth, loc, rot, mat, smooth=True, bevel=0.015):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=r, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, smooth, bevel)


def box(scale, loc, rot, mat, smooth=False, bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.active_object; o.scale = scale
    return finish(o, mat, smooth, bevel)


def torus(major, minor, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc,
                                     rotation=rot, major_segments=64, minor_segments=16)
    return finish(bpy.context.active_object, mat, True, 0)


def disc(r, depth, loc, mat):  # faces +Y
    return cyl(r, depth, loc, (math.radians(90), 0, 0), mat)


def prism(sides, r, depth, loc, rot, mat, smooth=False, bevel=0.03):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, smooth, bevel)


def cone(r1, depth, loc, rot, mat, smooth=True, bevel=0.0, verts=32, r2=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, smooth, bevel)


def offside(obj, gap=0.06):
    """Enforce the asymmetry rule: a detail shape must lie entirely on one side of
    the centerline (x=0). If its bounding box straddles x=0, push it fully to the
    side its center is on. Use for ALL non-centered, non-mirrored detail."""
    bpy.context.view_layer.update()   # refresh matrix_world (object scale is set lazily)
    xs = [(obj.matrix_world @ Vector(c)).x for c in obj.bound_box]
    mn, mx = min(xs), max(xs)
    if mn < -gap and mx > gap:
        obj.location.x += (gap - mn) if (mn + mx) / 2 >= 0 else -(mx + gap)
    return obj


def pair(fn):
    """Build a mirrored pair for symmetric side-detail: fn(sx) for sx in (-1, +1)."""
    out = []
    for sx in (-1, 1):
        r = fn(sx)
        out += r if isinstance(r, list) else [r]
    return out


# ---------------- lofting (the workhorse of every hull / wing / fin) ----------------
def _cr(p0, p1, p2, p3, t):
    """Catmull-Rom interpolation over tuples (component-wise)."""
    return tuple(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t
                        + (-a + 3 * b - 3 * c + d) * t ** 3)
                 for a, b, c, d in zip(p0, p1, p2, p3))


def smooth_stations(ctrl, steps=4):
    """Resample a few hand-placed control stations into a dense smooth set, so lofted
    hulls get flowing curvature instead of visible facet kinks between stations."""
    out = []
    for i in range(len(ctrl) - 1):
        p0 = ctrl[max(i - 1, 0)]; p1 = ctrl[i]; p2 = ctrl[i + 1]; p3 = ctrl[min(i + 2, len(ctrl) - 1)]
        for s in range(steps):
            out.append(_cr(p0, p1, p2, p3, s / steps))
    out.append(tuple(ctrl[-1]))
    return out


def loft_axis(shape, stations, mat, axis="Y", bevel=0.04, smooth=False, name="loft"):
    """Loft a 2D cross-section along an axis.

    shape    : [(ua, ub), ...] unit cross-section.
    stations : [(t, sa, sb, oa, ob), ...] — position t along the axis; section scaled
               by (sa, sb) and offset by (oa, ob) in the two perpendicular directions.
    axis 'Y' : a=x, b=z  (hulls,   vert = (a, t, b))
    axis 'X' : a=y, b=z  (wings,   vert = (t, a, b))
    axis 'Z' : a=y, b=x  (fins,    vert = (b, a, t))"""
    import bmesh
    bm = bmesh.new()
    rings = []
    for (t, sa, sb, oa, ob) in stations:
        ring = []
        for (ua, ub) in shape:
            a = ua * sa + oa; b = ub * sb + ob
            v = (a, t, b) if axis == "Y" else ((t, a, b) if axis == "X" else (b, a, t))
            ring.append(bm.verts.new(v))
        rings.append(ring)
    n = len(shape)
    for r1, r2 in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r1[i], r1[j], r2[j], r2[i]))
    bm.faces.new(list(reversed(rings[0])))   # front cap
    bm.faces.new(list(rings[-1]))            # rear cap
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)   # outward normals regardless of order
    bm.normal_update()
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(obj)
    return finish(obj, mat, smooth, bevel)


def loft_hull(shape, stations, mat, bevel=0.04, smooth=False, name="hull"):
    """Main-body loft along Y (see loft_axis). stations: [(y, width, height, z_offset)].
    Symmetric by construction; give all three silhouettes a non-rectangular profile."""
    st = [(y, w, h, 0.0, dz) for (y, w, h, dz) in stations]
    return loft_axis(shape, st, mat, "Y", bevel, smooth, name)


def st_at(sts, y):
    """Interpolate a (y, w, h, dz) hull station list (y descending) at a given y."""
    if y >= sts[0][0]: return sts[0]
    for a, b in zip(sts, sts[1:]):
        if a[0] >= y >= b[0]:
            t = (a[0] - y) / max(a[0] - b[0], 1e-6)
            return tuple(pa + (pb - pa) * t for pa, pb in zip(a, b))
    return sts[-1]


def plate_band(shape, sts, y0, y1, grow, mat, bevel=0.05):
    """An armor/carapace band: re-loft the hull's own cross-section over [y0, y1]
    (y0 > y1) scaled up slightly, so it wraps the body as a raised plate. Layer a few
    with overlaps for segmented shells; use sparingly for panel breaks on hulls."""
    seg = [st_at(sts, y0)] + [s for s in sts if y0 > s[0] > y1] + [st_at(sts, y1)]
    st = [(y, w * grow + 0.012, h * grow + 0.012, dz) for (y, w, h, dz) in seg]
    return loft_hull(shape, st, mat, bevel=bevel)


# airfoil-ish hexagon: sharp leading/trailing edge, thickest ~1/3 back
XS_FOIL = [(0.5, 0.0), (0.12, 0.5), (-0.38, 0.3), (-0.5, 0.0), (-0.38, -0.3), (0.12, -0.5)]


def wing_pair(loc, span, root, tip, thick, sweep, dihedral, mat, bevel=0.04, curve=1.0, foil=XS_FOIL):
    """Mirrored REAL wings: tapered, swept, lofted along X from an airfoil section.
    loc = root center; span per side; root/tip = chord; sweep = tip set-back (negative
    = forward-swept); dihedral = tip rise (negative = folded/anhedral). curve > 1 bends
    the sweep into a crescent instead of a straight taper."""
    x0, y0, z0 = loc
    fs = (0.0, 0.3, 0.55, 0.78, 1.0)
    def one(sx):
        st = [(sx * (x0 + span * f), root + (tip - root) * f, max(thick * (1 - 0.5 * f), 0.02),
               y0 - sweep * (f ** curve), z0 + dihedral * (f ** 1.15)) for f in fs]
        return loft_axis(foil, st, mat, "X", bevel, False, "wing")
    return pair(one)


def fin(loc, height, root, tip, thick, sweep, mat, bevel=0.03):
    """A vertical stabilizer / spire lofted along Z (negative height = ventral)."""
    x0, y0, z0 = loc
    st = [(z0 + height * f, root + (tip - root) * f, max(thick * (1 - 0.45 * f), 0.02),
           y0 - sweep * f, x0) for f in (0.0, 0.5, 1.0)]
    return loft_axis(XS_FOIL, st, mat, "Z", bevel, False, "fin")


def nozzle(loc, r, mat, glow, length=0.5):
    """A proper engine bell: housing cylinder + flared truncated-cone bell + a glow
    disc recessed inside the bell mouth (faces aft, -Y)."""
    out = [cyl(r * 0.82, length * 0.55, (loc[0], loc[1] + length * 0.32, loc[2]),
               (math.radians(90), 0, 0), mat, smooth=True, bevel=0.02)]
    out.append(cone(r, length * 0.6, (loc[0], loc[1] - length * 0.05, loc[2]),
                    (math.radians(90), 0, 0), mat, smooth=True, bevel=0.012, r2=r * 0.6))
    out.append(disc(r * 0.66, 0.05, (loc[0], loc[1] - length * 0.22, loc[2]), glow))
    return out


def truss(y0, y1, hw, hh, mat, bays=4, t=0.028):
    """An exposed lattice spine: 4 longerons + X-braces per bay on top and bottom and
    mirrored side diagonals. Reads instantly as heavy engineering."""
    out = []
    mid, half = (y0 + y1) / 2, abs(y0 - y1) / 2
    for sx, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):   # longerons
        out.append(box((t, half, t), (sx * hw, mid, sz * hh), (0, 0, 0), mat, bevel=0.008))
    step = (y1 - y0) / bays
    dlen = math.hypot(step, 2 * hw) / 2
    ang = math.atan2(2 * hw, abs(step))
    for k in range(bays):
        yc = y0 + step * (k + 0.5)
        for rot in (ang, -ang):   # X-cross on top & bottom faces (symmetric)
            out.append(box((dlen, t, t), (0, yc, hh), (0, 0, rot), mat, bevel=0.008))
            out.append(box((dlen, t, t), (0, yc, -hh), (0, 0, rot), mat, bevel=0.008))
        slen = math.hypot(step, 2 * hh) / 2
        sang = math.atan2(2 * hh, abs(step)) * (1 if k % 2 == 0 else -1)
        out += pair(lambda sx, yc=yc, sang=sang: box((t, slen, t), (sx * hw, yc, 0),
                                                     (sang, 0, 0), mat, bevel=0.008))
    return out


def turret(loc, mat, gun, r=0.10, barrels=2, length=0.5):
    """A gun turret: ring base + housing + forward barrels (mirrored about the mount)."""
    out = [cyl(r, 0.07, loc, (0, 0, 0), mat, smooth=True, bevel=0.02),
           box((r * 0.8, r * 0.95, r * 0.55), (loc[0], loc[1], loc[2] + r * 0.6), (0, 0, 0), mat, bevel=0.025)]
    offs = [0.0] if barrels == 1 else [-r * 0.42, r * 0.42]
    for dx in offs:
        out.append(cyl(0.018, length, (loc[0] + dx, loc[1] + length / 2 + r * 0.7, loc[2] + r * 0.6),
                       (math.radians(90), 0, 0), gun, smooth=True, bevel=0))
    return out


def missile_rack(loc, rows, cols, mat, r=0.026):
    """An underwing rack of missile tubes (repetition = military engineering)."""
    out = [box((cols * r * 1.5, 0.20, rows * r * 1.5), loc, (0, 0, 0), mat, bevel=0.02)]
    for i in range(rows):
        for j in range(cols):
            dx = (j - (cols - 1) / 2) * r * 2.7; dz = (i - (rows - 1) / 2) * r * 2.7
            out.append(cyl(r, 0.38, (loc[0] + dx, loc[1] - 0.06, loc[2] + dz),
                           (math.radians(90), 0, 0), mat, smooth=True, bevel=0))
    return out


def window_strip(y0, y1, x, z, glow, n=8, size=0.028):
    """Mirrored rows of tiny emissive windows along the flanks (lights, not paint)."""
    out = []
    for i in range(n):
        y = y0 + (y1 - y0) * i / max(n - 1, 1)
        out += pair(lambda sx, y=y: box((0.012, size, size * 0.8), (sx * x, y, z), (0, 0, 0), glow, bevel=0))
    return out


def greeble_strip(rng, y0, y1, x, z, mat, n=5, s=0.09, mirror=False):
    """A row of small deterministic mechanical blocks along the hull. Mirrored when
    mirror=True; otherwise ONE-SIDED and pushed off the centerline via offside()."""
    out = []
    for i in range(n):
        y = y0 + (y1 - y0) * (i + 0.5) / n
        w = s * (0.7 + rng.random()); d = s * (0.9 + rng.random() * 1.5); h = s * (0.5 + rng.random())
        if mirror:
            out += pair(lambda sx, y=y, w=w, d=d, h=h: box((w, d, h), (sx * x, y, z), (0, 0, 0), mat, bevel=0.02))
        else:
            out.append(offside(box((w, d, h), (x, y, z), (0, 0, 0), mat, bevel=0.02)))
    return out


def antenna(loc, h, mat, r=0.014):
    return [cyl(r, h, (loc[0], loc[1], loc[2] + h / 2), (0, 0, 0), mat, smooth=True, bevel=0),
            box((r * 2.2, r * 2.2, r * 2.2), (loc[0], loc[1], loc[2] + h), (0, 0, 0), mat, bevel=0)]


# cross-section unit shapes (x = right, z = up); kept symmetric about x = 0
def xs_keel(top=1.0, bottom=-0.55, shoulder=0.25, w=1.0):
    return [(0, top), (w, shoulder), (0.62 * w, bottom), (-0.62 * w, bottom), (-w, shoulder)]

def xs_lens(w=1.0, h=0.6):
    return [(0, h), (w, 0.2 * h), (0.7 * w, -h), (-0.7 * w, -h), (-w, 0.2 * h)]

def xs_diamond():
    return [(0, 1.0), (1.0, 0.0), (0, -0.7), (-1.0, 0.0)]

def xs_slab(w=1.0, h=0.55):
    return [(-0.82 * w, h), (0.82 * w, h), (w, -0.15), (0.6 * w, -h), (-0.6 * w, -h), (-w, -0.15)]

def xs_round(w=1.0, h=1.0):
    return [(0, h), (0.7 * w, 0.7 * h), (w, 0), (0.7 * w, -0.7 * h),
            (0, -h), (-0.7 * w, -0.7 * h), (-w, 0), (-0.7 * w, 0.7 * h)]

def xs_tall(w=0.55, h=1.1):
    return [(0, h), (w, 0.2 * h), (0.5 * w, -h), (-0.5 * w, -h), (-w, 0.2 * h)]


# ---------------- builders (forward = +Y, up = +Z) ----------------
def consortium():
    """Meridian (Order) — HAMMERHEAD battlecruiser: bladed crossbar prow with sensor
    pods, a slim turreted waist spine, and a broad three-bell stern block. White/gold."""
    white = pmat("white", (0.82, 0.85, 0.90), 0.5, 0.38)
    panel = pmat("panel", (0.42, 0.47, 0.56), 0.6, 0.5)
    steel = pmat("steel", (0.30, 0.33, 0.40), 0.75, 0.45)
    gold = pmat("gold", (0.83, 0.63, 0.22), 0.95, 0.25)
    blue = emat("blue", (0.30, 0.72, 1.0), 12)
    win = emat("win", (0.78, 0.90, 1.0), 5)
    o = []
    # waist spine (slim — the proportion contrast against hammer + stern sells the ship)
    spine = smooth_stations([(1.9, 0.16, 0.16, 0.02), (1.0, 0.32, 0.34, 0.04),
                             (0.0, 0.36, 0.36, 0.02), (-1.1, 0.42, 0.34, 0.0)], 4)
    o += [loft_hull(xs_keel(1.0, -0.55, 0.2, 1.0), spine, white, bevel=0.045)]
    # armor plate bands breaking up the spine
    o += [plate_band(xs_keel(1.0, -0.55, 0.2, 1.0), spine, 0.85, 0.5, 1.07, panel)]
    o += [plate_band(xs_keel(1.0, -0.55, 0.2, 1.0), spine, -0.1, -0.45, 1.07, panel)]
    # THE HAMMER: bladed crossbar lofted across the bow, thicker at the tips
    o += [loft_axis(XS_FOIL, [(-1.2, 0.80, 0.36, 1.62, 0.03), (-0.55, 0.72, 0.30, 1.70, 0.04),
                              (0.0, 0.70, 0.30, 1.72, 0.05), (0.55, 0.72, 0.30, 1.70, 0.04),
                              (1.2, 0.80, 0.36, 1.62, 0.03)], white, "X", 0.045, False, "hammer")]
    # hammer tip pods: hex sensor housings + blue forward deflector eyes
    o += pair(lambda sx: [prism(6, 0.15, 0.85, (sx * 1.26, 1.62, 0.03), (math.radians(90), 0, 0), steel, bevel=0.03),
                          disc(0.10, 0.05, (sx * 1.26, 2.06, 0.03), blue)])
    o += [box((0.9, 0.05, 0.045), (0, 1.78, 0.20), (0, 0, 0), gold, bevel=0.012)]   # gold brow line
    # bridge tower amidships (stepped) + windows
    o += [box((0.20, 0.34, 0.10), (0, 0.35, 0.44), (0, 0, 0), white, bevel=0.04)]
    o += [box((0.13, 0.22, 0.08), (0, 0.30, 0.56), (0, 0, 0), panel, bevel=0.03)]
    o += [box((0.09, 0.045, 0.03), (0, 0.47, 0.58), (0, 0, 0), blue, bevel=0)]
    # turret row down the spine + gold dorsal ridge
    for y in (1.05, 0.0, -0.75):
        o += turret((0, y, 0.40), steel, steel, r=0.085, length=0.42)
    o += [box((0.04, 1.35, 0.035), (0, 0.1, 0.38), (0, 0, 0), gold, bevel=0.01)]
    # stern block: wide engineering slab + three engine bells + intake fins
    stern = smooth_stations([(-1.0, 0.46, 0.30, 0.0), (-1.5, 0.66, 0.40, 0.0),
                             (-2.0, 0.62, 0.38, 0.0), (-2.3, 0.50, 0.32, 0.0)], 3)
    o += [loft_hull(xs_slab(1.0, 0.6), stern, white, bevel=0.05)]
    o += window_strip(-1.2, -2.1, 0.62, 0.12, win, n=6)
    o += pair(lambda sx: fin((sx * 0.55, -1.35, 0.30), 0.30, 0.45, 0.18, 0.05, 0.18, panel))
    for dx in (-0.42, 0.0, 0.42):
        o += nozzle((dx, -2.42, 0.0), 0.17, steel, blue, length=0.55)
    return o


def kareth():
    """Spirewing (Nature) — a gliding bird: slender teardrop body, huge CRESCENT wings
    with glowing veins, and a fanned three-feather tail. Jade + cyan-green light."""
    green = pmat("green", (0.09, 0.28, 0.18), 0.4, 0.5)
    jade = pmat("jade", (0.16, 0.50, 0.38), 0.5, 0.42)
    glow = emat("glow", (0.49, 1.0, 0.77), 10)
    o = []
    body = smooth_stations([(2.0, 0.06, 0.06, 0.0), (1.2, 0.30, 0.28, 0.05), (0.2, 0.42, 0.36, 0.05),
                            (-0.8, 0.32, 0.28, 0.0), (-1.7, 0.12, 0.12, -0.03)], 4)
    o += [loft_hull(xs_round(0.85, 0.75), body, green, bevel=0.06, smooth=True)]
    # crescent wings: curved sweep (curve=1.9 bends the tips hard back)
    o += wing_pair((0.30, 0.55, 0.03), 1.55, 1.15, 0.16, 0.13, 1.55, 0.20, green, curve=1.9)
    # glowing veins tracking the wing's local sweep angle
    for (fx, ln, ang, vz) in ((0.75, 0.40, 33, 0.085), (1.15, 0.34, 48, 0.115), (1.5, 0.26, 58, 0.15)):
        o += pair(lambda sx, fx=fx, ln=ln, ang=ang, vz=vz:
                  box((ln, 0.026, 0.024), (sx * fx, 0.62 - 0.62 * (fx / 1.85) ** 1.9 * 2.4, vz),
                      (0, 0, sx * -math.radians(ang)), glow, bevel=0))
    o += [box((0.028, 1.7, 0.026), (0, 0.1, 0.38), (0, 0, 0), glow, bevel=0)]   # spine vein
    # fanned tail feathers (center + mirrored, angled outward)
    o += [box((0.07, 0.62, 0.02), (0, -2.05, 0.02), (0, 0, 0), jade, bevel=0.025)]
    o += pair(lambda sx: box((0.06, 0.5, 0.018), (sx * 0.22, -1.92, 0.02), (0, 0, sx * 0.38), jade, bevel=0.025))
    o += pair(lambda sx: box((0.02, 0.06, 0.016), (sx * 0.40, -2.12, 0.02), (0, 0, sx * 0.38), glow, bevel=0))
    o += [box((0.02, 0.07, 0.018), (0, -2.38, 0.02), (0, 0, 0), glow, bevel=0)]
    # head: cockpit teardrop + swept whisker antennae
    o += [sphere((0, 1.35, 0.20), (0.08, 0.15, 0.07), glow)]
    o += pair(lambda sx: cyl(0.013, 0.8, (sx * 0.22, 1.6, 0.10), (math.radians(72), 0, sx * -0.55), jade, bevel=0))
    # underslung engine pods, tucked close
    o += pair(lambda sx: [cyl(0.10, 0.85, (sx * 0.30, -0.75, -0.20), (math.radians(90), 0, 0), jade, smooth=True, bevel=0.03),
                          disc(0.075, 0.05, (sx * 0.30, -1.19, -0.20), glow)])
    return o


def terra():
    """Ironside (Frontier) — a TRUSS-SPINE hauler: tug cab, exposed lattice backbone
    clamped with cargo containers, and a massive twin-bell engine block."""
    rust = pmat("rust", (0.48, 0.28, 0.15), 0.5, 0.8)
    dark = pmat("dark", (0.24, 0.15, 0.09), 0.5, 0.85)
    tan = pmat("tan", (0.68, 0.53, 0.28), 0.65, 0.6)
    steel = pmat("steel", (0.42, 0.41, 0.40), 0.7, 0.5)
    glow = emat("glow", (1.0, 0.5, 0.2), 10)
    win = emat("win", (1.0, 0.85, 0.5), 5)
    rng = random.Random(7)
    o = []
    # tug cab up front
    cab = smooth_stations([(2.3, 0.22, 0.20, 0.0), (1.9, 0.46, 0.38, 0.02), (1.3, 0.50, 0.42, 0.0)], 3)
    o += [loft_hull(xs_slab(1.0, 0.6), cab, rust, bevel=0.06)]
    o += [box((0.30, 0.05, 0.055), (0, 2.18, 0.16), (0, 0, 0), win, bevel=0)]   # windshield band
    o += antenna((0.14, 1.6, 0.44), 0.30, steel)
    o += pair(lambda sx: box((0.07, 0.10, 0.07), (sx * 0.40, 2.02, 0.22), (0, 0, 0), steel, bevel=0.02))  # floodlights
    # THE TRUSS: exposed lattice backbone
    o += truss(1.3, -1.1, 0.26, 0.22, steel, bays=4)
    # cargo containers clamped to the truss: side rows + one centered top row
    mats = [tan, dark, steel, rust]
    for k, y in enumerate((0.95, 0.40, -0.15, -0.70)):
        o += pair(lambda sx, y=y, k=k: box((0.22, 0.24, 0.24), (sx * 0.50, y, 0.0), (0, 0, 0), mats[k % 4], bevel=0.04))
    for k, y in enumerate((0.68, -0.42)):
        o += [box((0.22, 0.24, 0.20), (0, y, 0.42), (0, 0, 0), mats[(k + 1) % 4], bevel=0.04)]
    # engine block: heavy slab + two BIG bells + one service bell + dorsal radiators
    blk = smooth_stations([(-1.1, 0.50, 0.38, 0.0), (-1.6, 0.72, 0.50, 0.0), (-2.2, 0.62, 0.44, 0.0)], 3)
    o += [loft_hull(xs_slab(1.0, 0.6), blk, rust, bevel=0.06)]
    o += pair(lambda sx: nozzle((sx * 0.34, -2.35, 0.0), 0.20, dark, glow, length=0.65))
    o += nozzle((0, -2.30, 0.30), 0.10, dark, glow, length=0.4)
    for y in (-1.35, -1.6, -1.85):
        o += [box((0.5, 0.05, 0.10), (0, y, 0.50), (0, 0, 0), steel, bevel=0.015)]   # radiator ribs
    o += window_strip(-1.35, -1.95, 0.66, 0.05, win, n=4)
    # under-slung fuel tanks + one-sided crane on the cab roof
    o += pair(lambda sx: cyl(0.15, 1.0, (sx * 0.42, -1.6, -0.44), (math.radians(90), 0, 0), steel, smooth=True, bevel=0.03))
    o += [offside(box((0.045, 0.045, 0.26), (0.42, 1.45, 0.62), (0, 0, 0), steel, bevel=0.015))]
    o += [offside(box((0.045, 0.30, 0.045), (0.42, 1.22, 0.84), (0, 0, 0), steel, bevel=0.015))]
    o += [offside(box((0.028, 0.028, 0.09), (0.42, 0.98, 0.76), (0, 0, 0), dark, bevel=0))]
    o += greeble_strip(rng, -1.3, -2.1, -0.70, 0.14, dark, n=4, s=0.08)
    return o


def illumaria():
    """Cipher (Shadow) — a stealth CATAMARAN: twin dagger hulls bridged by a razor
    wing, floating cockpit pod, magenta slit lights. No round parts anywhere."""
    darkm = pmat("dark", (0.14, 0.12, 0.23), 0.8, 0.28)
    trim = pmat("trim", (0.26, 0.20, 0.40), 0.8, 0.32)
    glow = emat("glow", (0.82, 0.29, 1.0), 11)
    o = []
    # twin dagger hulls, toed slightly outward toward the stern
    hull_xs = xs_lens(0.55, 0.34)
    o += pair(lambda sx: loft_axis(hull_xs, smooth_stations([
        (2.2, 0.07, 0.06, sx * 0.50, 0.0), (1.2, 0.30, 0.24, sx * 0.56, 0.02),
        (0.2, 0.42, 0.30, sx * 0.62, 0.03), (-0.8, 0.36, 0.26, sx * 0.68, 0.0),
        (-1.6, 0.14, 0.12, sx * 0.72, -0.02)], 4), darkm, "Y", 0.035, False, "cat"))
    # razor bridge wing joining the hulls
    o += [loft_hull(xs_lens(1.0, 0.16), smooth_stations([
        (0.9, 0.40, 0.09, 0.02), (0.3, 0.85, 0.11, 0.03), (-0.4, 0.85, 0.10, 0.02), (-1.0, 0.45, 0.08, 0.0)], 3),
        darkm, bevel=0.03)]
    # floating cockpit pod on the centerline + slit canopy
    o += [loft_hull(xs_diamond(), smooth_stations([
        (1.5, 0.05, 0.05, 0.10), (0.9, 0.16, 0.13, 0.14), (0.1, 0.14, 0.11, 0.12), (-0.5, 0.06, 0.05, 0.08)], 3),
        trim, bevel=0.03)]
    o += [box((0.04, 0.30, 0.02), (0, 0.75, 0.27), (0, 0, 0), glow, bevel=0)]
    # slit lights: inner hull walls + chevrons on the bridge wing
    o += pair(lambda sx: box((0.02, 0.7, 0.024), (sx * 0.40, 0.35, 0.10), (0, 0, 0), glow, bevel=0))
    o += pair(lambda sx: box((0.30, 0.028, 0.022), (sx * 0.30, -0.15, 0.095), (0, 0, sx * -0.55), glow, bevel=0))
    # canted fins on each hull tail + slit exhausts
    o += pair(lambda sx: fin((sx * 0.70, -1.05, 0.10), 0.40, 0.38, 0.14, 0.045, 0.26, trim))
    o += pair(lambda sx: box((0.11, 0.05, 0.032), (sx * 0.70, -1.68, -0.02), (0, 0, 0), glow, bevel=0))
    return o


def astryn():
    """Freehold (Rebels) — a TWIN-BOOM attacker: gunship fuselage with a nose gatling
    cluster, stub wings carrying missile racks, tail booms joined by a plank elevator,
    and a dorsal turret. Olive drab, scrappy one-sided kit."""
    olive = pmat("olive", (0.34, 0.38, 0.25), 0.5, 0.7)
    darkm = pmat("dark", (0.19, 0.21, 0.13), 0.5, 0.8)
    orange = pmat("orange", (0.84, 0.51, 0.18), 0.6, 0.5)
    steel = pmat("steel", (0.4, 0.4, 0.38), 0.7, 0.55)
    glow = emat("glow", (0.61, 0.91, 0.29), 10)
    rng = random.Random(42)
    o = []
    # stubby fuselage
    body = smooth_stations([(1.9, 0.10, 0.10, 0.0), (1.1, 0.40, 0.36, 0.03), (0.1, 0.52, 0.44, 0.02),
                            (-0.9, 0.38, 0.32, -0.01), (-1.3, 0.22, 0.20, -0.02)], 4)
    o += [loft_hull(xs_keel(0.95, -0.5, 0.2, 1.0), body, olive, bevel=0.05)]
    # nose gatling cluster (center + mirrored barrels) with a muzzle ring
    o += [cyl(0.03, 0.85, (0, 2.0, -0.02), (math.radians(90), 0, 0), steel, smooth=True, bevel=0)]
    o += pair(lambda sx: cyl(0.024, 0.75, (sx * 0.06, 1.95, 0.03), (math.radians(90), 0, 0), steel, smooth=True, bevel=0))
    o += [torus(0.07, 0.016, (0, 1.75, 0.0), darkm, rot=(math.radians(90), 0, 0))]
    # stub wings + underwing missile racks
    o += wing_pair((0.42, -0.05, 0.06), 0.95, 0.72, 0.34, 0.12, 0.35, 0.03, olive)
    o += pair(lambda sx: missile_rack((sx * 0.98, -0.12, -0.06), 2, 3, darkm))
    o += pair(lambda sx: box((0.08, 0.26, 0.05), (sx * 1.34, -0.28, 0.07), (0, 0, sx * -0.35), orange, bevel=0.03))
    # dorsal turret + cockpit glow
    o += turret((0, 0.55, 0.44), steel, steel, r=0.10, length=0.5)
    o += [box((0.10, 0.22, 0.045), (0, 1.15, 0.30), (0, 0, 0), glow, bevel=0.02)]
    # twin tail booms flowing back from the wings, joined by a plank elevator
    o += pair(lambda sx: loft_axis(xs_round(1.0, 1.0), smooth_stations([
        (-0.3, 0.10, 0.11, sx * 0.52, 0.02), (-1.2, 0.085, 0.095, sx * 0.55, 0.02), (-1.95, 0.045, 0.05, sx * 0.55, 0.06)], 3),
        olive, "Y", 0.03, True, "boom"))
    o += [box((0.62, 0.14, 0.028), (0, -1.85, 0.14), (0, 0, 0), olive, bevel=0.03)]
    o += pair(lambda sx: fin((sx * 0.55, -1.75, 0.10), 0.30, 0.26, 0.10, 0.04, 0.16, darkm))
    # engines at the fuselage stern + boom tip lights
    o += pair(lambda sx: nozzle((sx * 0.20, -1.42, 0.0), 0.12, darkm, glow, length=0.42))
    o += pair(lambda sx: box((0.03, 0.05, 0.03), (sx * 0.55, -2.0, 0.06), (0, 0, 0), glow, bevel=0))
    # scrappy one-sided kit
    o += [offside(cyl(0.015, 0.7, (0.28, 1.15, 0.30), (math.radians(68), 0, -0.3), steel, bevel=0))]   # sensor boom (+x)
    o += [offside(box((0.13, 0.30, 0.13), (-0.40, 0.15, 0.30), (0, 0, 0.1), darkm, bevel=0.04))]        # strapped pod (-x)
    o += [offside(box((0.14, 0.028, 0.14), (-0.40, 0.15, 0.30), (0, 0, 0), steel, bevel=0))]
    o += greeble_strip(rng, 0.7, -0.6, 0.34, 0.34, darkm, n=4, s=0.075)
    return o


def ezrathi():
    """Threnody (Void cult) — a CATHEDRAL ark: bow lance, tall blade hull with flying
    buttresses, arched window rows, and three shrinking halo rings trailing aft."""
    obs = pmat("obs", (0.09, 0.08, 0.12), 0.45, 0.4)
    violet = pmat("violet", (0.40, 0.23, 0.60), 0.6, 0.4)
    glow = emat("glow", (0.55, 1.0, 0.42), 12)
    vglow = emat("vglow", (0.55, 0.3, 1.0), 9)
    o = []
    hull_sts = smooth_stations([(2.0, 0.07, 0.14, 0.0), (1.2, 0.38, 0.70, 0.0), (0.2, 0.58, 1.02, 0.0),
                                (-0.8, 0.48, 0.82, 0.0), (-1.6, 0.26, 0.45, 0.0), (-2.1, 0.09, 0.16, -0.02)], 4)
    o += [loft_hull(xs_tall(0.55, 1.05), hull_sts, obs, bevel=0.03)]
    # bow lance: long needle + glow collar
    o += [cyl(0.035, 1.1, (0, 2.5, 0.15), (math.radians(90), 0, 0), violet, smooth=True, bevel=0)]
    o += [cone(0.05, 0.35, (0, 3.15, 0.15), (math.radians(-90), 0, 0), obs)]
    o += [torus(0.075, 0.018, (0, 2.05, 0.15), glow, rot=(math.radians(90), 0, 0))]
    # spires: two dorsal blades + a long ventral keel
    o += [fin((0, 0.15, 1.00), 0.85, 0.55, 0.10, 0.06, 0.30, obs)]
    o += [fin((0, -0.75, 0.80), 0.55, 0.40, 0.08, 0.05, 0.22, obs)]
    o += [fin((0, -0.35, -0.85), -0.55, 0.75, 0.16, 0.06, 0.35, obs)]
    # flying buttresses: mirrored struts sweeping down the flanks
    for y in (0.7, 0.1, -0.5):
        o += pair(lambda sx, y=y: box((0.30, 0.045, 0.032), (sx * 0.42, y, -0.10), (0, sx * 0.55, 0), violet, bevel=0.015))
    # arched window rows (two tiers)
    o += window_strip(1.0, -0.7, 0.40, 0.35, glow, n=7, size=0.024)
    o += window_strip(0.8, -0.5, 0.48, -0.05, glow, n=5, size=0.024)
    # ritual core + THE HALOS: three shrinking rune rings trailing aft
    o += [prism(8, 0.20, 0.14, (0, 0.55, 1.02), (0, 0, 0), glow, bevel=0)]
    for (y, r) in ((-1.15, 0.72), (-1.55, 0.52), (-1.9, 0.34)):
        o += [torus(r, 0.024, (0, y, 0.10), vglow, rot=(math.radians(90), 0, 0))]
    # drive slits
    o += pair(lambda sx: box((0.09, 0.05, 0.15), (sx * 0.20, -2.05, 0.0), (0, 0, 0), vglow, bevel=0))
    return o


def krithul():
    """Rotmaw (Plague) — an armored ISOPOD: overlapping carapace bands over a fat body,
    mandible pincers around a glowing maw, rows of legs beneath, and a spiked telson."""
    flesh = pmat("flesh", (0.46, 0.50, 0.20), 0.12, 0.88)
    chitin = pmat("chitin", (0.16, 0.18, 0.06), 0.3, 0.62)
    darkm = pmat("dark", (0.13, 0.14, 0.05), 0.2, 0.85)
    glow = emat("glow", (0.78, 1.0, 0.23), 11)
    o = []
    body_sts = smooth_stations([(1.7, 0.16, 0.15, 0.0), (0.9, 0.52, 0.50, 0.04), (0.0, 0.68, 0.66, 0.02),
                                (-0.9, 0.54, 0.52, 0.0), (-1.7, 0.26, 0.24, -0.03), (-2.0, 0.10, 0.10, -0.05)], 4)
    body_xs = xs_round(0.78, 0.85)
    o += [loft_hull(body_xs, body_sts, flesh, bevel=0.1, smooth=True)]
    # THE CARAPACE: separated armor bands with flesh showing through the seams
    for (y0, y1, gr) in ((1.20, 0.85, 1.06), (0.70, 0.28, 1.10), (0.12, -0.30, 1.11),
                         (-0.46, -0.86, 1.09), (-1.00, -1.36, 1.06)):
        o += [plate_band(body_xs, body_sts, y0, y1, gr, chitin, bevel=0.05)]
    # glow sacs in the exposed seams (mirrored)
    for y in (0.775, 0.20, -0.38, -0.93):
        o += pair(lambda sx, y=y: sphere((sx * 0.32, y, 0.42), (0.05, 0.05, 0.05), glow))
    # mandible pincers curling toward (not across) the centerline + glowing maw
    o += pair(lambda sx: [box((0.09, 0.36, 0.10), (sx * 0.32, 1.78, -0.06), (0, 0, sx * -0.5), darkm, bevel=0.04),
                          box((0.055, 0.24, 0.075), (sx * 0.18, 2.06, -0.06), (0, 0, sx * -0.85), darkm, bevel=0.04)])
    o += [cone(0.15, 0.3, (0, 1.85, -0.02), (math.radians(-90), 0, 0), darkm)]
    o += [disc(0.09, 0.05, (0, 1.86, -0.02), glow)]
    # legs: five mirrored pairs beneath the carapace
    for i in range(5):
        y = 1.0 - i * 0.5
        o += pair(lambda sx, y=y: cone(0.035, 0.42, (sx * 0.42, y, -0.52), (math.radians(-25), 0, sx * -0.9), darkm))
    # telson: center tail spike + mirrored side spikes + tucked drive glow
    o += [cone(0.07, 0.9, (0, -2.35, -0.02), (math.radians(90), 0, 0), chitin)]
    o += pair(lambda sx: cone(0.045, 0.65, (sx * 0.26, -2.1, 0.10), (math.radians(-80), 0, sx * 0.3), chitin))
    o += [disc(0.13, 0.06, (0, -1.85, -0.12), glow)]
    # one lopsided growth breaking the symmetry (entirely on +x)
    o += [offside(sphere((0.42, 0.55, 0.30), (0.18, 0.24, 0.16), flesh, bevel=0))]
    o += [offside(sphere((0.50, 0.70, 0.42), (0.055, 0.055, 0.055), glow))]
    return o


def shadur():
    """Nightglass (Stealth) — a diving RAPTOR: needle hull, fore canards, big mid wings
    FOLDED downward like a stooping falcon, one tall tail. Cyan edge lights only."""
    darkm = pmat("dark", (0.08, 0.115, 0.17), 0.74, 0.28)
    trim = pmat("trim", (0.15, 0.33, 0.40), 0.7, 0.3)
    glow = emat("glow", (0.22, 0.9, 1.0), 12)
    o = []
    body = smooth_stations([(2.5, 0.05, 0.08, 0.0), (1.4, 0.26, 0.36, 0.0), (0.3, 0.40, 0.52, 0.0),
                            (-0.8, 0.34, 0.44, 0.0), (-1.8, 0.18, 0.24, 0.0), (-2.3, 0.07, 0.09, 0.0)], 4)
    o += [loft_hull(xs_diamond(), body, darkm, bevel=0.03)]
    # fore canards (small, swept)
    o += wing_pair((0.18, 1.55, 0.06), 0.45, 0.32, 0.12, 0.06, 0.30, 0.04, trim)
    # THE FOLDED WINGS: big anhedral crescents like a falcon mid-stoop
    o += wing_pair((0.32, -0.35, 0.14), 1.25, 0.85, 0.20, 0.12, 0.95, -0.62, darkm, curve=1.35)
    # wingtip claws + edge lights
    o += pair(lambda sx: cone(0.035, 0.30, (sx * 1.60, -1.32, -0.50), (math.radians(90), 0, 0), trim))
    o += pair(lambda sx: box((0.30, 0.024, 0.02), (sx * 0.78, -0.62, 0.07), (0, sx * -0.32, sx * 0.62), glow, bevel=0))
    # tall single tail + short ventral hook
    o += [fin((0, -1.95, 0.28), 0.70, 0.52, 0.16, 0.06, 0.45, darkm)]
    o += [fin((0, -1.9, -0.24), -0.28, 0.30, 0.10, 0.05, 0.14, trim)]
    o += [box((0.03, 0.06, 0.02), (0, -2.42, 0.95), (0, 0, 0), glow, bevel=0)]   # tail beacon
    # spine + canopy slit lights, buried slit exhausts
    o += [box((0.022, 1.2, 0.02), (0, 0.2, 0.53), (0, 0, 0), glow, bevel=0)]
    o += [box((0.045, 0.30, 0.022), (0, 1.15, 0.38), (0, 0, 0), glow, bevel=0)]
    o += pair(lambda sx: box((0.13, 0.05, 0.028), (sx * 0.18, -2.42, 0.0), (0, 0, 0), glow, bevel=0))
    return o


BUILDERS = {
    "consortium-galactica": consortium,
    "kareth-nara": kareth,
    "terra-nexum": terra,
    "illumaria": illumaria,
    "astryn-vel": astryn,
    "ezrathi": ezrathi,
    "krithul": krithul,
    "shadur-kai": shadur,
}


# ---------------- scene / render ----------------
def setup_world():
    w = bpy.data.worlds.new("w"); bpy.context.scene.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.05, 0.06, 0.09, 1); bg.inputs["Strength"].default_value = 0.3


def add_lights():
    def area(loc, energy, size, color):
        l = bpy.data.lights.new("L", "AREA"); l.energy = energy; l.size = size; l.color = color
        o = bpy.data.objects.new("L", l); o.location = loc
        bpy.context.collection.objects.link(o)
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler(); return o
    area((-4, -2, 6), 1600, 6, (0.95, 0.97, 1.0))   # key: stronger, tighter
    area((5, -1, 3), 220, 7, (0.8, 0.85, 1.0))      # dim fill so form shadows read
    area((0, 5, 2.5), 380, 6, (1.0, 0.9, 0.8))      # warm back/rim


def _cam(objs, dir_vec, up):
    pts = []
    for o in objs:
        for c in o.bound_box: pts.append(o.matrix_world @ Vector(c))
    center = sum(pts, Vector()) / len(pts)
    radius = max((p - center).length for p in pts)
    cd = bpy.data.cameras.new("cam"); cd.type = "ORTHO"; cd.ortho_scale = radius * 2.15
    cam = bpy.data.objects.new("cam", cd); bpy.context.collection.objects.link(cam)
    cam.location = center + dir_vec.normalized() * (radius * 4)
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", up).to_euler()
    bpy.context.scene.camera = cam


def frame(objs, yaw=0):  # top-down 3/4, rotated by yaw about Z
    # CAM_Y/CAM_Z tune the viewing elevation; defaults = original 3/4 hero.
    # For the isometric scene (orbital plane squashed by S), match elevation so the
    # ship's footprint squashes the same: set CAM_Y=-cos(asin(S)), CAM_Z=S.
    base = Vector((0.0, float(os.environ.get("CAM_Y", "-0.5")), float(os.environ.get("CAM_Z", "1.0"))))
    _cam(objs, Matrix.Rotation(math.radians(yaw), 4, "Z") @ base, "Y")


VIEWS = {
    "hero": (Vector((0, -0.5, 1.0)), "Y"),
    "top": (Vector((0, 0, 1)), "Y"),
    "side": (Vector((1, 0, 0)), "Z"),
    "front": (Vector((0, -1, 0)), "Z"),
}


def frame_view(objs, name):
    d, up = VIEWS[name]
    _cam(objs, d, up)


def render(path):
    sc = bpy.context.scene; sc.render.engine = "CYCLES"
    try: sc.cycles.device = "CPU"
    except Exception: pass
    sc.cycles.samples = int(os.environ.get("SAMPLES", "160"))
    try: sc.cycles.use_denoising = True
    except Exception: pass
    sc.render.film_transparent = True
    res = int(os.environ.get("RES", "768"))
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)


def make(fid, yaws):
    reset(); setup_world()
    objs = BUILDERS[fid]()
    add_lights()
    for yaw in yaws:
        frame(objs, yaw)
        path = os.path.join(OUT, f"{fid}.png" if len(yaws) == 1 else f"{fid}_y{yaw:03d}.png")
        render(path)
    print("rendered", fid, f"({len(yaws)} angle(s))")


def make_views(fid):  # orthographic proof: top / side / front + hero 3/4
    reset(); setup_world()
    objs = BUILDERS[fid]()
    add_lights()
    for v in ("hero", "top", "side", "front"):
        frame_view(objs, v)
        render(os.path.join(OUT, f"{fid}_{v}.png"))
    print("rendered views", fid)


if __name__ == "__main__":
    ids = [a for a in sys.argv[1:] if not a.startswith("-")] or list(BUILDERS)
    if os.environ.get("VIEWS"):
        for fid in ids:
            if fid in BUILDERS: make_views(fid)
    else:
        # ANGLES env controls yaw count: production = 24 (15° steps); default 1 (hero).
        n = int(os.environ.get("ANGLES", "1"))
        step = 360.0 / n
        yaws = [round(i * step) for i in range(n)]
        for fid in ids:
            if fid in BUILDERS: make(fid, yaws)
    print("done")
