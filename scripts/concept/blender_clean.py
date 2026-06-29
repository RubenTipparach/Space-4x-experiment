#!/usr/bin/env python3
"""Clean, deliberately-modeled faction ships (no random greeble) in Blender/Cycles.

Style-target pass: intentional, symmetric silhouettes built from clean primitives
with bevels + PBR materials, rendered top-down 3/4 with path tracing.

Run: python3 scripts/concept/blender_clean.py [faction_id ...]
Out: assets/sprites/clean/<faction>.png
"""
import bpy, math, os, sys
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "sprites", "clean")
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


def emat(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1); e.inputs["Strength"].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs["Emission"], o.inputs["Surface"]); return m


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


def torus(major, minor, loc, mat):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc,
                                     major_segments=64, minor_segments=16)
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


def wing(span, chord, thick, loc, sweep, mat, tilt=0.0):  # swept hard-surface wing
    return box((span, chord, thick), loc, (tilt, 0, sweep), mat, smooth=False, bevel=0.04)


# ---------------- builders (forward = +Y, up = +Z) ----------------
def consortium():
    # hard-surface: chamfered discs/boxes, flat panels; smooth only on round tubes
    white = pmat("white", (0.84, 0.87, 0.92), 0.55, 0.34)
    panel = pmat("panel", (0.66, 0.71, 0.78), 0.6, 0.4)
    gold = pmat("gold", (0.83, 0.63, 0.22), 0.95, 0.25)
    blue = emat("blue", (0.30, 0.72, 1.0), 14)
    copper = emat("copper", (1.0, 0.6, 0.3), 6)
    objs = []
    # saucer: chamfered cylinder (flat deck + tapered rim), raised inner panel, gold rim
    objs += [cyl(1.62, 0.26, (0, 0.85, 0), (0, 0, 0), white, smooth=True, bevel=0.17)]
    objs += [cyl(1.04, 0.06, (0, 0.9, 0.15), (0, 0, 0), panel, smooth=True, bevel=0.04)]
    objs += [cyl(0.5, 0.05, (0, 0.95, 0.19), (0, 0, 0), panel, smooth=True, bevel=0.03)]
    objs += [torus(1.62, 0.05, (0, 0.85, 0.0), gold)]
    # bridge: hard-surface puck + sensor
    objs += [cyl(0.34, 0.16, (0, 0.92, 0.2), (0, 0, 0), white, smooth=False, bevel=0.05)]
    objs += [cyl(0.12, 0.08, (0, 0.92, 0.3), (0, 0, 0), blue, smooth=True, bevel=0)]
    # neck (flat) + engineering hull as chamfered box (hard) + deflector
    objs += [box((0.34, 0.7, 0.12), (0, -0.33, -0.02), (math.radians(8), 0, 0), white)]
    objs += [box((0.42, 1.4, 0.36), (0, -1.5, -0.05), (0, 0, 0), white, smooth=False, bevel=0.17)]
    objs += [box((0.3, 0.9, 0.02), (0, -1.5, 0.16), (0, 0, 0), panel)]  # top panel
    objs += [disc(0.3, 0.1, (0, -0.5, -0.05), copper)]
    # pylons (flat) + nacelles (round tubes, smooth) + caps + glow strip (mirrored)
    for sx in (-1, 1):
        objs += [box((0.1, 0.55, 0.12), (sx * 0.55, -1.45, 0.2), (0, 0, sx * -0.5), white)]
        objs += [cyl(0.22, 2.4, (sx * 0.98, -0.95, 0.38), (math.radians(90), 0, 0), white, smooth=True, bevel=0.07)]
        objs += [torus(0.24, 0.05, (sx * 0.98, -0.55, 0.38), gold)]
        objs += [disc(0.2, 0.06, (sx * 0.98, 0.27, 0.38), blue)]  # bussard cap (flat-faced)
        objs += [box((0.05, 1.0, 0.05), (sx * 0.98, -1.0, 0.62), (0, 0, 0), blue)]
    return objs


def kareth():  # organic-nature, but hard-surface angular manta + crystal accents
    green = pmat("green", (0.12, 0.32, 0.20), 0.4, 0.45)
    jade = pmat("jade", (0.20, 0.58, 0.44), 0.5, 0.4)
    glow = emat("glow", (0.49, 1.0, 0.77), 12)
    o = []
    o += [box((0.5, 2.2, 0.3), (0, 0, 0), (0, 0, 0), green, smooth=False, bevel=0.14)]
    o += [prism(3, 0.42, 0.9, (0, 1.1, 0.05), (math.radians(90), 0, 0), green, bevel=0.05)]
    for sx in (-1, 1):
        o += [wing(1.7, 1.0, 0.1, (sx * 1.05, -0.25, 0), sx * -0.38, green, tilt=0.06 * sx)]
        o += [wing(0.7, 0.5, 0.06, (sx * 1.5, -0.55, 0.06), sx * -0.38, jade)]
        o += [prism(4, 0.13, 0.45, (sx * 0.55, 0.35, 0.12), (math.radians(90), 0, math.radians(45)), glow, bevel=0)]
    o += [prism(4, 0.16, 0.55, (0, 0.95, 0.18), (math.radians(90), 0, math.radians(45)), glow, bevel=0)]
    o += [disc(0.3, 0.08, (0, -1.15, 0), glow)]
    return o


