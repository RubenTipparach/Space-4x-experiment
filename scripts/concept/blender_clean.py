#!/usr/bin/env python3
"""Clean, deliberately-modeled faction ships (no random greeble) in Blender/Cycles.

Style-target pass: intentional, symmetric silhouettes built from clean primitives
with bevels + PBR materials, rendered top-down 3/4 with path tracing.

Run: python3 scripts/concept/blender_clean.py [faction_id ...]
Out: assets/sprites/clean/<faction>.png
"""
import bpy, math, os, sys
from mathutils import Vector

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


# ---------------- builders (forward = +Y, up = +Z) ----------------
def consortium():
    white = pmat("white", (0.86, 0.89, 0.94), 0.55, 0.28)
    gold = pmat("gold", (0.83, 0.63, 0.22), 0.95, 0.25)
    blue = emat("blue", (0.30, 0.72, 1.0), 14)
    copper = emat("copper", (1.0, 0.6, 0.3), 6)
    objs = []
    # saucer (slightly egg toward nose) + rim + bridge
    objs += [sphere((0, 0.85, 0), (1.55, 1.8, 0.32), white)]
    objs += [torus(1.55, 0.07, (0, 0.85, 0), gold)]
    objs += [sphere((0, 0.95, 0.30), (0.32, 0.4, 0.22), white)]
    objs += [sphere((0, 0.95, 0.34), (0.12, 0.14, 0.1), blue)]
    # neck + engineering hull (torpedo) + deflector
    objs += [box((0.34, 0.7, 0.14), (0, -0.35, -0.04), (math.radians(8), 0, 0), white)]
    objs += [sphere((0, -1.5, -0.05), (0.46, 1.35, 0.42), white)]
    objs += [disc(0.3, 0.1, (0, -0.42, -0.05), copper)]
    # pylons + nacelles + bussard + glow strip (mirrored)
    for sx in (-1, 1):
        objs += [box((0.1, 0.55, 0.1), (sx * 0.55, -1.45, 0.2), (0, 0, sx * -0.5), white)]
        objs += [cyl(0.22, 2.4, (sx * 0.98, -0.95, 0.38), (math.radians(90), 0, 0), white)]
        objs += [torus(0.24, 0.05, (sx * 0.98, -0.55, 0.38), gold)]
        objs += [sphere((sx * 0.98, 0.30, 0.38), (0.2, 0.2, 0.2), blue)]
        objs += [box((0.05, 1.0, 0.05), (sx * 0.98, -1.0, 0.62), (0, 0, 0), blue)]
    return objs


BUILDERS = {"consortium-galactica": consortium}


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


def frame(objs):
    pts = []
    for o in objs:
        for c in o.bound_box: pts.append(o.matrix_world @ Vector(c))
    center = sum(pts, Vector()) / len(pts)
    radius = max((p - center).length for p in pts)
    cd = bpy.data.cameras.new("cam"); cd.type = "ORTHO"; cd.ortho_scale = radius * 2.15
    cam = bpy.data.objects.new("cam", cd); bpy.context.collection.objects.link(cam)
    d = Vector((0.0, -0.5, 1.0)).normalized()
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


def make(fid):
    reset(); setup_world()
    objs = BUILDERS[fid]()
    add_lights(); frame(objs)
    render(os.path.join(OUT, f"{fid}.png")); print("rendered", fid)


if __name__ == "__main__":
    ids = sys.argv[1:] or list(BUILDERS)
    for fid in ids:
        if fid in BUILDERS: make(fid)
    print("done")
