#!/usr/bin/env python3
"""Procedural faction starships in Blender (bpy module) rendered with Cycles.

Implements the well-known greeble approach (a1studmuffin SpaceshipGenerator):
start from a box, extrude the hull in segments, add asymmetric protrusions,
categorize faces to place engines/greebles/lights, bevel, then PBR materials.
Each faction is themed (proportions, palette, glow, symmetry, organic flag).

Run: python3 scripts/concept/blender_ships.py
Out: assets/sprites/<faction>.png (transparent, Cycles), top-down 3/4 view.
"""
import bpy, bmesh, random, math, os
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "sprites")
os.makedirs(OUT, exist_ok=True)

# forward = +Y (nose), up = +Z, right = +X
FACTIONS = {
    "consortium-galactica": dict(seed=7,  dims=(1.0,2.2,0.45), seg=4, greeble=14, asym=8,
        hull=(0.86,0.89,0.94), metal=0.72, rough=0.30, glow=(0.37,0.78,1.0), gi=7,
        sym=True, organic=False, bevel=0.03, trim=(0.85,0.66,0.23)),
    "kareth-nara": dict(seed=3, dims=(1.5,2.1,0.5), seg=3, greeble=6, asym=4,
        hull=(0.12,0.35,0.22), metal=0.30, rough=0.50, glow=(0.49,1.0,0.77), gi=8,
        sym=True, organic=True, bevel=0.05, trim=(0.22,0.71,0.54)),
    "terra-nexum": dict(seed=11, dims=(1.1,1.8,0.8), seg=4, greeble=24, asym=14,
        hull=(0.61,0.35,0.17), metal=0.55, rough=0.80, glow=(1.0,0.54,0.23), gi=6,
        sym=False, organic=False, bevel=0.02, trim=(0.79,0.64,0.35)),
    "illumaria": dict(seed=5, dims=(0.95,2.7,0.32), seg=5, greeble=9, asym=6,
        hull=(0.16,0.14,0.25), metal=0.82, rough=0.24, glow=(0.82,0.29,1.0), gi=8,
        sym=True, organic=False, bevel=0.03, trim=(0.48,0.36,1.0)),
    "astryn-vel": dict(seed=23, dims=(0.95,2.2,0.5), seg=4, greeble=18, asym=12,
        hull=(0.36,0.40,0.27), metal=0.50, rough=0.70, glow=(0.61,0.91,0.29), gi=6,
        sym=False, organic=False, bevel=0.025, trim=(0.84,0.51,0.18)),
    "ezrathi": dict(seed=13, dims=(1.2,2.3,0.6), seg=4, greeble=16, asym=10,
        hull=(0.10,0.085,0.13), metal=0.42, rough=0.40, glow=(0.55,1.0,0.42), gi=9,
        sym=False, organic=False, bevel=0.015, trim=(0.42,0.25,0.63)),
    "krithul": dict(seed=29, dims=(1.3,1.9,0.9), seg=3, greeble=10, asym=8,
        hull=(0.43,0.48,0.18), metal=0.10, rough=0.85, glow=(0.78,1.0,0.23), gi=8,
        sym=False, organic=True, bevel=0.05, trim=(0.62,0.68,0.24)),
    "shadur-kai": dict(seed=17, dims=(0.9,2.8,0.32), seg=5, greeble=9, asym=6,
        hull=(0.086,0.125,0.18), metal=0.74, rough=0.28, glow=(0.22,0.90,1.0), gi=8,
        sym=True, organic=False, bevel=0.03, trim=(0.23,0.63,0.71)),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def extrude(bm, face, vec, scale, rot=0.0):
    r = bmesh.ops.extrude_face_region(bm, geom=[face])
    nf = [g for g in r["geom"] if isinstance(g, bmesh.types.BMFace)]
    nv = [g for g in r["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.delete(bm, geom=[face], context="FACES")
    cap = nf[0]
    bmesh.ops.translate(bm, verts=nv, vec=vec)
    c = cap.calc_center_median()
    bmesh.ops.scale(bm, verts=nv, vec=Vector(scale), space=Matrix.Translation(-c))
    if rot:
        bmesh.ops.rotate(bm, verts=nv, cent=c,
                         matrix=Matrix.Rotation(rot, 3, "Y"))
    return cap


def build_mesh(p):
    rnd = random.Random(p["seed"])
    bm = bmesh.new()
    sx, sy, sz = p["dims"]
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx; v.co.y *= sy; v.co.z *= sz

    def end_face(sign):  # face whose normal points +Y/-Y
        bm.normal_update()
        best, bd = None, -2
        for f in bm.faces:
            d = f.normal.y * sign
            if d > bd:
                bd, best = d, f
        return best

    # primary hull: extrude nose (+Y) and tail (-Y) in segments
    for sign in (1, -1):
        f = end_face(sign)
        for i in range(p["seg"]):
            seglen = (0.45 + rnd.random() * 0.55) * (sy / p["seg"])
            sc = 0.70 + rnd.random() * 0.45
            f = extrude(bm, f, Vector((0, sign * seglen, 0)), (sc, 1.0, sc),
                        rot=(rnd.random() - 0.5) * 0.25)
            # occasional vertical shift for shape interest
            if rnd.random() < 0.4:
                for v in f.verts:
                    v.co.z += (rnd.random() - 0.5) * sz * 0.6

    # asymmetric protrusions: pick random faces, extrude along normal
    for i in range(p["asym"]):
        f = rnd.choice(bm.faces[:])
        if abs(f.normal.y) > 0.8:  # keep ends clean-ish
            continue
        d = (0.1 + rnd.random() * 0.5)
        n = f.normal.copy()
        f2 = extrude(bm, f, n * d, (0.6 + rnd.random() * 0.3,) * 3)
        if rnd.random() < 0.5:
            extrude(bm, f2, n * d * 0.6, (0.6,) * 3)

    bm.normal_update()

    # symmetry
    if p["sym"]:
        bmesh.ops.symmetrize(bm, input=bm.verts[:] + bm.edges[:] + bm.faces[:],
                             direction="-X")
        bm.normal_update()

    # material slots: 0 hull, 1 trim, 2 glow
    for f in bm.faces:
        f.material_index = 0

    # engines on the tail (-Y facing faces): inset + push in + glow
    bm.normal_update()
    rear = sorted([f for f in bm.faces if f.normal.y < -0.6],
                  key=lambda f: -f.calc_area())[:3]
    if rear:
        res = bmesh.ops.inset_individual(bm, faces=rear, thickness=0.06, depth=-0.12)
        for f in rear:
            f.material_index = 2

    # greebles: small inset extrusions on side/top faces; some emissive "lights"
    bm.normal_update()
    cand = [f for f in bm.faces if abs(f.normal.y) < 0.7 and f.calc_area() > 0.05]
    rnd.shuffle(cand)
    for f in cand[: p["greeble"]]:
        try:
            res = bmesh.ops.inset_individual(bm, faces=[f], thickness=0.04,
                                             depth=rnd.choice([-0.05, 0.05, 0.08]))
        except Exception:
            continue
        if rnd.random() < 0.18:
            f.material_index = 2  # glowing window/light
        else:
            f.material_index = 1 if rnd.random() < 0.4 else 0

    me = bpy.data.meshes.new("hull")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("ship", me)
    bpy.context.collection.objects.link(obj)

    # organic lumps for plague/native via displacement
    if p["organic"]:
        sub = obj.modifiers.new("sub", "SUBSURF"); sub.levels = 2; sub.render_levels = 2

    bev = obj.modifiers.new("bevel", "BEVEL")
    bev.width = p["bevel"]; bev.segments = 2; bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(40)

    for poly in me.polygons:
        poly.use_smooth = p["organic"]
    return obj


def mat_principled(name, color, metal, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


def mat_emission(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs["Emission"], o.inputs["Surface"])
    return m


def setup_world():
    w = bpy.data.worlds.new("w"); bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.05, 0.06, 0.09, 1)
    bg.inputs["Strength"].default_value = 0.6


def add_lights():
    def area(loc, energy, size, color=(1, 1, 1)):
        l = bpy.data.lights.new("L", "AREA"); l.energy = energy; l.size = size
        l.color = color
        o = bpy.data.objects.new("L", l); o.location = loc
        bpy.context.collection.objects.link(o)
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        return o
    area((-3, -2, 5), 1200, 6, (0.95, 0.97, 1.0))   # key
    area((4, -1, 3), 400, 6, (0.8, 0.85, 1.0))       # fill (cool)
    area((0, 4, 2), 500, 5, (1.0, 0.9, 0.8))         # rim/back (warm)


def frame_camera(obj):
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    center = sum(bb, Vector()) / 8
    radius = max((v - center).length for v in bb)
    cam_d = bpy.data.cameras.new("cam"); cam_d.type = "ORTHO"
    cam_d.ortho_scale = radius * 2.2
    cam = bpy.data.objects.new("cam", cam_d)
    bpy.context.collection.objects.link(cam)
    # top-down with a 3/4 tilt so the form reads as 3D
    direction = Vector((0.0, -0.55, 1.0)).normalized()
    cam.location = center + direction * (radius * 4)
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam


def render(path):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    try: sc.cycles.device = "CPU"
    except Exception: pass
    sc.cycles.samples = 96
    try: sc.cycles.use_denoising = True
    except Exception: pass
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 640
    sc.view_settings.view_transform = "Filmic" if "Filmic" in [v.name for v in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else sc.view_settings.view_transform
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def make(fid, p):
    reset()
    setup_world()
    obj = build_mesh(p)
    hull = mat_principled("hull", p["hull"], p["metal"], p["rough"])
    trim = mat_principled("trim", p["trim"], min(1.0, p["metal"] + 0.2), max(0.1, p["rough"] - 0.1))
    glow = mat_emission("glow", p["glow"], p["gi"])
    obj.data.materials.append(hull)
    obj.data.materials.append(trim)
    obj.data.materials.append(glow)
    add_lights()
    frame_camera(obj)
    render(os.path.join(OUT, f"{fid}.png"))
    print("rendered", fid)


if __name__ == "__main__":
    for fid, p in FACTIONS.items():
        make(fid, p)
    print("done")