def terra():  # blocky frontier salvage, asymmetric, rust
    rust = pmat("rust", (0.5, 0.3, 0.16), 0.5, 0.8)
    dark = pmat("dark", (0.3, 0.18, 0.1), 0.5, 0.85)
    tan = pmat("tan", (0.7, 0.55, 0.3), 0.65, 0.6)
    glow = emat("glow", (1.0, 0.5, 0.2), 10)
    o = []
    o += [box((1.0, 2.1, 0.72), (0, 0, 0), (0, 0, 0), rust, bevel=0.08)]
    o += [box((0.72, 0.6, 0.56), (0, 1.25, 0.02), (0, 0, 0), rust, bevel=0.06)]
    o += [box((0.74, 1.5, 0.16), (0, -0.1, 0.46), (0, 0, 0), dark)]
    o += [box((0.7, 0.9, 0.6), (-1.0, -0.2, 0), (0, 0, 0), dark, bevel=0.05)]  # salvage pod
    o += [box((0.18, 0.5, 0.18), (-0.62, -0.2, 0), (0, 0, math.radians(90)), tan)]  # strut
    o += [cyl(0.04, 1.2, (0.95, 0.4, 0.3), (0, math.radians(20), 0), tan)]  # antenna
    o += [sphere((1.18, 0.95, 0.42), (0.08, 0.08, 0.08), glow)]
    for sx in (-0.4, 0.4):
        o += [cyl(0.3, 0.7, (sx, -1.25, 0), (math.radians(90), 0, 0), dark)]
        o += [disc(0.26, 0.06, (sx, -1.55, 0), glow)]
    for sx in (-0.55, 0.55):
        o += [cyl(0.06, 1.0, (sx, 1.4, 0.2), (math.radians(90), 0, 0), tan)]  # gun
    o += [box((0.4, 0.35, 0.3), (0.35, 0.5, 0.5), (0, 0, 0), tan)]
    return o


def illumaria():  # sleek dark stealth arrowhead, magenta glow
    dark = pmat("dark", (0.16, 0.14, 0.25), 0.8, 0.25)
    trim = pmat("trim", (0.30, 0.24, 0.45), 0.8, 0.3)
    glow = emat("glow", (0.82, 0.29, 1.0), 13)
    o = []
    o += [prism(4, 0.5, 2.6, (0, -0.1, 0), (math.radians(90), 0, math.radians(45)), dark, bevel=0.04)]
    o += [nose_cone(0.5, 1.2, 1.7, dark, verts=4)]
    for sx in (-1, 1):
        o += [wing(1.9, 0.9, 0.09, (sx * 0.95, -0.5, 0), sx * -0.5, dark)]
    o += [box((0.1, 2.4, 0.12), (0, -0.1, 0.34), (0, 0, 0), glow)]  # spine
    o += [disc(0.26, 0.06, (0, -1.45, 0), glow)]
    return o


def astryn():  # scrappy rebel strike fighter, asymmetric, olive+orange
    olive = pmat("olive", (0.36, 0.4, 0.27), 0.5, 0.7)
    dark = pmat("dark", (0.2, 0.22, 0.14), 0.5, 0.8)
    orange = pmat("orange", (0.84, 0.51, 0.18), 0.6, 0.5)
    glow = emat("glow", (0.61, 0.91, 0.29), 11)
    o = []
    o += [box((0.62, 2.1, 0.46), (0, 0, 0), (0, 0, 0), olive, bevel=0.07)]
    o += [nose_cone(0.32, 0.9, 1.4, olive)]
    o += [box((0.16, 1.3, 0.1), (0, -0.2, 0.3), (0, 0, 0), orange)]  # stripe
    o += [box((0.45, 0.5, 0.4), (-0.42, 0.2, 0.1), (0, 0, 0), dark)]  # mismatched panel
    for sx, dz in ((-1, 0.2), (1, -0.2)):
        o += [wing(1.6, 0.7, 0.08, (sx * 0.85, -0.2, dz), sx * -0.3, olive)]
        o += [wing(1.2, 0.5, 0.07, (sx * 0.85, -0.7, -dz), sx * -0.3, dark)]
    for sx in (-0.4, 0.4):
        o += [cyl(0.2, 0.6, (sx, -1.2, 0), (math.radians(90), 0, 0), dark)]
        o += [disc(0.17, 0.05, (sx, -1.45, 0), glow)]
    return o


