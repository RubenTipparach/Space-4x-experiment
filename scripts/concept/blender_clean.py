#!/usr/bin/env python3
"""Clean, deliberately-modeled faction ships (no random greeble) in Blender/Cycles.

Style-target pass: intentional, symmetric silhouettes built from clean primitives
with bevels + PBR materials, rendered top-down 3/4 with path tracing.

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


def cone(r1, depth, loc, rot, mat, smooth=True, bevel=0.0, verts=32):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=0, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, smooth, bevel)


def nose_cone(r, length, y, mat, verts=32):  # sharp nose pointing +Y
    return cone(r, length, (0, y, 0), (math.radians(-90), 0, 0), mat, verts=verts)


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


# airfoil-ish hexagon: sharp leading/trailing edge, thickest ~1/3 back
XS_FOIL = [(0.5, 0.0), (0.12, 0.5), (-0.38, 0.3), (-0.5, 0.0), (-0.38, -0.3), (0.12, -0.5)]


def wing_pair(loc, span, root, tip, thick, sweep, dihedral, mat, bevel=0.04):
    """Mirrored REAL wings: tapered, swept, lofted along X (not scaled boxes).
    loc = root center; span per side; root/tip = chord; sweep = how far back the tip
    sits; dihedral = tip rise. Sharp leading/trailing edges from XS_FOIL."""
    x0, y0, z0 = loc
    def one(sx):
        st = [(sx * (x0 + span * f), root + (tip - root) * f, thick * (1 - 0.5 * f),
               y0 - sweep * f, z0 + dihedral * f) for f in (0.0, 0.45, 0.8, 1.0)]
        return loft_axis(XS_FOIL, st, mat, "X", bevel, False, "wing")
    return pair(one)


def fin(loc, height, root, tip, thick, sweep, mat, bevel=0.03):
    """A vertical stabilizer / spire lofted along Z (negative height = ventral)."""
    x0, y0, z0 = loc
    st = [(z0 + height * f, root + (tip - root) * f, thick * (1 - 0.45 * f),
           y0 - sweep * f, x0) for f in (0.0, 0.5, 1.0)]
    return loft_axis(XS_FOIL, st, mat, "Z", bevel, False, "fin")


def engine_block(loc, n, r, housing, glow, spread=None, depth=0.5):
    """A believable stern: n round thruster housings in a row along X, each with a
    recessed glow disc (the rim shadows it, so the glow reads as a nozzle)."""
    out = []
    spread = spread if spread is not None else r * 2.5
    for i in range(n):
        dx = (i - (n - 1) / 2) * spread
        p = (loc[0] + dx, loc[1], loc[2])
        out.append(cyl(r * 1.16, depth, (p[0], p[1] + depth * 0.5, p[2]),
                       (math.radians(90), 0, 0), housing, smooth=True, bevel=0.03))
        out.append(disc(r * 0.8, 0.06, (p[0], p[1] + 0.1, p[2]), glow))
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
    # peaked top, angled sides, narrow keel -> arrow/house front profile
    return [(0, top), (w, shoulder), (0.62 * w, bottom), (-0.62 * w, bottom), (-w, shoulder)]

def xs_lens(w=1.0, h=0.6):
    # flattened hexagon -> lens/blade front profile
    return [(0, h), (w, 0.2 * h), (0.7 * w, -h), (-0.7 * w, -h), (-w, 0.2 * h)]

def xs_diamond():
    return [(0, 1.0), (1.0, 0.0), (0, -0.7), (-1.0, 0.0)]

def xs_slab(w=1.0, h=0.55):  # wide flat-top trapezoid -> industrial hull
    return [(-0.82 * w, h), (0.82 * w, h), (w, -0.15), (0.6 * w, -h), (-0.6 * w, -h), (-w, -0.15)]

def xs_round(w=1.0, h=1.0):  # octagon -> bulbous/organic body
    return [(0, h), (0.7 * w, 0.7 * h), (w, 0), (0.7 * w, -0.7 * h),
            (0, -h), (-0.7 * w, -0.7 * h), (-w, 0), (-0.7 * w, 0.7 * h)]

def xs_tall(w=0.55, h=1.1):  # tall narrow peak -> menacing vertical body
    return [(0, h), (w, 0.2 * h), (0.5 * w, -h), (-0.5 * w, -h), (-w, 0.2 * h)]


# ---------------- builders (forward = +Y, up = +Z) ----------------
def consortium():
    """Meridian (Order): elegant layered cruiser — stepped decks, gold trim spine,
    swept pylons carrying flat blade nacelles, lit windows. Clean capital-ship look."""
    white = pmat("white", (0.84, 0.87, 0.92), 0.55, 0.34)
    panel = pmat("panel", (0.55, 0.60, 0.68), 0.6, 0.45)
    gold = pmat("gold", (0.83, 0.63, 0.22), 0.95, 0.25)
    blue = emat("blue", (0.30, 0.72, 1.0), 12)
    win = emat("win", (0.78, 0.90, 1.0), 5)
    copper = emat("copper", (1.0, 0.6, 0.3), 6)
    o = []
    # main hull: long sleek keel with smooth curvature
    ctrl = [(2.3, 0.05, 0.05, 0.0), (1.6, 0.36, 0.30, 0.03), (0.7, 0.66, 0.50, 0.05),
            (-0.2, 0.74, 0.48, 0.02), (-1.2, 0.52, 0.36, -0.02), (-2.0, 0.20, 0.18, -0.03)]
    o += [loft_hull(xs_keel(1.0, -0.5, 0.18, 1.0), smooth_stations(ctrl, 4), white, bevel=0.05)]
    # stepped upper deck (second loft -> layered side profile)
    deck = [(1.15, 0.26, 0.14, 0.34), (0.45, 0.44, 0.20, 0.40), (-0.55, 0.40, 0.18, 0.36), (-1.35, 0.20, 0.10, 0.26)]
    o += [loft_hull(xs_slab(0.9, 0.8), smooth_stations(deck, 3), panel, bevel=0.04)]
    # bridge + glowing viewport
    o += [box((0.15, 0.26, 0.09), (0, 0.62, 0.60), (0, 0, 0), white, bevel=0.04)]
    o += [box((0.10, 0.05, 0.032), (0, 0.80, 0.61), (0, 0, 0), blue, bevel=0)]
    # gold spine + mirrored nose chevrons (structure, not paint: raised trim ridges)
    o += [box((0.045, 1.35, 0.04), (0, -0.35, 0.52), (0, 0, 0), gold, bevel=0.012)]
    o += pair(lambda sx: box((0.26, 0.055, 0.04), (sx * 0.24, 1.42, 0.17), (0, 0, sx * 0.55), gold, bevel=0.012))
    # flank windows
    o += window_strip(0.9, -1.0, 0.60, 0.16, win, n=9)
    # swept pylons (real lofted wings) carrying FLAT blade nacelles
    o += wing_pair((0.45, -0.55, 0.10), 0.62, 0.55, 0.30, 0.10, 0.35, 0.10, white)
    o += pair(lambda sx: [
        box((0.16, 1.25, 0.10), (sx * 1.12, -0.85, 0.22), (0, 0, sx * 0.04), white, bevel=0.045),   # blade nacelle
        box((0.10, 0.05, 0.05), (sx * 1.12, -0.24, 0.22), (0, 0, sx * 0.04), blue, bevel=0),        # intake glow
        box((0.12, 0.07, 0.07), (sx * 1.12, -1.46, 0.22), (0, 0, sx * 0.04), blue, bevel=0),        # engine glow
        fin((sx * 1.12, -1.05, 0.27), 0.22, 0.30, 0.12, 0.05, 0.14, panel),                          # nacelle fin
    ])
    # stern: twin recessed thrusters + copper deflector at the chin
    o += engine_block((0, -2.05, 0.02), 2, 0.16, panel, blue, spread=0.45)
    o += [disc(0.20, 0.07, (0, 1.15, -0.24), copper)]
    return o


def kareth():
    """Spirewing (Nature): a true manta — broad organic body flowing into huge swept
    wings with bioluminescent leading-edge veins, whisker antennae, underslung pods."""
    green = pmat("green", (0.10, 0.30, 0.19), 0.4, 0.5)
    jade = pmat("jade", (0.18, 0.55, 0.42), 0.5, 0.42)
    glow = emat("glow", (0.49, 1.0, 0.77), 10)
    o = []
    # organic central body (smooth-shaded loft, rounded section)
    ctrl = [(2.1, 0.07, 0.07, 0.0), (1.3, 0.36, 0.30, 0.04), (0.3, 0.55, 0.42, 0.05),
            (-0.7, 0.48, 0.36, 0.0), (-1.6, 0.24, 0.20, -0.04), (-2.1, 0.07, 0.08, -0.05)]
    o += [loft_hull(xs_round(0.85, 0.75), smooth_stations(ctrl, 4), green, bevel=0.06, smooth=True)]
    # the manta wings: big, swept, tapered
    o += wing_pair((0.42, 0.15, 0.0), 1.35, 1.30, 0.30, 0.16, 1.05, 0.12, green)
    # glowing leading-edge veins riding the wing surface (mirrored) + spine vein
    o += pair(lambda sx: box((0.50, 0.028, 0.028), (sx * 0.90, 0.44, 0.075), (0, sx * 0.09, sx * -0.66), glow, bevel=0))
    o += [box((0.03, 1.9, 0.03), (0, 0.0, 0.40), (0, 0, 0), glow, bevel=0)]
    # cockpit teardrop + whisker antennae swept back from the nose (mirrored)
    o += [sphere((0, 1.05, 0.28), (0.09, 0.16, 0.08), glow)]
    o += pair(lambda sx: cyl(0.014, 0.9, (sx * 0.26, 1.55, 0.12), (math.radians(75), 0, sx * -0.5), jade, bevel=0))
    # underslung engine pods (round = smooth), glow exhausts
    o += pair(lambda sx: [
        cyl(0.11, 0.9, (sx * 0.34, -1.0, -0.22), (math.radians(90), 0, 0), jade, smooth=True, bevel=0.03),
        disc(0.08, 0.05, (sx * 0.34, -1.46, -0.22), glow),
    ])
    # tail stinger
    o += [cone(0.06, 0.7, (0, -2.35, -0.02), (math.radians(90), 0, 0), jade)]
    return o


def terra():
    """Ironside (Frontier): a working freighter — cab up front, container racks amidships,
    a heavy triple-thruster stern, fuel tanks below and a one-sided cargo crane."""
    rust = pmat("rust", (0.5, 0.3, 0.16), 0.5, 0.8)
    dark = pmat("dark", (0.28, 0.17, 0.10), 0.5, 0.85)
    tan = pmat("tan", (0.7, 0.55, 0.3), 0.65, 0.6)
    steel = pmat("steel", (0.45, 0.44, 0.42), 0.7, 0.5)
    glow = emat("glow", (1.0, 0.5, 0.2), 10)
    win = emat("win", (1.0, 0.85, 0.5), 5)
    rng = random.Random(7)
    o = []
    # spine hull: low slab, widest amidships
    ctrl = [(1.8, 0.42, 0.34, 0.0), (1.0, 0.72, 0.46, 0.0), (0.0, 0.88, 0.52, 0.0),
            (-1.0, 0.82, 0.50, 0.0), (-1.8, 0.55, 0.42, -0.02)]
    o += [loft_hull(xs_slab(1.0, 0.55), smooth_stations(ctrl, 3), rust, bevel=0.07)]
    # cab: stepped forward block with a lit window band
    o += [box((0.34, 0.34, 0.20), (0, 1.55, 0.42), (0, 0, 0), tan, bevel=0.05)]
    o += [box((0.30, 0.05, 0.05), (0, 1.88, 0.46), (0, 0, 0), win, bevel=0)]
    o += antenna((0.12, 1.35, 0.52), 0.30, steel)
    # container racks: two mirrored rows of alternating boxes sitting proud of the deck
    mats = [tan, dark, steel]
    for k in range(3):
        y = 0.75 - k * 0.62
        o += pair(lambda sx, y=y, k=k: box((0.26, 0.26, 0.22), (sx * 0.42, y, 0.60), (0, 0, 0), mats[k % 3], bevel=0.04))
    o += [box((0.06, 1.9, 0.05), (0, 0.15, 0.52), (0, 0, 0), steel, bevel=0.02)]   # rack rail
    # heavy stern: engine housing block + 3 recessed thrusters
    o += [box((0.62, 0.40, 0.34), (0, -1.95, 0.02), (0, 0, 0), dark, bevel=0.06)]
    o += engine_block((0, -2.3, 0.0), 3, 0.15, dark, glow, spread=0.40)
    # under-slung fuel tanks (mirrored, round = smooth)
    o += pair(lambda sx: cyl(0.16, 1.1, (sx * 0.5, -0.4, -0.38), (math.radians(90), 0, 0), steel, smooth=True, bevel=0.03))
    # one-sided cargo crane (post + boom + hook), entirely on +x
    o += [offside(box((0.05, 0.05, 0.30), (0.72, 0.35, 0.72), (0, 0, 0), steel, bevel=0.015))]
    o += [offside(box((0.05, 0.34, 0.05), (0.72, 0.12, 0.95), (0, 0, 0), steel, bevel=0.015))]
    o += [offside(box((0.03, 0.03, 0.10), (0.72, -0.15, 0.85), (0, 0, 0), dark, bevel=0))]
    # scrappy one-sided patch plates low on the -x flank
    o += greeble_strip(rng, 0.9, -1.2, -0.80, 0.12, dark, n=4, s=0.09)
    return o


def illumaria():
    """Cipher (Shadow): a stealth arrowhead — one wide razor-flat delta with chined
    edges, magenta slit lights, V-tail, and buried slit exhausts. No round parts."""
    darkm = pmat("dark", (0.15, 0.13, 0.24), 0.8, 0.28)
    trim = pmat("trim", (0.28, 0.22, 0.42), 0.8, 0.32)
    glow = emat("glow", (0.82, 0.29, 1.0), 11)
    o = []
    # razor delta: thin lens section, planform widens hard toward the rear
    ctrl = [(2.3, 0.04, 0.05, 0.0), (1.3, 0.55, 0.20, 0.02), (0.2, 1.10, 0.26, 0.02),
            (-0.8, 1.45, 0.24, 0.0), (-1.3, 1.10, 0.18, -0.01), (-1.6, 0.45, 0.10, -0.02)]
    o += [loft_hull(xs_lens(1.0, 0.28), smooth_stations(ctrl, 3), darkm, bevel=0.035)]
    # raised center ridge (cockpit spine) + slit canopy light
    ridge = [(1.5, 0.10, 0.06, 0.10), (0.6, 0.20, 0.10, 0.16), (-0.6, 0.16, 0.08, 0.12), (-1.3, 0.08, 0.04, 0.06)]
    o += [loft_hull(xs_keel(1.0, -0.2, 0.3, 1.0), smooth_stations(ridge, 3), trim, bevel=0.03)]
    o += [box((0.045, 0.30, 0.022), (0, 0.95, 0.20), (0, 0, 0), glow, bevel=0)]
    # mirrored chevron slit lights on the upper skin, following the leading edge
    o += pair(lambda sx: box((0.42, 0.030, 0.022), (sx * 0.62, 0.45, 0.135), (0, 0, sx * -0.94), glow, bevel=0))
    o += pair(lambda sx: box((0.30, 0.026, 0.020), (sx * 0.95, -0.35, 0.115), (0, 0, sx * -0.94), glow, bevel=0))
    # canted V-tail fins near the stern
    o += pair(lambda sx: fin((sx * 0.55, -1.15, 0.10), 0.45, 0.42, 0.16, 0.05, 0.30, trim))
    # buried engines: wide slit exhausts at the trailing edge (stealth, no discs)
    o += pair(lambda sx: box((0.30, 0.05, 0.035), (sx * 0.48, -1.52, 0.02), (0, 0, sx * 0.22), glow, bevel=0))
    return o


def astryn():
    """Freehold (Rebels): a scrappy gunship — compact keel hull, big swept wings with
    tip guns, nose cannons, and honest one-sided junk (sensor boom, strapped pod)."""
    olive = pmat("olive", (0.36, 0.4, 0.27), 0.5, 0.7)
    darkm = pmat("dark", (0.2, 0.22, 0.14), 0.5, 0.8)
    orange = pmat("orange", (0.84, 0.51, 0.18), 0.6, 0.5)
    steel = pmat("steel", (0.4, 0.4, 0.38), 0.7, 0.55)
    glow = emat("glow", (0.61, 0.91, 0.29), 10)
    rng = random.Random(42)
    o = []
    # compact keel hull
    ctrl = [(1.7, 0.09, 0.09, 0.0), (1.0, 0.38, 0.34, 0.03), (0.1, 0.56, 0.46, 0.03),
            (-0.8, 0.50, 0.40, -0.01), (-1.5, 0.24, 0.20, -0.03)]
    o += [loft_hull(xs_keel(0.95, -0.5, 0.2, 1.0), smooth_stations(ctrl, 4), olive, bevel=0.05)]
    # big swept wings with orange wingtip fairings + underwing gun pods
    o += wing_pair((0.40, -0.30, 0.02), 1.05, 0.85, 0.30, 0.13, 0.70, 0.06, olive)
    o += pair(lambda sx: box((0.09, 0.30, 0.06), (sx * 1.42, -0.98, 0.10), (0, 0, sx * -0.58), orange, bevel=0.03))
    o += pair(lambda sx: [
        cyl(0.07, 0.42, (sx * 0.95, -0.55, -0.10), (math.radians(90), 0, 0), darkm, smooth=True, bevel=0.02),
        cyl(0.022, 0.55, (sx * 0.95, -0.20, -0.10), (math.radians(90), 0, 0), steel, smooth=True, bevel=0),
    ])
    # nose cannons + cockpit glow
    o += pair(lambda sx: cyl(0.028, 0.8, (sx * 0.14, 1.45, 0.10), (math.radians(90), 0, 0), steel, smooth=True, bevel=0))
    o += [box((0.10, 0.22, 0.05), (0, 0.75, 0.42), (0, 0, 0), glow, bevel=0.02)]
    # stern engines
    o += engine_block((0, -1.55, 0.0), 2, 0.14, darkm, glow, spread=0.38)
    # scrappy asymmetry (each piece entirely one-sided):
    o += [offside(cyl(0.016, 0.75, (0.30, 1.0, 0.30), (math.radians(70), 0, -0.3), steel, bevel=0))]      # sensor boom (+x)
    o += [offside(box((0.14, 0.34, 0.14), (-0.42, 0.15, 0.34), (0, 0, 0.1), darkm, bevel=0.04))]          # strapped pod (-x)
    o += [offside(box((0.15, 0.03, 0.15), (-0.42, 0.15, 0.34), (0, 0, 0), steel, bevel=0))]               # its strap
    o += greeble_strip(rng, 0.6, -0.9, 0.38, 0.34, darkm, n=4, s=0.08)                                     # patch plates (+x)
    return o


def ezrathi():
    """Threnody (Void cult): a cathedral monolith — tall obsidian hull with dorsal and
    ventral spires, ribbed flanks, a glowing rune ring, and trailing rear spikes."""
    obs = pmat("obs", (0.1, 0.085, 0.13), 0.45, 0.4)
    violet = pmat("violet", (0.42, 0.25, 0.63), 0.6, 0.4)
    glow = emat("glow", (0.55, 1.0, 0.42), 12)
    vglow = emat("vglow", (0.55, 0.3, 1.0), 9)
    o = []
    # tall monolith hull
    ctrl = [(2.0, 0.07, 0.14, 0.0), (1.2, 0.40, 0.72, 0.0), (0.2, 0.60, 1.00, 0.0),
            (-0.8, 0.52, 0.85, 0.0), (-1.6, 0.28, 0.48, 0.0), (-2.0, 0.10, 0.18, -0.02)]
    o += [loft_hull(xs_tall(0.55, 1.05), smooth_stations(ctrl, 4), obs, bevel=0.03)]
    # spires: tall dorsal blade, shorter ventral spike, bow blade
    o += [fin((0, -0.15, 0.85), 0.85, 0.55, 0.10, 0.07, 0.30, obs)]
    o += [fin((0, -0.15, -0.55), -0.55, 0.45, 0.10, 0.06, 0.22, obs)]
    o += [fin((0, 1.45, 0.30), 0.45, 0.30, 0.06, 0.05, -0.18, violet)]
    # ribbed flanks: mirrored angled rib plates seated into the hull sides
    for k in range(4):
        y = 0.9 - k * 0.55
        o += pair(lambda sx, y=y: box((0.05, 0.10, 0.50), (sx * 0.40, y, 0.10), (math.radians(-12), 0, 0), violet, bevel=0.02))
    # glowing rune ring circling the hull + void core
    o += [torus(0.78, 0.030, (0, 0.25, 0.10), glow, rot=(math.radians(90), 0, 0))]
    o += [prism(8, 0.22, 0.16, (0, 0.25, 0.95), (0, 0, 0), glow, bevel=0)]
    # trailing spikes swept off the stern (mirrored) + violet drive slits
    o += pair(lambda sx: cone(0.05, 0.9, (sx * 0.35, -2.15, 0.15), (math.radians(-84), 0, sx * 0.25), obs))
    o += pair(lambda sx: box((0.10, 0.06, 0.16), (sx * 0.22, -1.95, 0.0), (0, 0, 0), vglow, bevel=0))
    return o


def krithul():
    """Rotmaw (Plague): a segmented leviathan — bulbous body with ridge rings, a glowing
    maw, rear tentacle spikes, pustule clusters and one lopsided growth."""
    flesh = pmat("flesh", (0.43, 0.48, 0.18), 0.12, 0.88)
    darkm = pmat("dark", (0.3, 0.32, 0.12), 0.2, 0.85)
    glow = emat("glow", (0.78, 1.0, 0.23), 11)
    o = []
    # bulbous smooth body
    ctrl = [(1.7, 0.14, 0.14, 0.0), (0.9, 0.52, 0.52, 0.02), (0.0, 0.70, 0.72, 0.0),
            (-0.9, 0.56, 0.58, 0.0), (-1.6, 0.30, 0.30, -0.02), (-1.95, 0.12, 0.12, -0.04)]
    o += [loft_hull(xs_round(0.75, 0.8), smooth_stations(ctrl, 4), flesh, bevel=0.1, smooth=True)]
    # segmentation: ridge rings around the body (organic tori)
    for (y, r) in ((0.65, 0.47), (0.0, 0.55), (-0.65, 0.47)):
        o += [torus(r, 0.035, (0, y, 0.0), darkm, rot=(math.radians(90), 0, 0))]
    # glowing maw at the bow (rimmed) + dorsal pustule cluster
    o += [cone(0.16, 0.35, (0, 1.75, 0), (math.radians(-90), 0, 0), darkm)]
    o += [disc(0.10, 0.05, (0, 1.72, 0), glow)]
    o += [sphere((0, 0.45, 0.62), (0.11, 0.11, 0.11), glow)]
    o += pair(lambda sx: sphere((sx * 0.16, 0.25, 0.60), (0.07, 0.07, 0.07), glow))
    # rear tentacle spikes: mirrored pairs swept back + one ventral center
    o += pair(lambda sx: cone(0.07, 1.1, (sx * 0.42, -1.75, 0.05), (math.radians(-80), 0, sx * 0.35), flesh))
    o += pair(lambda sx: cone(0.05, 0.85, (sx * 0.30, -1.65, 0.30), (math.radians(-70), 0, sx * 0.18), darkm))
    o += [cone(0.06, 0.95, (0, -1.75, -0.25), (math.radians(-100), 0, 0), flesh)]
    # drive glow tucked between the tentacles + one-sided tumor growth
    o += [disc(0.16, 0.06, (0, -1.55, 0.0), glow)]
    o += [offside(sphere((0.45, 0.1, 0.28), (0.22, 0.28, 0.20), flesh, bevel=0))]
    o += [offside(sphere((0.52, 0.28, 0.38), (0.06, 0.06, 0.06), glow))]
    return o


def shadur():
    """Nightglass (Stealth): a night dagger — needle hull with a split-prong bow,
    forward-swept fins, a shark tail, and slit cyan lights. Unmistakable planform."""
    darkm = pmat("dark", (0.086, 0.125, 0.18), 0.74, 0.28)
    trim = pmat("trim", (0.16, 0.36, 0.42), 0.7, 0.3)
    glow = emat("glow", (0.22, 0.9, 1.0), 12)
    o = []
    # long needle hull
    ctrl = [(2.0, 0.06, 0.09, 0.0), (1.2, 0.30, 0.40, 0.0), (0.2, 0.46, 0.58, 0.0),
            (-0.8, 0.40, 0.50, 0.0), (-1.7, 0.24, 0.30, 0.0), (-2.3, 0.08, 0.10, 0.0)]
    o += [loft_hull(xs_diamond(), smooth_stations(ctrl, 4), darkm, bevel=0.03)]
    # split-prong bow: mirrored forward blades flanking the nose (trident silhouette)
    o += pair(lambda sx: loft_axis(XS_FOIL, [
        (sx * 0.22, 0.9, 0.14, 1.30, 0.0), (sx * 0.34, 0.6, 0.10, 2.05, 0.02), (sx * 0.40, 0.25, 0.06, 2.45, 0.03),
    ], darkm, "X", 0.03, False, "prong"))
    # forward-swept mid fins (negative sweep — reads instantly in top view)
    o += wing_pair((0.34, -0.75, 0.06), 0.80, 0.62, 0.22, 0.10, -0.55, 0.05, darkm)
    # shark tail: tall dorsal fin + short ventral
    o += [fin((0, -1.85, 0.25), 0.60, 0.50, 0.14, 0.06, 0.35, trim)]
    o += [fin((0, -1.85, -0.20), -0.30, 0.35, 0.10, 0.05, 0.18, trim)]
    # slit lights: spine + canopy + wing leading edges
    o += [box((0.024, 1.1, 0.02), (0, -0.15, 0.55), (0, 0, 0), glow, bevel=0)]
    o += [box((0.05, 0.30, 0.024), (0, 0.85, 0.35), (0, 0, 0), glow, bevel=0)]
    o += pair(lambda sx: box((0.30, 0.024, 0.02), (sx * 0.72, -0.52, 0.10), (0, 0, sx * 0.60), glow, bevel=0))
    # buried slit exhausts either side of the tail
    o += pair(lambda sx: box((0.14, 0.05, 0.03), (sx * 0.20, -2.32, 0.0), (0, 0, 0), glow, bevel=0))
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
    bg.inputs["Color"].default_value = (0.05, 0.06, 0.09, 1); bg.inputs["Strength"].default_value = 0.5


def add_lights():
    def area(loc, energy, size, color):
        l = bpy.data.lights.new("L", "AREA"); l.energy = energy; l.size = size; l.color = color
        o = bpy.data.objects.new("L", l); o.location = loc
        bpy.context.collection.objects.link(o)
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler(); return o
    area((-4, -2, 6), 1400, 7, (0.95, 0.97, 1.0))
    area((5, -1, 3), 450, 7, (0.8, 0.85, 1.0))
    area((0, 5, 2.5), 600, 6, (1.0, 0.9, 0.8))


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