def ezrathi():  # angular void-cult monolith, obsidian, green/violet glow
    obs = pmat("obs", (0.1, 0.085, 0.13), 0.45, 0.4)
    violet = pmat("violet", (0.42, 0.25, 0.63), 0.6, 0.4)
    glow = emat("glow", (0.55, 1.0, 0.42), 13)
    vglow = emat("vglow", (0.55, 0.3, 1.0), 9)
    o = []
    o += [prism(6, 0.6, 2.4, (0, 0, 0), (math.radians(90), 0, 0), obs, bevel=0.05)]
    o += [nose_cone(0.55, 1.1, 1.45, obs, verts=3)]
    for sx in (-1, 1):
        o += [box((0.28, 1.3, 0.28), (sx * 1.15, 0.1, 0.05), (0, 0, sx * 0.2), violet, bevel=0.04)]  # monolith shard
        o += [wing(1.0, 0.7, 0.12, (sx * 0.8, -0.7, 0), sx * -0.6, obs)]  # blade
    o += [prism(8, 0.34, 0.2, (0, 0.2, 0.34), (0, 0, 0), glow, bevel=0)]  # void core
    o += [box((0.6, 0.06, 0.06), (0, 0.2, 0.42), (0, 0, 0), glow)]
    o += [box((0.06, 0.6, 0.06), (0, 0.2, 0.42), (0, 0, 0), glow)]
    o += [disc(0.28, 0.06, (0, -1.3, 0), vglow)]
    return o


def krithul():  # hard-surface bio-blight, chunky asymmetric, toxic green
    flesh = pmat("flesh", (0.43, 0.48, 0.18), 0.15, 0.85)
    dark = pmat("dark", (0.3, 0.32, 0.12), 0.2, 0.85)
    glow = emat("glow", (0.78, 1.0, 0.23), 12)
    o = []
    o += [prism(6, 0.72, 1.7, (0, -0.1, 0), (math.radians(90), 0, 0), flesh, bevel=0.16)]
    o += [box((0.8, 1.0, 0.66), (0.28, 0.5, 0.06), (0, 0, math.radians(12)), flesh, bevel=0.14)]
    o += [box((0.6, 0.8, 0.55), (-0.34, -0.3, -0.05), (0, 0, math.radians(-10)), flesh, bevel=0.14)]
    o += [nose_cone(0.4, 0.8, 1.15, flesh)]
    for x, y, z, r in ((0.32, 0.55, 0.36, 0.16), (-0.4, 0.0, 0.34, 0.2), (0.45, -0.4, 0.3, 0.13)):
        o += [sphere((x, y, z), (r, r, r), glow)]
    for sx, ang in ((-1, -0.25), (1, 0.2)):
        o += [cyl(0.1, 1.0, (sx * 0.35, -1.1, -0.05), (math.radians(70), 0, ang), dark)]  # tendril
    o += [disc(0.32, 0.07, (0, -1.0, 0), glow)]
    return o


def shadur():  # clean knife-edge stealth dagger, cyan glow
    dark = pmat("dark", (0.086, 0.125, 0.18), 0.74, 0.28)
    trim = pmat("trim", (0.18, 0.4, 0.46), 0.7, 0.3)
    glow = emat("glow", (0.22, 0.9, 1.0), 13)
    o = []
    o += [prism(4, 0.42, 3.0, (0, -0.1, 0), (math.radians(90), 0, math.radians(45)), dark, bevel=0.03)]
    o += [nose_cone(0.42, 1.4, 1.9, dark, verts=4)]
    for sx in (-1, 1):
        o += [wing(1.3, 0.6, 0.08, (sx * 0.7, -1.0, 0), sx * -0.7, dark, tilt=-0.15)]
        o += [box((0.04, 2.2, 0.06), (sx * 0.34, -0.1, 0.28), (0, 0, 0), glow)]  # edge line
    o += [disc(0.16, 0.05, (0, 0.9, 0.2), glow)]  # cockpit
    o += [disc(0.24, 0.06, (0, -1.5, 0), glow)]  # drive
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


def frame(objs, yaw=0):
    pts = []
    for o in objs:
        for c in o.bound_box: pts.append(o.matrix_world @ Vector(c))
    center = sum(pts, Vector()) / len(pts)
    radius = max((p - center).length for p in pts)
    cd = bpy.data.cameras.new("cam"); cd.type = "ORTHO"; cd.ortho_scale = radius * 2.15
    cam = bpy.data.objects.new("cam", cd); bpy.context.collection.objects.link(cam)
    base = Vector((0.0, -0.5, 1.0))                       # top-down 3/4
    d = (Matrix.Rotation(math.radians(yaw), 4, "Z") @ base).normalized()
    cam.location = center + d * (radius * 4)
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam


def render(path):
    sc = bpy.context.scene; sc.render.engine = "CYCLES"
    try: sc.cycles.device = "CPU"
    except Exception: pass
    sc.cycles.samples = 160
    try: sc.cycles.use_denoising = True
    except Exception: pass
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 768
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


if __name__ == "__main__":
    # ANGLES env controls yaw count: production = 24 (15° steps); default 1 (hero 3/4).
    n = int(os.environ.get("ANGLES", "1"))
    step = 360.0 / n
    yaws = [round(i * step) for i in range(n)]
    ids = [a for a in sys.argv[1:] if not a.startswith("-")] or list(BUILDERS)
    for fid in ids:
        if fid in BUILDERS:
            make(fid, yaws)
    print("done")
